import { TranslationError } from './types';

interface QueuedTask<T> {
  priority: number;
  group?: string;
  order: number;
  signal?: AbortSignal;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export class PriorityQueue {
  private pending: QueuedTask<unknown>[] = [];
  private activeCount = 0;
  private sequence = 0;
  private maxConcurrency: number;

  constructor(maxConcurrency = 3) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  setMaxConcurrency(limit: number): void {
    this.maxConcurrency = Math.max(1, limit);
    this.drain();
  }

  enqueue<T>(
    run: () => Promise<T>,
    opts?: { priority?: number; group?: string; signal?: AbortSignal },
  ): Promise<T> {
    if (opts?.signal?.aborted) {
      return Promise.reject(new TranslationError('aborted', 'Request cancelled'));
    }

    return new Promise<T>((resolve, reject) => {
      const task: QueuedTask<unknown> = {
        priority: opts?.priority ?? 2,
        group: opts?.group,
        order: ++this.sequence,
        signal: opts?.signal,
        run,
        resolve: resolve as (v: unknown) => void,
        reject,
      };

      if (opts?.signal) {
        opts.signal.addEventListener(
          'abort',
          () => {
            const idx = this.pending.indexOf(task);
            if (idx >= 0) {
              this.pending.splice(idx, 1);
              reject(new TranslationError('aborted', 'Request cancelled'));
            }
          },
          { once: true },
        );
      }

      this.pending.push(task);
      this.pending.sort((a, b) => a.priority - b.priority || a.order - b.order);
      this.drain();
    });
  }

  cancelGroup(group: string): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i]?.group === group) {
        const [removed] = this.pending.splice(i, 1);
        removed?.reject(new TranslationError('aborted', 'Group cancelled'));
      }
    }
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrency && this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) break;
      if (next.signal?.aborted) {
        next.reject(new TranslationError('aborted', 'Request cancelled'));
        continue;
      }
      this.activeCount++;
      next
        .run()
        .then(next.resolve, next.reject)
        .finally(() => {
          this.activeCount--;
          this.drain();
        });
    }
  }
}
