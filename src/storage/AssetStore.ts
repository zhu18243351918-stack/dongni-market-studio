import { isDesktopApp } from '../auth/supabase';
import { assetWorkerBroker } from '../lib/WorkerBroker';
import {
  deleteAssetChunks,
  deleteAssetDescriptor,
  findAssetByHash,
  getAssetChunks,
  listProjectAssets,
  putAssetChunk,
  saveAssetDescriptor,
} from '../lib/projectDb';
import type { AssetDescriptor, AssetKind } from '../types';

export const ASSET_CHUNK_SIZE = 4 * 1024 * 1024;

interface PutAssetOptions {
  name: string;
  mimeType?: string;
  kind?: AssetKind;
  width?: number;
  height?: number;
  sourceAssetId?: string;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface StorageEstimate {
  usage: number;
  quota: number;
  remaining: number;
  backend: 'tauri' | 'opfs' | 'indexeddb';
}

export interface AssetStore {
  putStream(blob: Blob, options: PutAssetOptions): Promise<AssetDescriptor>;
  createBlob(descriptor: AssetDescriptor): Promise<Blob>;
  createObjectUrl(descriptor: AssetDescriptor): Promise<string>;
  list(): Promise<AssetDescriptor[]>;
  delete(assetId: string): Promise<void>;
  deleteUnused(usedAssetIds: Set<string>): Promise<void>;
  estimateQuota(): Promise<StorageEstimate>;
}

function safeStoragePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

async function hashBlob(blob: Blob, signal?: AbortSignal, onProgress?: (progress: number) => void) {
  const result = await assetWorkerBroker.run<{ hash: string }>({ type: 'hash', file: blob }, [], onProgress, signal);
  return result.hash;
}

async function getNestedDirectory(root: FileSystemDirectoryHandle, parts: string[], create: boolean) {
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(safeStoragePart(part), { create });
  return current;
}

class LocalAssetStore implements AssetStore {
  private backend: 'tauri' | 'opfs' | 'indexeddb' | null = null;
  private userId: string;
  private projectId: string;

  constructor(userId: string, projectId: string) {
    this.userId = userId;
    this.projectId = projectId;
  }

  private async resolveBackend() {
    if (this.backend) return this.backend;
    if (isDesktopApp) {
      this.backend = 'tauri';
      return this.backend;
    }
    const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
    if (storage.getDirectory) {
      try {
        await storage.getDirectory();
        this.backend = 'opfs';
        return this.backend;
      } catch {
        // Private browsing and embedded webviews can reject OPFS.
      }
    }
    this.backend = 'indexeddb';
    return this.backend;
  }

  async putStream(blob: Blob, options: PutAssetOptions) {
    const kind = options.kind || 'original';
    const hash = await hashBlob(blob, options.signal, (progress) => options.onProgress?.(progress * .2));
    const existing = await findAssetByHash(this.userId, this.projectId, hash, kind);
    if (existing) {
      options.onProgress?.(1);
      return existing;
    }

    const assetId = `asset-${hash.slice(0, 24)}-${kind}`;
    const storageKey = `${safeStoragePart(this.userId)}/${safeStoragePart(this.projectId)}/${assetId}`;
    const chunkCount = Math.ceil(blob.size / ASSET_CHUNK_SIZE);
    const descriptor: AssetDescriptor = {
      id: assetId,
      storageKey,
      userId: this.userId,
      projectId: this.projectId,
      hash,
      name: options.name,
      mimeType: options.mimeType || blob.type || 'application/octet-stream',
      kind,
      byteLength: blob.size,
      chunkSize: ASSET_CHUNK_SIZE,
      chunkCount,
      width: options.width,
      height: options.height,
      sourceAssetId: options.sourceAssetId,
      createdAt: new Date().toISOString(),
    };
    const backend = await this.resolveBackend();
    let written = 0;
    try {
      for (let index = 0; index < chunkCount; index += 1) {
        if (options.signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
        const bytes = new Uint8Array(await blob.slice(index * ASSET_CHUNK_SIZE, Math.min(blob.size, (index + 1) * ASSET_CHUNK_SIZE)).arrayBuffer());
        if (backend === 'tauri') {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('write_asset_chunk', {
            userId: safeStoragePart(this.userId),
            projectId: safeStoragePart(this.projectId),
            assetId,
            chunkIndex: index,
            bytes: Array.from(bytes),
          });
        } else if (backend === 'opfs') {
          const storage = navigator.storage as StorageManager & { getDirectory: () => Promise<FileSystemDirectoryHandle> };
          const root = await storage.getDirectory();
          const directory = await getNestedDirectory(root, ['users', this.userId, 'projects', this.projectId, 'assets', assetId], true);
          const handle = await directory.getFileHandle(`${index.toString().padStart(8, '0')}.chunk`, { create: true });
          const writable = await handle.createWritable();
          await writable.write(bytes as BlobPart);
          await writable.close();
        } else {
          await putAssetChunk(storageKey, index, bytes);
        }
        written += 1;
        options.onProgress?.(.2 + .8 * written / Math.max(1, chunkCount));
      }
      await saveAssetDescriptor(descriptor);
      return descriptor;
    } catch (error) {
      await this.removeStoredAsset({ ...descriptor, chunkCount: written }).catch(() => undefined);
      throw error instanceof DOMException && error.name === 'QuotaExceededError'
        ? new Error('本地存储空间不足，已撤回本次导入')
        : error;
    }
  }

  async createBlob(descriptor: AssetDescriptor) {
    const backend = await this.resolveBackend();
    if (backend === 'tauri') {
      const { invoke } = await import('@tauri-apps/api/core');
      const bytes = await invoke<number[]>('read_asset_chunks', {
        userId: safeStoragePart(this.userId),
        projectId: safeStoragePart(this.projectId),
        assetId: descriptor.id,
      });
      return new Blob([new Uint8Array(bytes)], { type: descriptor.mimeType });
    }
    if (backend === 'opfs') {
      const storage = navigator.storage as StorageManager & { getDirectory: () => Promise<FileSystemDirectoryHandle> };
      const root = await storage.getDirectory();
      const directory = await getNestedDirectory(root, ['users', this.userId, 'projects', this.projectId, 'assets', descriptor.id], false);
      const chunks: Blob[] = [];
      for (let index = 0; index < descriptor.chunkCount; index += 1) {
        const handle = await directory.getFileHandle(`${index.toString().padStart(8, '0')}.chunk`);
        chunks.push(await handle.getFile());
      }
      return new Blob(chunks, { type: descriptor.mimeType });
    }
    const chunks = await getAssetChunks(descriptor.storageKey, descriptor.chunkCount);
    return new Blob(chunks.map((chunk) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer), { type: descriptor.mimeType });
  }

  async createObjectUrl(descriptor: AssetDescriptor) {
    return URL.createObjectURL(await this.createBlob(descriptor));
  }

  async list() {
    return listProjectAssets(this.userId, this.projectId);
  }

  async delete(assetId: string) {
    const descriptor = (await this.list()).find((asset) => asset.id === assetId);
    if (descriptor) await this.removeStoredAsset(descriptor);
  }

  async deleteUnused(usedAssetIds: Set<string>) {
    const assets = await this.list();
    for (const descriptor of assets) {
      if (!usedAssetIds.has(descriptor.id)) await this.removeStoredAsset(descriptor);
    }
  }

  async estimateQuota() {
    const backend = await this.resolveBackend();
    if (backend === 'tauri') {
      const { invoke } = await import('@tauri-apps/api/core');
      const usage = await invoke<number>('local_storage_usage', { userId: safeStoragePart(this.userId) });
      return { usage, quota: Number.MAX_SAFE_INTEGER, remaining: Number.MAX_SAFE_INTEGER, backend };
    }
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    return { usage, quota, remaining: Math.max(0, quota - usage), backend };
  }

  private async removeStoredAsset(descriptor: AssetDescriptor) {
    const backend = await this.resolveBackend();
    if (backend === 'tauri') {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('delete_asset', { userId: safeStoragePart(this.userId), projectId: safeStoragePart(this.projectId), assetId: descriptor.id });
    } else if (backend === 'opfs') {
      const storage = navigator.storage as StorageManager & { getDirectory: () => Promise<FileSystemDirectoryHandle> };
      const root = await storage.getDirectory();
      const directory = await getNestedDirectory(root, ['users', this.userId, 'projects', this.projectId, 'assets'], false);
      await directory.removeEntry(descriptor.id, { recursive: true });
    } else {
      await deleteAssetChunks(descriptor.storageKey, descriptor.chunkCount);
    }
    await deleteAssetDescriptor(descriptor.storageKey);
  }
}

export function createAssetStore(userId: string, projectId: string): AssetStore {
  return new LocalAssetStore(userId, projectId);
}
