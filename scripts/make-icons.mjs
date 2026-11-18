#!/usr/bin/env node
// Generates every app icon from apps/desktop/build/icon-source.png (square, ≥1024px).
//   node scripts/make-icons.mjs
// Outputs:
//   build/icon.icns            macOS (Apple grid: 824px rounded body on a 1024 canvas, soft shadow)
//   build/icon.png             Windows/Linux source, electron-builder derives .ico and Linux sizes
//   resources/icon.png         runtime window/dock icon (main process)
//   src/renderer/…           favicon (public/) + in-app mark (src/assets/)
//   docs/assets/icon.png       README
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const app = path.join(root, 'apps/desktop');
const sharp = createRequire(path.join(app, 'package.json'))('sharp');
const SRC = path.join(app, 'build/icon-source.png');

const roundedMask = (size, radius) =>
  Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`);

/** Art cropped into a rounded square of `size`. */
async function tile(size, radiusRatio) {
  return sharp(SRC)
    .resize(size, size, { fit: 'cover' })
    .composite([{ input: roundedMask(size, Math.round(size * radiusRatio)), blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/** macOS: 1024 canvas, 824 body, radius ≈ 22.5 %, drop shadow. */
async function macIcon() {
  const body = await tile(824, 0.225);
  const shadow = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{
      input: Buffer.from(`<svg width="1024" height="1024"><rect x="100" y="110" width="824" height="824" rx="185" fill="rgba(0,0,0,0.28)"/></svg>`),
    }])
    .blur(22)
    .png()
    .toBuffer();
  return sharp(shadow).composite([{ input: body, left: 100, top: 100 }]).png().toBuffer();
}

const out = (p) => { mkdirSync(path.dirname(p), { recursive: true }); return p; };

const mac = await macIcon();
const iconset = path.join(mkdtempSync(path.join(tmpdir(), 'sc-icon-')), 'icon.iconset');
mkdirSync(iconset);
for (const s of [16, 32, 128, 256, 512]) {
  await sharp(mac).resize(s, s).toFile(path.join(iconset, `icon_${s}x${s}.png`));
  await sharp(mac).resize(s * 2, s * 2).toFile(path.join(iconset, `icon_${s}x${s}@2x.png`));
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', out(path.join(app, 'build/icon.icns'))]);
rmSync(path.dirname(iconset), { recursive: true, force: true });

const full = await tile(1024, 0.2);
await sharp(full).toFile(out(path.join(app, 'build/icon.png')));
await sharp(full).resize(512, 512).toFile(out(path.join(app, 'resources/icon.png')));
await sharp(mac).resize(512, 512).toFile(out(path.join(app, 'resources/icon-mac.png')));
await sharp(full).resize(256, 256).toFile(out(path.join(app, 'src/renderer/src/assets/app-icon.png')));
await sharp(full).resize(64, 64).toFile(out(path.join(app, 'src/renderer/public/favicon.png')));
await sharp(full).resize(256, 256).toFile(out(path.join(root, 'docs/assets/icon.png')));
console.log('icons written');
