/**
 * Parsers for Brush (v0.3) console output.
 *
 * Brush prints nothing on a non-TTY stdout except `env_logger` lines when
 * RUST_LOG is set. Under a pseudo-terminal it draws an indicatif progress bar:
 *   "[9s] ◍◍◍○○○      75/300     Steps (19.5835/s, 11s remaining)"
 *   "✅ Eval iter 300: PSNR 17.68, ssim 0.64"
 *   "ℹ️ Current splat count 10352"
 * With RUST_LOG=brush_cli=info:
 *   "[…Z INFO  brush_cli] Eval iter 100: PSNR 12.10, ssim 0.48"
 *   "[…Z INFO  brush_cli] Refine iter 201, 10346 splats."
 *   "[…Z INFO  brush_cli] Done training! Took FormattedDuration(6s)."
 */
export type BrushEvent =
  | { type: 'step'; step: number; total: number; stepsPerSec?: number; remaining?: string }
  | { type: 'eval'; step: number; psnr: number; ssim?: number }
  | { type: 'splats'; count: number; step?: number }
  | { type: 'loaded'; train: number; eval: number }
  | { type: 'done' };

export function parseBrushLine(line: string): BrushEvent | undefined {
  let m = /(\d+)\s*\/\s*(\d+)\s+Steps(?:\s*\(([\d.]+)\/s(?:,\s*([^)]+?)\s*remaining)?)?/.exec(line);
  if (m) return { type: 'step', step: Number(m[1]), total: Number(m[2]), stepsPerSec: m[3] ? Number(m[3]) : undefined, remaining: m[4] };
  m = /Eval iter (\d+):\s*PSNR\s*([\d.]+)(?:,\s*ssim\s*([\d.]+))?/i.exec(line);
  if (m) return { type: 'eval', step: Number(m[1]), psnr: Number(m[2]), ssim: m[3] ? Number(m[3]) : undefined };
  m = /Refine iter (\d+),\s*(\d+) splats/.exec(line);
  if (m) return { type: 'splats', step: Number(m[1]), count: Number(m[2]) };
  m = /splat count:?\s*(\d+)/i.exec(line);
  if (m) return { type: 'splats', count: Number(m[1]) };
  m = /Loaded dataset with (\d+) training, (\d+) eval/.exec(line) ?? /Loading dataset with (\d+) training, (\d+) eval/.exec(line);
  if (m) return { type: 'loaded', train: Number(m[1]), eval: Number(m[2]) };
  if (/Done training/.test(line)) return { type: 'done' };
  return undefined;
}

/** Step number from an export file name produced with `--export-name export_{iter}.ply`. */
export function exportStep(file: string): number | undefined {
  const m = /export_(\d+)\.ply$/.exec(file);
  return m ? Number(m[1]) : undefined;
}
