/// <reference lib="webworker" />

import { createSHA256 } from 'hash-wasm';
import UTIF from 'utif';

interface HashRequest {
  id: string;
  type: 'hash';
  file: Blob;
}

interface PreviewRequest {
  id: string;
  type: 'create-preview';
  file: Blob;
  maxLongEdge: number;
  outputType: 'image/webp' | 'image/png';
}

interface InspectTiffRequest { id: string; type: 'inspect-tiff'; buffer: ArrayBuffer }
interface DecodeTiffRequest { id: string; type: 'decode-tiff'; buffer: ArrayBuffer; maxLongEdge: number }
interface EncodeTiffRequest { id: string; type: 'encode-tiff'; rgba: ArrayBuffer; width: number; height: number }

interface CancelRequest { id: string; type: 'cancel' }

const cancelled = new Set<string>();
const CHUNK_SIZE = 4 * 1024 * 1024;

self.onmessage = async (event: MessageEvent<HashRequest | PreviewRequest | InspectTiffRequest | DecodeTiffRequest | EncodeTiffRequest | CancelRequest>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelled.add(message.id);
    return;
  }
  try {
    if (message.type === 'inspect-tiff' || message.type === 'decode-tiff') {
      const ifds = UTIF.decode(message.buffer);
      const ifd = ifds[0];
      const sourceWidth = Number(ifd?.width || (ifd?.t256 as number[] | undefined)?.[0] || 0);
      const sourceHeight = Number(ifd?.height || (ifd?.t257 as number[] | undefined)?.[0] || 0);
      if (!sourceWidth || !sourceHeight) throw new Error('TIFF 文件中没有可读取的图像');
      if (message.type === 'inspect-tiff') {
        self.postMessage({ id: message.id, type: 'result', width: sourceWidth, height: sourceHeight, pageCount: ifds.length });
        return;
      }
      self.postMessage({ id: message.id, type: 'progress', progress: .18 });
      UTIF.decodeImage(message.buffer, ifd);
      const rgba = UTIF.toRGBA8(ifd);
      if (cancelled.has(message.id)) throw new DOMException('操作已取消', 'AbortError');
      const scale = Math.min(1, message.maxLongEdge / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      self.postMessage({ id: message.id, type: 'progress', progress: .58 });
      if (typeof OffscreenCanvas !== 'undefined' && typeof ImageData !== 'undefined') {
        const sourceCanvas = new OffscreenCanvas(sourceWidth, sourceHeight);
        const sourceContext = sourceCanvas.getContext('2d');
        if (!sourceContext) throw new Error('无法创建 TIFF 解码画布');
        const pixels = new Uint8ClampedArray(rgba.length);
        pixels.set(rgba);
        sourceContext.putImageData(new ImageData(pixels, sourceWidth, sourceHeight), 0, 0);
        const outputCanvas = new OffscreenCanvas(width, height);
        const outputContext = outputCanvas.getContext('2d');
        if (!outputContext) throw new Error('无法创建 TIFF 预览画布');
        outputContext.imageSmoothingEnabled = true;
        outputContext.imageSmoothingQuality = 'high';
        outputContext.drawImage(sourceCanvas, 0, 0, width, height);
        const blob = await outputCanvas.convertToBlob({ type: 'image/png' });
        self.postMessage({ id: message.id, type: 'result', blob, width, height, sourceWidth, sourceHeight });
      } else {
        const buffer = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength) as ArrayBuffer;
        self.postMessage({ id: message.id, type: 'result', rgba: buffer, width: sourceWidth, height: sourceHeight, sourceWidth, sourceHeight }, [buffer]);
      }
      return;
    }
    if (message.type === 'encode-tiff') {
      self.postMessage({ id: message.id, type: 'progress', progress: .2 });
      const encoded = UTIF.encodeImage(new Uint8Array(message.rgba), message.width, message.height);
      const blob = new Blob([encoded], { type: 'image/tiff' });
      self.postMessage({ id: message.id, type: 'result', blob, width: message.width, height: message.height });
      return;
    }
    if (message.type === 'hash') {
      const hasher = await createSHA256();
      hasher.init();
      const chunkCount = Math.max(1, Math.ceil(message.file.size / CHUNK_SIZE));
      for (let offset = 0, index = 0; offset < message.file.size; offset += CHUNK_SIZE, index += 1) {
        if (cancelled.has(message.id)) throw new DOMException('操作已取消', 'AbortError');
        const bytes = new Uint8Array(await message.file.slice(offset, Math.min(message.file.size, offset + CHUNK_SIZE)).arrayBuffer());
        hasher.update(bytes);
        self.postMessage({ id: message.id, type: 'progress', progress: (index + 1) / chunkCount });
      }
      self.postMessage({ id: message.id, type: 'result', hash: hasher.digest('hex') });
      return;
    }
    self.postMessage({ id: message.id, type: 'progress', progress: .12 });
    const source = await createImageBitmap(message.file);
    if (cancelled.has(message.id)) throw new DOMException('操作已取消', 'AbortError');
    const scale = Math.min(1, message.maxLongEdge / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    self.postMessage({ id: message.id, type: 'progress', progress: .42 });
    if (typeof OffscreenCanvas === 'undefined') {
      const resized = scale < .999
        ? await createImageBitmap(message.file, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
        : source;
      if (resized !== source) source.close();
      if (cancelled.has(message.id)) {
        resized.close();
        throw new DOMException('操作已取消', 'AbortError');
      }
      self.postMessage({ id: message.id, type: 'result', imageBitmap: resized, width, height, outputType: message.outputType }, [resized]);
      return;
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('无法创建图片预览');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    source.close();
    if (cancelled.has(message.id)) throw new DOMException('操作已取消', 'AbortError');
    self.postMessage({ id: message.id, type: 'progress', progress: .78 });
    const blob = await canvas.convertToBlob({ type: message.outputType, quality: .9 });
    self.postMessage({ id: message.id, type: 'result', blob, width, height });
  } catch (error) {
    self.postMessage({ id: message.id, type: 'error', error: error instanceof Error ? error.message : '预览生成失败' });
  } finally {
    cancelled.delete(message.id);
  }
};

export {};
