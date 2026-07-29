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

interface HealRequest {
  id: string;
  type: 'heal';
  blob: Blob;
  rect: { x: number; y: number; width: number; height: number };
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

function healPixels(imageData: ImageData, rect: HealRequest['rect'], taskId: string) {
  const { width, height, data } = imageData;
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(rect.x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(rect.y)));
  const x1 = Math.max(x0, Math.min(width - 1, Math.ceil(rect.x + rect.width) - 1));
  const y1 = Math.max(y0, Math.min(height - 1, Math.ceil(rect.y + rect.height) - 1));
  const original = new Uint8ClampedArray(data);
  const edgeDistance = (x: number, y: number) => Math.min(x - x0, x1 - x, y - y0, y1 - y);
  const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const fillPixel = (x: number, y: number, layer: number) => {
    const radius = Math.min(7, 2 + Math.floor(layer / 5));
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 0;
    let total = 0;
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      const sampleY = y + offsetY;
      if (sampleY < 0 || sampleY >= height) continue;
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        const sampleX = x + offsetX;
        if (sampleX < 0 || sampleX >= width || (!offsetX && !offsetY)) continue;
        if (inside(sampleX, sampleY) && edgeDistance(sampleX, sampleY) >= layer) continue;
        const distance = Math.hypot(offsetX, offsetY);
        if (distance > radius) continue;
        const weight = 1 / Math.max(1, distance);
        const sampleOffset = (sampleY * width + sampleX) * 4;
        red += data[sampleOffset] * weight;
        green += data[sampleOffset + 1] * weight;
        blue += data[sampleOffset + 2] * weight;
        alpha += data[sampleOffset + 3] * weight;
        total += weight;
      }
    }
    if (!total) {
      const sampleX = x - x0 < x1 - x ? Math.max(0, x0 - 1) : Math.min(width - 1, x1 + 1);
      const sampleY = y - y0 < y1 - y ? Math.max(0, y0 - 1) : Math.min(height - 1, y1 + 1);
      const sampleOffset = (sampleY * width + sampleX) * 4;
      red = data[sampleOffset];
      green = data[sampleOffset + 1];
      blue = data[sampleOffset + 2];
      alpha = data[sampleOffset + 3];
      total = 1;
    }
    const offset = (y * width + x) * 4;
    data[offset] = red / total;
    data[offset + 1] = green / total;
    data[offset + 2] = blue / total;
    data[offset + 3] = alpha / total;
  };

  const maxLayer = Math.floor(Math.min(x1 - x0, y1 - y0) / 2);
  for (let layer = 0; layer <= maxLayer; layer += 1) {
    if (layer % 24 === 0 && cancelled.has(taskId)) throw new DOMException('操作已取消', 'AbortError');
    const left = x0 + layer;
    const right = x1 - layer;
    const top = y0 + layer;
    const bottom = y1 - layer;
    for (let x = left; x <= right; x += 1) {
      fillPixel(x, top, layer);
      if (bottom !== top) fillPixel(x, bottom, layer);
    }
    for (let y = top + 1; y < bottom; y += 1) {
      fillPixel(left, y, layer);
      if (right !== left) fillPixel(right, y, layer);
    }
    if (layer % 12 === 0) self.postMessage({ id: taskId, type: 'progress', progress: .18 + .48 * layer / Math.max(1, maxLayer) });
  }

  for (let pass = 0; pass < 2; pass += 1) {
    const smoothed = new Uint8ClampedArray(data);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        let red = 0;
        let green = 0;
        let blue = 0;
        let alpha = 0;
        let total = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleX = Math.max(0, Math.min(width - 1, x + offsetX));
            const sampleY = Math.max(0, Math.min(height - 1, y + offsetY));
            const weight = !offsetX && !offsetY ? 3 : 1;
            const sampleOffset = (sampleY * width + sampleX) * 4;
            red += data[sampleOffset] * weight;
            green += data[sampleOffset + 1] * weight;
            blue += data[sampleOffset + 2] * weight;
            alpha += data[sampleOffset + 3] * weight;
            total += weight;
          }
        }
        const offset = (y * width + x) * 4;
        smoothed[offset] = red / total;
        smoothed[offset + 1] = green / total;
        smoothed[offset + 2] = blue / total;
        smoothed[offset + 3] = alpha / total;
      }
    }
    data.set(smoothed);
  }

  const feather = Math.max(1, Math.min(4, Math.floor(Math.min(rect.width, rect.height) / 12)));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const distance = edgeDistance(x, y);
      if (distance >= feather) continue;
      const mix = Math.max(.8, (distance + 1) / (feather + 1));
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        data[offset + channel] = data[offset + channel] * mix + original[offset + channel] * (1 - mix);
      }
    }
  }
}

self.onmessage = async (event: MessageEvent<FilterRequest | MaskRequest | HealRequest | CancelRequest>) => {
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
    if (message.type === 'heal') {
      const source = await createImageBitmap(message.blob);
      self.postMessage({ id: message.id, type: 'progress', progress: .08 });
      const canvas = new OffscreenCanvas(source.width, source.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('无法创建修补工作画布');
      context.drawImage(source, 0, 0);
      source.close();
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      healPixels(imageData, message.rect, message.id);
      context.putImageData(imageData, 0, 0);
      self.postMessage({ id: message.id, type: 'progress', progress: .9 });
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
