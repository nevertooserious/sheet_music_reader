import { describe, expect, it } from 'vitest';
import { createEnsembleScore, createShowcaseScore, pageInfos } from './showcaseScores';

describe('createEnsembleScore', () => {
  const score = createEnsembleScore({ pages: 24, staves: 6, fileName: 'x.pdf' });

  it('tiles eight bars per page across every staff', () => {
    expect(score.measures).toHaveLength(192);
    expect(score.tracks).toHaveLength(6);
    expect(score.durationQn).toBe(192 * 3);
    expect(score.timeline).toHaveLength(192);
    expect(score.measures[8].layout[0].page).toBe(1);
    expect(score.measures[191].layout[5].page).toBe(23);
    expect(score.measures.every((m) => m.layout.length === 6)).toBe(true);
  });

  it('keeps every note inside its measure and on the measure page', () => {
    for (const track of score.tracks) {
      for (const note of track.notes) {
        const measure = score.measures[note.measure];
        const box = measure.layout[track.staffIndex];
        expect(note.startQn).toBeGreaterThanOrEqual(measure.firstStartQn);
        expect(note.startQn).toBeLessThan(measure.firstStartQn + measure.durationQn);
        expect(note.layout?.page).toBe(box.page);
        expect(note.layout!.x).toBeGreaterThanOrEqual(box.x);
        expect(note.layout!.x).toBeLessThanOrEqual(box.x + box.width);
      }
    }
  });

  it('fits two systems of six staves on a page', () => {
    const lastBox = score.measures[7].layout[5];
    expect(lastBox.y + lastBox.height).toBeLessThan(842);
  });

  it('names extra staves beyond the part list', () => {
    const big = createEnsembleScore({ pages: 1, staves: 7, fileName: 'x.pdf' });
    expect(big.tracks[6].name).toBe('Flute 2');
  });
});

describe('createShowcaseScore / pageInfos', () => {
  it('keeps the demo structure and adds warnings', () => {
    const score = createShowcaseScore();
    expect(score.measures).toHaveLength(8);
    expect(score.warnings).toHaveLength(3);
    expect(score.tracks[0].notes[0].layout?.y).not.toBe(140);
  });

  it('describes pages at PDF letter-ish size', () => {
    expect(pageInfos(2)).toEqual([
      { index: 0, width: 595, height: 842 },
      { index: 1, width: 595, height: 842 },
    ]);
  });
});
