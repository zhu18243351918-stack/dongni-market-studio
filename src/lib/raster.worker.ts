/// <reference lib="webworker" />

import type { ImageAdjustments } from '../types';

interface FilterRequest {
  id: string;
  type: 'filter';
  blob: Blob;
  adjustments: ImageAdjustments;
  outputType: string;
  quality: number;
}

interface MaskRequest {
  id: string;
  type: 'mask';
  blob: Blob;
  mask: Blob;
  outputType: string;
  quality: number;
}

interface CancelRequest { id: string; type: 'cancel' }
const cancelled = new Set<string>();

function clamp(value: number) { return Math.max(0, Math.min(255, value)); }

function applyPixels(imageData: ImageData, adjustments: ImageAdjustments, taskId: string) {
  const data = imageData.data;
  const brightness = adjustments.brightness * 2.55;
  const contrastValue = adjustments.contrast * 2.55;
  const contrast = (259 * (contrastValue + 255)) / (255 * (259 - contrastValue));
  const saturation = 1 + adjustments.saturation / 100;
  const temperature = adjustments.temperature * .72;
  const hue = adjustments.hue * Math.PI / 180;
  const cos = Math.cos(hue);
  const sin = Math.sin(hue);
  const matrix = [
    .213 + cos * .787 - sin * .213, .715 - cos * .715 - sin * .715, .072 - cos * .072 + sin * .928,
    .213 - cos * .213 + sin * .143, .715 + cos * .285 + sin * .140, .072 - cos * .072 - sin * .283,
    .213 - cos * .213 - sin * .787, .715 - cos * .715 + sin * .715, .072 + cos * .928 + sin * .072,
  ];
  for (let index = 0; index < data.length; index += 4) {
    if (index % 4_000_000 === 0 && cancelled.has(taskId)) throw new DOMException('操作已取消', 'AbortError');
    let red = contrast * (data[index] - 128) + 128 + brightness + temperature;
    let green = contrast * (data[index + 1] - 128) + 128 + brightness;
    let blue = contrast * (data[index + 2] - 128) + 128 + brightness - temperature;
    const luminance = red * .2126 + green * .7152 + blue * .0722;
    red = luminance + (red - luminance) * saturation;
    green = luminance + (green - luminance) * saturation;
    blue = luminance + (blue - luminance) * saturation;
    data[index] = clamp(red * matrix[0] + green * matrix[1] + blue * matrix[2]);
    data[index + 1] = clamp(red * matrix[3] + green * matrix[4] + blue * matrix[5]);
    data[index + 2] = clamp(red * matrix[6] + green * matrix[7] + blue * matrix[8]);
  }
}

self.onmessage = async (event: MessageEvent<FilterRequest | MaskRequest | CancelRequest>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelled.add(message.id);
    return;
  }
  try {
    if (message.type === 'mask') {
      const source = await createImageBitmap(message.blob);
      const mask = await createImageBitmap(message.mask);
      const canvas = new OffscreenCanvas(source.width, source.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建蒙版工作画布');
      context.drawImage(source, 0, 0);
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(mask, 0, 0, source.width, source.height);
      source.close();
      mask.close();
      const blob = await canvas.convertToBlob({ type: message.outputType, quality: message.quality });
      self.postMessage({ id: message.id, type: 'result', blob, width: canvas.width, height: canvas.height });
      return;
    }
    const source = await createImageBitmap(message.blob);
    self.postMessage({ id: message.id, type: 'progress', progress: .18 });
    const canvas = new OffscreenCanvas(source.width, source.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法创建滤镜工作画布');
    context.drawImage(source, 0, 0);
    source.close();
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    applyPixels(imageData, message.adjustments, message.id);
    self.postMessage({ id: message.id, type: 'progress', progress: .72 });
    if (message.adjustments.blur > 0 && 'filter' in context) {
      const temporary = new OffscreenCanvas(canvas.width, canvas.height);
      const temporaryContext = temporary.getContext('2d');
      if (temporaryContext) {
        temporaryContext.putImageData(imageData, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.filter = `blur(${Math.min(24, message.adjustments.blur)}px)`;
        context.drawImage(temporary, 0, 0);
        context.filter = 'none';
      } else context.putImageData(imageData, 0, 0);
    } else context.putImageData(imageData, 0, 0);
    const blob = await canvas.convertToBlob({ type: message.outputType, quality: message.quality });
    self.postMessage({ id: message.id, type: 'result', blob, width: canvas.width, height: canvas.height });
  } catch (error) {
    self.postMessage({ id: message.id, type: 'error', error: error instanceof Error ? error.message : '滤镜处理失败' });
  } finally {
    cancelled.delete(message.id);
  }
};

export {};
