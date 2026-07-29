/// <reference lib="webworker" />

import { initializeCanvas, readPsd, type Layer, type PixelData, type Psd } from 'ag-psd';

interface InspectRequest { id: string; type: 'inspect'; buffer: ArrayBuffer; memoryLimit: number }
interface ParseRequest { id: string; type: 'parse'; buffer: ArrayBuffer; memoryLimit: number }
interface CancelRequest { id: string; type: 'cancel' }

const cancelled = new Set<string>();

const createWorkerImageData = (width: number, height: number) => {
  if (typeof ImageData !== 'undefined') return new ImageData(width, height);
  return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
};

initializeCanvas(
  (width, height) => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement;
    return {
      width,
      height,
      getContext: () => ({ createImageData: createWorkerImageData }),
    } as unknown as HTMLCanvasElement;
  },
  createWorkerImageData,
);

function countLayers(layers: Layer[] | undefined): number {
  return (layers || []).reduce((total, layer) => total + 1 + countLayers(layer.children), 0);
}

function flattenLayers(layers: Layer[] | undefined, parentName = '') {
  const output: Array<{ name: string; left: number; top: number; width: number; height: number; hidden: boolean; opacity: number; imageData?: PixelData }> = [];
  for (const layer of layers || []) {
    const name = parentName ? `${parentName} / ${layer.name || 'PSD 图层'}` : layer.name || 'PSD 图层';
    if (layer.children) output.push(...flattenLayers(layer.children, name));
    else output.push({
      name,
      left: layer.left || 0,
      top: layer.top || 0,
      width: layer.right !== undefined && layer.left !== undefined ? layer.right - layer.left : layer.imageData?.width || 0,
      height: layer.bottom !== undefined && layer.top !== undefined ? layer.bottom - layer.top : layer.imageData?.height || 0,
      hidden: Boolean(layer.hidden),
      opacity: layer.opacity ?? 255,
      imageData: layer.imageData,
    });
  }
  return output;
}

self.onmessage = (event: MessageEvent<InspectRequest | ParseRequest | CancelRequest>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelled.add(message.id);
    return;
  }
  try {
    self.postMessage({ id: message.id, type: 'progress', progress: .08 });
    const options = message.type === 'inspect'
      ? { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true, skipLinkedFilesData: true, logMissingFeatures: false, totalMemoryLimit: message.memoryLimit }
      : { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true, logMissingFeatures: false, totalMemoryLimit: message.memoryLimit };
    const psd = readPsd(message.buffer, options) as Psd;
    if (cancelled.has(message.id)) throw new DOMException('操作已取消', 'AbortError');
    if (message.type === 'inspect') {
      self.postMessage({ id: message.id, type: 'result', width: psd.width, height: psd.height, layerCount: countLayers(psd.children) });
    } else {
      const layers = flattenLayers(psd.children);
      const transfer = layers.flatMap((layer) => layer.imageData ? [layer.imageData.data.buffer as ArrayBuffer] : []);
      if (psd.imageData) transfer.push(psd.imageData.data.buffer as ArrayBuffer);
      self.postMessage({
        id: message.id,
        type: 'result',
        width: psd.width,
        height: psd.height,
        layers,
        composite: psd.imageData,
      }, transfer);
    }
  } catch (error) {
    self.postMessage({ id: message.id, type: 'error', error: error instanceof Error ? error.message : 'PSD解析失败' });
  } finally {
    cancelled.delete(message.id);
  }
};

export {};
