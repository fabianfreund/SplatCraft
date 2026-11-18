import { describe, expect, it } from 'vitest';
import { withTrim } from './index.js';

describe('withTrim', () => {
  it('uses the whole clip without a trim', () => {
    expect(withTrim({ duration: 10, fps: 30 }, {})).toEqual({ duration: 10, fps: 30, start: 0, length: undefined, span: 10 });
  });
  it('turns a trim into a seek + length', () => {
    expect(withTrim({ duration: 10 }, { trim: { start: 2, end: 6 } })).toMatchObject({ start: 2, length: 4, span: 4 });
    expect(withTrim({ duration: 10 }, { trim: { start: 3 } })).toMatchObject({ start: 3, length: undefined, span: 7 });
  });
  it('clamps a trim to the probed duration', () => {
    expect(withTrim({ duration: 10 }, { trim: { start: 4, end: 30 } })).toMatchObject({ start: 4, length: undefined, span: 6 });
    expect(withTrim({ duration: 10 }, { trim: { start: 12 } })).toMatchObject({ start: 0, span: 10 });
  });
  it('works without probe data', () => {
    expect(withTrim({}, { trim: { start: 1, end: 5 } })).toMatchObject({ start: 1, length: 4, span: 4 });
    expect(withTrim({}, { trim: { start: 1 } })).toMatchObject({ start: 1, length: undefined, span: undefined });
  });
});
