import { loadFontAssets, saveFontAsset } from './projectDb';
import type { StoredFontAsset } from '../types';

const loadedFonts = new Map<string, FontFace>();

async function registerFont(font: StoredFontAsset) {
  if (loadedFonts.has(font.name)) return font.name;
  const face = new FontFace(font.name, font.data.slice(0));
  await face.load();
  document.fonts.add(face);
  loadedFonts.set(font.name, face);
  return font.name;
}

export async function importFontFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || !['ttf', 'otf', 'woff', 'woff2'].includes(extension)) {
    throw new Error('请选择 TTF、OTF、WOFF 或 WOFF2 字体文件');
  }
  const name = file.name.replace(/\.[^.]+$/, '').trim() || `本地字体-${Date.now()}`;
  const asset: StoredFontAsset = { name, type: file.type || `font/${extension}`, data: await file.arrayBuffer() };
  await registerFont(asset);
  await saveFontAsset(asset);
  return name;
}

export async function restoreStoredFonts() {
  const assets = await loadFontAssets();
  const names: string[] = [];
  for (const asset of assets) {
    try {
      names.push(await registerFont(asset));
    } catch {
      // Ignore a broken local font and keep the editor available.
    }
  }
  return names;
}
