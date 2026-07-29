/// <reference lib="webworker" />

import type { BrushSeed, SelectionCombineMode, SelectionRefineSettings } from '../types';

type SelectionRequest =
  | {
      id: number;
      type: 'magic';
      image: ImageData;
      seedX: number;
      seedY: number;
      tolerance: number;
      contiguous: boolean;
      current?: Uint8ClampedArray;
      combine: SelectionCombineMode;
    }
  | {
      id: number;
      type: 'edge-background';
      image: ImageData;
    }
  | {
      id: number;
      type: 'quick';
      image: ImageData;
      seeds: BrushSeed[];
      current?: Uint8ClampedArray;
      combine: SelectionCombineMode;
    }
  | {
      id: number;
      type: 'refine';
      width: number;
      height: number;
      mask: Uint8ClampedArray;
      settings: SelectionRefineSettings;
    };

type CvModule = Record<string, any>;
let cvPromise: Promise<CvModule> | null = null;

async function getCv(): Promise<CvModule> {
  if (!cvPromise) {
    cvPromise = import('@techstark/opencv-js').then(async ({ default: module }) => {
      const cv = module instanceof Promise ? await module : module;
      if (cv.Mat) return cv as CvModule;
      await new Promise<void>((resolve) => {
        cv.onRuntimeInitialized = () => resolve();
      });
      return cv as CvModule;
    });
  }
  return cvPromise;
}


function combineMasks(
  next: Uint8ClampedArray,
  current: Uint8ClampedArray | undefined,
  mode: SelectionCombineMode,
) {
  if (!current || mode === 'replace') return next;
  const output = new Uint8ClampedArray(next.length);
  for (let index = 0; index < next.length; index += 1) {
    output[index] = mode === 'add' ? Math.max(current[index], next[index]) : current[index] && !next[index] ? current[index] : 0;
  }
  return output;
}

function magicWand(image: ImageData, seedX: number, seedY: number, tolerance: number, contiguous = true) {
  const { width, height, data } = image;
  const output = new Uint8ClampedArray(width * height);
  const visited = new Uint8Array(width * height);
  const x = Math.max(0, Math.min(width - 1, Math.round(seedX)));
  const y = Math.max(0, Math.min(height - 1, Math.round(seedY)));
  const seedIndex = (y * width + x) * 4;
  const sr = data[seedIndex];
  const sg = data[seedIndex + 1];
  const sb = data[seedIndex + 2];
  const threshold = Math.max(4, tolerance) * 4.42;
  if (!contiguous) {
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      const colorDistance = Math.sqrt(
        (data[offset] - sr) ** 2 +
          (data[offset + 1] - sg) ** 2 +
          (data[offset + 2] - sb) ** 2,
      );
      if (colorDistance <= threshold) output[pixel] = 255;
    }
    return output;
  }
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  queue[tail++] = y * width + x;
  visited[y * width + x] = 1;

  while (head < tail) {
    const pixel = queue[head++];
    const px = pixel % width;
    const offset = pixel * 4;
    const colorDistance = Math.sqrt(
      (data[offset] - sr) ** 2 +
        (data[offset + 1] - sg) ** 2 +
        (data[offset + 2] - sb) ** 2,
    );
    if (colorDistance > threshold) continue;
    output[pixel] = 255;
    const neighbors = [pixel - 1, pixel + 1, pixel - width, pixel + width];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || neighbor >= width * height || visited[neighbor]) continue;
      const nx = neighbor % width;
      if ((neighbor === pixel - 1 || neighbor === pixel + 1) && Math.abs(nx - px) !== 1) continue;
      visited[neighbor] = 1;
      queue[tail++] = neighbor;
    }
  }
  return output;
}

function fallbackEdgeBackground(image: ImageData) {
  const { width, height, data } = image;
  const total = width * height;
  const background = new Uint8Array(total);
  const queued = new Uint8Array(total);
  const queue = new Int32Array(total);
  const borderSamples: Array<[number, number, number]> = [];
  const sampleStep = Math.max(1, Math.floor(Math.max(width, height) / 96));
  for (let x = 0; x < width; x += sampleStep) {
    for (const y of [0, height - 1]) {
      const offset = (y * width + x) * 4;
      borderSamples.push([data[offset], data[offset + 1], data[offset + 2]]);
    }
  }
  for (let y = 0; y < height; y += sampleStep) {
    for (const x of [0, width - 1]) {
      const offset = (y * width + x) * 4;
      borderSamples.push([data[offset], data[offset + 1], data[offset + 2]]);
    }
  }
  let head = 0;
  let tail = 0;
  const enqueue = (pixel: number) => {
    if (pixel < 0 || pixel >= total || queued[pixel]) return;
    queued[pixel] = 1;
    queue[tail++] = pixel;
  };
  for (let x = 0; x < width; x += 1) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y += 1) { enqueue(y * width); enqueue(y * width + width - 1); }

  const matchesBorder = (r: number, g: number, b: number) => {
    for (let index = 0; index < borderSamples.length; index += 1) {
      const sample = borderSamples[index];
      if ((r - sample[0]) ** 2 + (g - sample[1]) ** 2 + (b - sample[2]) ** 2 < 72 ** 2) return true;
    }
    return false;
  };

  while (head < tail) {
    const pixel = queue[head++];
    const offset = pixel * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const px = pixel % width;
    const neighbors = [pixel - 1, pixel + 1, pixel - width, pixel + width];
    const isBorderPixel = px === 0 || px === width - 1 || pixel < width || pixel >= total - width;
    if (!isBorderPixel && !matchesBorder(r, g, b)) continue;
    background[pixel] = 1;
    for (const neighbor of neighbors) {
      if (neighbor < 0 || neighbor >= total || queued[neighbor]) continue;
      const nx = neighbor % width;
      if ((neighbor === pixel - 1 || neighbor === pixel + 1) && Math.abs(nx - px) !== 1) continue;
      const neighborOffset = neighbor * 4;
      const localDistance = Math.sqrt(
        (data[neighborOffset] - r) ** 2 +
          (data[neighborOffset + 1] - g) ** 2 +
          (data[neighborOffset + 2] - b) ** 2,
      );
      if (localDistance <= 38 || matchesBorder(data[neighborOffset], data[neighborOffset + 1], data[neighborOffset + 2])) enqueue(neighbor);
    }
  }
  const foreground = new Uint8ClampedArray(total);
  for (let index = 0; index < total; index += 1) foreground[index] = background[index] ? 0 : 255;
  return foreground;
}

async function edgeBackground(image: ImageData) {
  try {
    const cv = await getCv();
    const src = cv.matFromImageData(image);
    const mask = new cv.Mat(image.height, image.width, cv.CV_8UC1, new cv.Scalar(cv.GC_PR_FGD));
    const hardBorder = Math.max(2, Math.round(Math.min(image.width, image.height) * 0.012));
    const softBorder = Math.max(hardBorder + 2, Math.round(Math.min(image.width, image.height) * 0.07));
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const distance = Math.min(x, y, image.width - 1 - x, image.height - 1 - y);
        if (distance < hardBorder) mask.data[y * image.width + x] = cv.GC_BGD;
        else if (distance < softBorder) mask.data[y * image.width + x] = cv.GC_PR_BGD;
      }
    }
    const bgModel = new cv.Mat();
    const fgModel = new cv.Mat();
    cv.grabCut(src, mask, new cv.Rect(0, 0, 1, 1), bgModel, fgModel, 3, cv.GC_INIT_WITH_MASK);
    const foreground = new Uint8ClampedArray(image.width * image.height);
    for (let index = 0; index < foreground.length; index += 1) {
      foreground[index] = mask.data[index] === cv.GC_FGD || mask.data[index] === cv.GC_PR_FGD ? 255 : 0;
    }
    src.delete(); mask.delete(); bgModel.delete(); fgModel.delete();
    return foreground;
  } catch {
    return fallbackEdgeBackground(image);
  }
}

function fallbackQuickSelect(image: ImageData, seeds: BrushSeed[]) {
  const foreground = seeds.filter((seed) => seed.foreground);
  if (!foreground.length) return new Uint8ClampedArray(image.width * image.height);
  const seed = foreground[foreground.length - 1];
  return magicWand(image, seed.x, seed.y, 34);
}

async function quickSelect(image: ImageData, seeds: BrushSeed[], current?: Uint8ClampedArray) {
  try {
    const cv = await getCv();
    const src = cv.matFromImageData(image);
    const mask = new cv.Mat(image.height, image.width, cv.CV_8UC1, new cv.Scalar(cv.GC_PR_BGD));
    if (current) {
      for (let index = 0; index < current.length; index += 1) {
        if (current[index] > 127) mask.data[index] = cv.GC_PR_FGD;
      }
    }
    for (const seed of seeds) {
      const radius = Math.max(2, Math.round(seed.radius));
      const minX = Math.max(0, Math.floor(seed.x - radius));
      const maxX = Math.min(image.width - 1, Math.ceil(seed.x + radius));
      const minY = Math.max(0, Math.floor(seed.y - radius));
      const maxY = Math.min(image.height - 1, Math.ceil(seed.y + radius));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          if ((x - seed.x) ** 2 + (y - seed.y) ** 2 <= radius ** 2) {
            mask.data[y * image.width + x] = seed.foreground ? cv.GC_FGD : cv.GC_BGD;
          }
        }
      }
    }
    const bgModel = new cv.Mat();
    const fgModel = new cv.Mat();
    cv.grabCut(
      src,
      mask,
      new cv.Rect(0, 0, 1, 1),
      bgModel,
      fgModel,
      2,
      cv.GC_INIT_WITH_MASK,
    );
    const output = new Uint8ClampedArray(image.width * image.height);
    for (let index = 0; index < output.length; index += 1) {
      output[index] = mask.data[index] === cv.GC_FGD || mask.data[index] === cv.GC_PR_FGD ? 255 : 0;
    }
    src.delete();
    mask.delete();
    bgModel.delete();
    fgModel.delete();
    return output;
  } catch {
    return fallbackQuickSelect(image, seeds);
  }
}

async function refineMask(
  width: number,
  height: number,
  input: Uint8ClampedArray,
  settings: SelectionRefineSettings,
) {
  try {
    const cv = await getCv();
    let source = new cv.Mat(height, width, cv.CV_8UC1);
    source.data.set(input);
    if (settings.smooth > 0) {
      const kernel = Math.max(3, Math.round(settings.smooth / 2) * 2 + 3);
      const result = new cv.Mat();
      cv.medianBlur(source, result, kernel);
      source.delete();
      source = result;
    }
    const edgeAmount = Math.round(settings.expand + settings.shiftEdge);
    if (edgeAmount !== 0) {
      const size = Math.min(41, Math.abs(edgeAmount) * 2 + 1);
      const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(size, size));
      const result = new cv.Mat();
      if (edgeAmount > 0) cv.dilate(source, result, kernel);
      else cv.erode(source, result, kernel);
      source.delete();
      kernel.delete();
      source = result;
    }
    if (settings.feather > 0) {
      const kernel = Math.min(51, Math.max(3, Math.round(settings.feather) * 2 + 1));
      const oddKernel = kernel % 2 === 0 ? kernel + 1 : kernel;
      const result = new cv.Mat();
      cv.GaussianBlur(source, result, new cv.Size(oddKernel, oddKernel), 0);
      source.delete();
      source = result;
    }
    const output = new Uint8ClampedArray(source.data);
    if (settings.contrast > 0) {
      const factor = 1 + settings.contrast / 20;
      for (let index = 0; index < output.length; index += 1) {
        output[index] = Math.max(0, Math.min(255, (output[index] - 127.5) * factor + 127.5));
      }
    }
    source.delete();
    return output;
  } catch {
    return input;
  }
}

self.onmessage = async (event: MessageEvent<SelectionRequest>) => {
  const request = event.data;
  try {
    self.postMessage({ id: request.id, progress: 20 });
    let output: Uint8ClampedArray;
    let width: number;
    let height: number;
    if (request.type === 'magic') {
      width = request.image.width;
      height = request.image.height;
      output = combineMasks(
        magicWand(request.image, request.seedX, request.seedY, request.tolerance, request.contiguous),
        request.current,
        request.combine,
      );
    } else if (request.type === 'quick') {
      width = request.image.width;
      height = request.image.height;
      self.postMessage({ id: request.id, progress: 45 });
      output = combineMasks(
        await quickSelect(request.image, request.seeds, request.current),
        request.current,
        request.combine,
      );
    } else if (request.type === 'edge-background') {
      width = request.image.width;
      height = request.image.height;
      self.postMessage({ id: request.id, progress: 45 });
      output = await edgeBackground(request.image);
    } else {
      width = request.width;
      height = request.height;
      output = await refineMask(width, height, request.mask, request.settings);
    }
    self.postMessage({ id: request.id, progress: 90 });
    self.postMessage({ id: request.id, width, height, mask: output }, [output.buffer]);
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : '选区计算失败' });
  }
};

export {};
