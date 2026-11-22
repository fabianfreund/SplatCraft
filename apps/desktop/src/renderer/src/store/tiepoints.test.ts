import type { PipelineSpec, StageDescriptor } from '@shared/api';
import { describe, expect, it } from 'vitest';
import { currentTracks, nextTrackId, placePoint, pointCounts, removePoint, tieStepKey, usableTracks, type TieTrack } from './tiepoints';

const spec: PipelineSpec = {
  preset: 'balanced',
  steps: [
    { key: 'filter', stageId: 's.filter', enabled: true, params: {} },
    { key: 'align', stageId: 's.align', enabled: true, params: { tiePoints: [{ id: 1, points: [{ image: 'a.jpg', x: 0.1, y: 0.2 }] }, { bad: true }] } },
  ],
};
const stages = [
  { id: 's.filter', paramsJsonSchema: { properties: { excluded: {} } } },
  { id: 's.align', paramsJsonSchema: { properties: { tiePoints: {} } } },
] as unknown as StageDescriptor[];

describe('feature points', () => {
  it('finds the step by its tiePoints param and drops malformed tracks', () => {
    expect(tieStepKey(spec, stages)).toBe('align');
    expect(currentTracks(spec, stages)).toEqual([{ id: 1, points: [{ image: 'a.jpg', x: 0.1, y: 0.2 }] }]);
  });

  it('places, moves and removes points; empty tracks disappear', () => {
    let t: TieTrack[] = [];
    t = placePoint(t, 1, 'a.jpg', 0.5, 0.5);
    t = placePoint(t, 1, 'b.jpg', 0.4, 1.7); // clamped
    t = placePoint(t, 1, 'a.jpg', 0.6, 0.5); // moved, still one point in a.jpg
    expect(t).toEqual([{ id: 1, points: [{ image: 'b.jpg', x: 0.4, y: 1 }, { image: 'a.jpg', x: 0.6, y: 0.5 }] }]);
    expect(nextTrackId(t)).toBe(2);
    expect([...pointCounts(t)]).toEqual([['b.jpg', 1], ['a.jpg', 1]]);
    expect(usableTracks(t)).toHaveLength(1);
    t = removePoint(removePoint(t, 1, 'a.jpg'), 1, 'b.jpg');
    expect(t).toEqual([]);
  });
});
