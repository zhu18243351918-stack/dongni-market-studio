import { openDB } from 'idb';
import type { AssetDescriptor, CustomTemplateRecord, DocumentWorkspaceState, ProjectDocument, StoredFontAsset } from '../types';

const DB_NAME = 'tuyan-studio';
const STORE_NAME = 'projects';
const FONT_STORE = 'fonts';
const ASSET_STORE = 'assets';
const ASSET_CHUNK_STORE = 'asset-chunks';
const ARTBOARD_STORE = 'artboard-documents';
const CUSTOM_TEMPLATE_STORE = 'custom-templates';

export const studioDbPromise = openDB(DB_NAME, 4, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    if (!db.objectStoreNames.contains(FONT_STORE)) db.createObjectStore(FONT_STORE, { keyPath: 'name' });
    if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE, { keyPath: 'storageKey' });
    if (!db.objectStoreNames.contains(ASSET_CHUNK_STORE)) db.createObjectStore(ASSET_CHUNK_STORE);
    if (!db.objectStoreNames.contains(ARTBOARD_STORE)) db.createObjectStore(ARTBOARD_STORE);
    if (!db.objectStoreNames.contains(CUSTOM_TEMPLATE_STORE)) db.createObjectStore(CUSTOM_TEMPLATE_STORE, { keyPath: 'id' });
  },
});

function currentProjectKey(userId = 'anonymous') {
  return `${userId}:current-project`;
}

function workspaceKey(userId = 'anonymous') {
  return `${userId}:document-workspace`;
}

export async function saveDocumentWorkspace(workspace: DocumentWorkspaceState, userId = 'anonymous') {
  const db = await studioDbPromise;
  await db.put(STORE_NAME, workspace, workspaceKey(userId));
}

export async function loadDocumentWorkspace(userId = 'anonymous') {
  const db = await studioDbPromise;
  return await db.get(STORE_NAME, workspaceKey(userId)) as DocumentWorkspaceState | undefined;
}

export async function saveCurrentProject(project: ProjectDocument, userId = 'anonymous') {
  const db = await studioDbPromise;
  await db.put(STORE_NAME, project, currentProjectKey(userId));
}

export async function loadCurrentProject(userId = 'anonymous') {
  const db = await studioDbPromise;
  return await db.get(STORE_NAME, currentProjectKey(userId)) as ProjectDocument | undefined;
}

export async function clearCurrentProject(userId = 'anonymous') {
  const db = await studioDbPromise;
  await db.delete(STORE_NAME, currentProjectKey(userId));
}

export async function saveArtboardDocument(key: string, value: Record<string, unknown>) {
  const db = await studioDbPromise;
  await db.put(ARTBOARD_STORE, value, key);
}

export async function loadArtboardDocument(key: string) {
  const db = await studioDbPromise;
  return await db.get(ARTBOARD_STORE, key) as Record<string, unknown> | undefined;
}

export async function deleteArtboardDocument(key: string) {
  const db = await studioDbPromise;
  await db.delete(ARTBOARD_STORE, key);
}

export async function saveAssetDescriptor(descriptor: AssetDescriptor) {
  const db = await studioDbPromise;
  await db.put(ASSET_STORE, descriptor);
}

export async function getAssetDescriptor(storageKey: string) {
  const db = await studioDbPromise;
  return await db.get(ASSET_STORE, storageKey) as AssetDescriptor | undefined;
}

export async function findAssetByHash(userId: string, projectId: string, hash: string, kind = 'original') {
  const db = await studioDbPromise;
  const values = await db.getAll(ASSET_STORE) as AssetDescriptor[];
  return values.find((asset) => asset.userId === userId && asset.projectId === projectId && asset.hash === hash && asset.kind === kind);
}

export async function listProjectAssets(userId: string, projectId: string) {
  const db = await studioDbPromise;
  const values = await db.getAll(ASSET_STORE) as AssetDescriptor[];
  return values.filter((asset) => asset.userId === userId && asset.projectId === projectId);
}

export async function deleteAssetDescriptor(storageKey: string) {
  const db = await studioDbPromise;
  await db.delete(ASSET_STORE, storageKey);
}

export async function putAssetChunk(storageKey: string, index: number, bytes: Uint8Array) {
  const db = await studioDbPromise;
  await db.put(ASSET_CHUNK_STORE, bytes, `${storageKey}:${index.toString().padStart(8, '0')}`);
}

export async function getAssetChunks(storageKey: string, count: number) {
  const db = await studioDbPromise;
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = await db.get(ASSET_CHUNK_STORE, `${storageKey}:${index.toString().padStart(8, '0')}`) as Uint8Array | undefined;
    if (!value) throw new Error('本地图片分块缺失');
    chunks.push(value);
  }
  return chunks;
}

export async function deleteAssetChunks(storageKey: string, count: number) {
  const db = await studioDbPromise;
  const transaction = db.transaction(ASSET_CHUNK_STORE, 'readwrite');
  for (let index = 0; index < count; index += 1) {
    await transaction.store.delete(`${storageKey}:${index.toString().padStart(8, '0')}`);
  }
  await transaction.done;
}

export async function saveFontAsset(font: StoredFontAsset) {
  const db = await studioDbPromise;
  await db.put(FONT_STORE, font);
}

export async function loadFontAssets() {
  const db = await studioDbPromise;
  return await db.getAll(FONT_STORE) as StoredFontAsset[];
}

export async function saveCustomTemplate(template: CustomTemplateRecord) {
  const db = await studioDbPromise;
  await db.put(CUSTOM_TEMPLATE_STORE, template);
}

export async function loadCustomTemplates(userId = 'anonymous') {
  const db = await studioDbPromise;
  const templates = await db.getAll(CUSTOM_TEMPLATE_STORE) as CustomTemplateRecord[];
  return templates.filter((template) => template.userId === userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteCustomTemplate(id: string) {
  const db = await studioDbPromise;
  await db.delete(CUSTOM_TEMPLATE_STORE, id);
}
