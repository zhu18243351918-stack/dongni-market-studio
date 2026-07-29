import type {
  BrushSeed,
  SelectionCombineMode,
  SelectionMask,
  SelectionRefineSettings,
} from '../types';

interface PendingRequest {
  resolve: (value: SelectionMask) => void;
  reject: (reason?: unknown) => void;
  onProgress?: (progress: number) => void;
}

export class SelectionService {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor() {
    this.worker = this.createWorker();
  }

  private createWorker() {
    const worker = new Worker(new URL('./selection.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const { id, progress, error, width, height, mask } = event.data;
      const request = this.pending.get(id);
      if (!request) return;
      if (typeof progress === 'number') {
        request.onProgress?.(progress);
        return;
      }
      this.pending.delete(id);
      if (error) request.reject(new Error(error));
      else request.resolve({ width, height, data: new Uint8ClampedArray(mask) });
    };
    return worker;
  }

  private run(
    payload: Record<string, unknown>,
    onProgress?: (progress: number) => void,
  ): Promise<SelectionMask> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ ...payload, id });
    });
  }

  magic(
    image: ImageData,
    seedX: number,
    seedY: number,
    tolerance: number,
    contiguous: boolean,
    current: Uint8ClampedArray | undefined,
    combine: SelectionCombineMode,
    onProgress?: (progress: number) => void,
  ) {
    return this.run({ type: 'magic', image, seedX, seedY, tolerance, contiguous, current, combine }, onProgress);
  }

  edgeBackground(image: ImageData, onProgress?: (progress: number) => void) {
    return this.run({ type: 'edge-background', image }, onProgress);
  }

  quick(
    image: ImageData,
    seeds: BrushSeed[],
    current: Uint8ClampedArray | undefined,
    combine: SelectionCombineMode,
    onProgress?: (progress: number) => void,
  ) {
    return this.run({ type: 'quick', image, seeds, current, combine }, onProgress);
  }

  refine(mask: SelectionMask, settings: SelectionRefineSettings, onProgress?: (progress: number) => void) {
    return this.run(
      { type: 'refine', width: mask.width, height: mask.height, mask: mask.data, settings },
      onProgress,
    );
  }

  cancelAll() {
    this.worker.terminate();
    for (const request of this.pending.values()) request.reject(new Error('已取消'));
    this.pending.clear();
    this.worker = this.createWorker();
  }

  destroy() {
    this.cancelAll();
    this.worker.terminate();
  }
}
