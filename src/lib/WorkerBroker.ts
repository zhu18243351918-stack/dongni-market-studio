interface PendingTask<T> {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: number) => void;
  cleanup?: () => void;
}

export class WorkerBroker {
  private tasks = new Map<string, PendingTask<unknown>>();
  private worker: Worker;

  constructor(worker: Worker) {
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<{ id: string; type: string; progress?: number; error?: string } & Record<string, unknown>>) => {
      const task = this.tasks.get(event.data.id);
      if (!task) return;
      if (event.data.type === 'progress') {
        task.onProgress?.(Number(event.data.progress || 0));
        return;
      }
      this.tasks.delete(event.data.id);
      task.cleanup?.();
      if (event.data.type === 'error') task.reject(new Error(String(event.data.error || '后台处理失败')));
      else task.resolve(event.data);
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || '后台线程异常');
      this.tasks.forEach((task) => {
        task.cleanup?.();
        task.reject(error);
      });
      this.tasks.clear();
    };
  }

  run<T>(message: Record<string, unknown>, transfer: Transferable[] = [], onProgress?: (progress: number) => void, signal?: AbortSignal) {
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        this.worker.postMessage({ id, type: 'cancel' });
        const task = this.tasks.get(id);
        task?.cleanup?.();
        this.tasks.delete(id);
        reject(new DOMException('操作已取消', 'AbortError'));
      };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      this.tasks.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress, cleanup });
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.worker.postMessage({ ...message, id }, transfer);
      } catch (error) {
        cleanup();
        this.tasks.delete(id);
        reject(error instanceof Error ? error : new Error('无法启动后台任务'));
      }
    });
  }

  destroy() {
    this.tasks.forEach((task) => {
      task.cleanup?.();
      task.reject(new Error('后台线程已关闭'));
    });
    this.tasks.clear();
    this.worker.terminate();
  }

  cancelAll() {
    for (const [id, task] of this.tasks) {
      this.worker.postMessage({ id, type: 'cancel' });
      task.cleanup?.();
      task.reject(new DOMException('操作已取消', 'AbortError'));
    }
    this.tasks.clear();
  }
}

export const assetWorkerBroker = new WorkerBroker(new Worker(new URL('./asset.worker.ts', import.meta.url), { type: 'module' }));
export const psdWorkerBroker = new WorkerBroker(new Worker(new URL('./psd.worker.ts', import.meta.url), { type: 'module' }));
export const rasterWorkerBroker = new WorkerBroker(new Worker(new URL('./raster.worker.ts', import.meta.url), { type: 'module' }));
