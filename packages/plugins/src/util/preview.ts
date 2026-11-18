import type { StageContext } from '@splatcraft/core';

/** Batches image paths into `images` previews (UI thumbnails stream in). */
export class ImagePreviewBatcher {
  private pending: string[] = [];
  private last = 0;
  constructor(
    private ctx: Pick<StageContext<unknown>, 'preview'>,
    private maxBatch = 24,
    private maxDelayMs = 500,
  ) {}

  add(p: string) {
    this.pending.push(p);
    if (this.pending.length >= this.maxBatch || Date.now() - this.last > this.maxDelayMs) this.flush();
  }

  flush() {
    if (!this.pending.length) return;
    this.ctx.preview({ kind: 'images', paths: this.pending, append: true });
    this.pending = [];
    this.last = Date.now();
  }
}

/** Rate-limits ctx.progress calls (UI/IPC friendly). */
export function throttledProgress(ctx: Pick<StageContext<unknown>, 'progress'>, minIntervalMs = 250) {
  let last = 0;
  return (fraction: number | undefined, message?: string, force = false) => {
    const now = Date.now();
    if (!force && now - last < minIntervalMs) return;
    last = now;
    ctx.progress({ fraction: fraction === undefined ? undefined : Math.max(0, Math.min(1, fraction)), message });
  };
}
