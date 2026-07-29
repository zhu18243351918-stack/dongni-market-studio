import type { ImportPreflightResult } from '../types';
import { assetWorkerBroker, psdWorkerBroker } from './WorkerBroker';

function readUint24(view: DataView, offset: number, littleEndian = false) {
  if (littleEndian) return view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
  return (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2);
}

async function inspectJpeg(file: File) {
  const buffer = await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer();
  const view = new DataView(buffer);
  let offset = 2;
  while (offset + 9 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) { offset += 1; continue; }
    const marker = view.getUint8(offset + 1);
    const length = view.getUint16(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    if (!length) break;
    offset += 2 + length;
  }
  throw new Error('无法读取 JPEG 尺寸');
}

async function inspectImageHeader(file: File) {
  const buffer = await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer();
  const view = new DataView(buffer);
  if (view.byteLength >= 24 && view.getUint32(0) === 0x89504e47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (view.byteLength >= 30 && view.getUint32(0, true) === 0x46464952 && view.getUint32(8, true) === 0x50424557) {
    const subtype = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15));
    if (subtype === 'VP8X') return { width: 1 + readUint24(view, 24, true), height: 1 + readUint24(view, 27, true) };
    if (subtype === 'VP8L') {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (subtype === 'VP8 ' && view.byteLength >= 30) return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (view.byteLength >= 2 && view.getUint16(0) === 0xffd8) return inspectJpeg(file);
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

function deviceProfile() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = matchMedia('(pointer: coarse)').matches || window.innerWidth < 768 || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4);
  const lowMemory = nav.deviceMemory !== undefined && nav.deviceMemory <= 4;
  return {
    deviceClass: mobile ? 'mobile' as const : 'desktop' as const,
    limit: mobile ? 16_000_000 : 50_000_000,
    previewLongEdge: mobile ? (lowMemory ? 1536 : 2048) : (lowMemory ? 3072 : 4096),
  };
}

export async function inspectImportFile(file: File, signal?: AbortSignal): Promise<ImportPreflightResult> {
  const profile = deviceProfile();
  const isPsd = /\.(psd|psb)$/i.test(file.name);
  const isTiff = /\.(tif|tiff)$/i.test(file.name) || ['image/tiff', 'image/x-tiff'].includes(file.type);
  let width = 0;
  let height = 0;
  let layerCount: number | undefined;
  if (isPsd) {
    const header = new DataView(await file.slice(0, 26).arrayBuffer());
    if (header.byteLength < 26 || header.getUint32(0) !== 0x38425053) throw new Error('PSD 文件头无效');
    height = header.getUint32(14);
    width = header.getUint32(18);
    if (width * height <= profile.limit) {
      const buffer = await file.arrayBuffer();
      const metadata = await psdWorkerBroker.run<{ width: number; height: number; layerCount: number }>({ type: 'inspect', buffer, memoryLimit: 256 * 1024 * 1024 }, [buffer], undefined, signal);
      width = metadata.width;
      height = metadata.height;
      layerCount = metadata.layerCount;
    }
  } else if (isTiff) {
    const buffer = await file.arrayBuffer();
    const metadata = await assetWorkerBroker.run<{ width: number; height: number }>({ type: 'inspect-tiff', buffer }, [buffer], undefined, signal);
    width = metadata.width;
    height = metadata.height;
  } else {
    ({ width, height } = await inspectImageHeader(file));
  }
  const pixels = width * height;
  const previewScale = Math.min(1, profile.previewLongEdge / Math.max(width, height));
  const decoded = pixels * 4;
  const layerFactor = isPsd ? Math.max(3, Math.min(12, (layerCount || 1) + 2)) : isTiff ? 4 : 3;
  const estimatedPeakBytes = decoded * layerFactor;
  const allowed = pixels <= profile.limit;
  return {
    kind: isPsd ? 'psd' : isTiff ? 'tiff' : 'image',
    fileName: file.name,
    fileBytes: file.size,
    width,
    height,
    megapixels: pixels / 1_000_000,
    layerCount,
    deviceClass: profile.deviceClass,
    pixelLimit: profile.limit,
    estimatedDecodedBytes: decoded,
    estimatedPeakBytes,
    previewWidth: Math.max(1, Math.round(width * previewScale)),
    previewHeight: Math.max(1, Math.round(height * previewScale)),
    previewScale,
    allowed,
    reason: allowed ? undefined : '内存不足，无法继续，请撤回本次导入。',
  };
}
