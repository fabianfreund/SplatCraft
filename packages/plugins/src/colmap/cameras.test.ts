import { describe, expect, it } from 'vitest';
import { cameraCounts, classifyFrame, groupCameras, perImageGroups } from './cameras.js';

const iphone = { Image: { Make: 'Apple', Model: 'iPhone 15 Pro' }, Photo: { LensModel: 'back 6.765mm', FocalLength: 6.765, FocalLengthIn35mmFilm: 24 } };

describe('camera detection', () => {
  it('classifies EXIF photos, video frames and photos without lens data', () => {
    expect(classifyFrame('/f/IMG_1.jpg', 1200, 1600, iphone)).toMatchObject({ kind: 'exif', focal: true, label: 'Apple iPhone 15 Pro · 24 mm' });
    expect(classifyFrame('/f/IMG_4021_00012.jpg', 1600, 900, undefined)).toMatchObject({ kind: 'video', key: 'video|IMG_4021|1600×900' });
    expect(classifyFrame('/f/pexels-123.jpg', 1067, 1600, undefined)).toMatchObject({ kind: 'photo', key: '', focal: false });
    expect(classifyFrame('/f/a.jpg', 10, 10, { Image: { Make: 'Canon', Model: 'Canon EOS R5' } }).label).toBe('Canon EOS R5');
  });

  it('shares a camera per body/lens/focal/size and per video; photos without lens data get one each', () => {
    const frames = [
      classifyFrame('a.jpg', 1200, 1600, iphone),
      classifyFrame('b.jpg', 1200, 1600, iphone),
      classifyFrame('c.jpg', 1600, 1200, iphone), // rotated: other size, other camera
      classifyFrame('v_00001.jpg', 1600, 900, undefined),
      classifyFrame('v_00002.jpg', 1600, 900, undefined),
      classifyFrame('x.jpg', 1067, 1600, undefined),
      classifyFrame('y.jpg', 1067, 1600, undefined), // same size, but no lens data: not shared
    ];
    const groups = groupCameras(frames);
    expect(groups.map((g) => [g.shared, g.files])).toEqual([
      [true, ['a.jpg', 'b.jpg']],
      [true, ['v_00001.jpg', 'v_00002.jpg']],
      [true, ['c.jpg']],
      [false, ['x.jpg', 'y.jpg']],
    ]);
    expect(cameraCounts(groups)).toEqual({ cameras: 5, withFocal: 2 });
  });

  it('counts focal priors per frame when every image gets its own camera', () => {
    const frames = [classifyFrame('a.jpg', 1200, 1600, iphone), classifyFrame('x.jpg', 1067, 1600, undefined), classifyFrame('y.jpg', 1067, 1600, undefined)];
    expect(cameraCounts(perImageGroups(frames))).toEqual({ cameras: 3, withFocal: 1 });
  });
});
