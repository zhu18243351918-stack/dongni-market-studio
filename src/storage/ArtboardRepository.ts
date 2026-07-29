import { deleteArtboardDocument, loadArtboardDocument, saveArtboardDocument } from '../lib/projectDb';
import type { ArtboardItem } from '../types';

export interface StoredArtboardDocument {
  version: 1;
  artboard: ArtboardItem;
  objects: Array<Record<string, unknown>>;
  thumbnailAssetId?: string;
  updatedAt: string;
}

export class ArtboardRepository {
  private userId: string;
  private projectId: string;

  constructor(userId: string, projectId: string) {
    this.userId = userId;
    this.projectId = projectId;
  }

  key(artboardId: string) {
    return `${this.userId}:${this.projectId}:artboard:${artboardId}`;
  }

  async load(artboardId: string) {
    return await loadArtboardDocument(this.key(artboardId)) as StoredArtboardDocument | undefined;
  }

  async save(document: StoredArtboardDocument) {
    await saveArtboardDocument(this.key(document.artboard.id), document as unknown as Record<string, unknown>);
  }

  async unload(artboardId: string, document?: StoredArtboardDocument) {
    if (document) await this.save(document);
    return artboardId;
  }

  async remove(artboardId: string) {
    await deleteArtboardDocument(this.key(artboardId));
  }

  async createThumbnail(canvas: HTMLCanvasElement, maxSize = 360) {
    const scale = Math.min(1, maxSize / Math.max(canvas.width, canvas.height));
    const preview = document.createElement('canvas');
    preview.width = Math.max(1, Math.round(canvas.width * scale));
    preview.height = Math.max(1, Math.round(canvas.height * scale));
    preview.getContext('2d')?.drawImage(canvas, 0, 0, preview.width, preview.height);
    return new Promise<Blob>((resolve, reject) => preview.toBlob((blob) => blob ? resolve(blob) : reject(new Error('画板缩略图生成失败')), 'image/webp', .78));
  }
}
