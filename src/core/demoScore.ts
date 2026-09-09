import type { Measure, NoteEvent, ScoreModel, TimelineSegment, Track } from './types';

/**
 * A small, hand-written two-staff score for showcases and unit tests that
 * must not depend on the PDF parser. Eight bars of 3/4 in G major: the first
 * bars of Bach's Menuet in G, right hand melody plus a simple left hand.
 * Layout boxes describe a fake single page of 595x842 points so the UI can
 * draw a playhead over a placeholder page.
 */
export function createDemoScore(): ScoreModel {
  const rh: Array<[number, number]> = [
    // [midi, durationQn]
    [74, 1], [67, 0.5], [69, 0.5], [71, 0.5], [72, 0.5],
    [74, 1], [67, 1], [67, 1],
    [76, 1], [72, 0.5], [74, 0.5], [76, 0.5], [78, 0.5],
    [79, 1], [67, 1], [67, 1],
    [72, 1], [74, 0.5], [72, 0.5], [71, 0.5], [69, 0.5],
    [71, 1], [72, 0.5], [71, 0.5], [69, 0.5], [67, 0.5],
    [66, 1], [67, 0.5], [69, 0.5], [71, 0.5], [67, 0.5],
    [69, 3],
  ];
  const lh: Array<[number[], number]> = [
    [[55, 59, 62], 2], [[57], 1],
    [[59], 1], [[57], 1], [[55], 1],
    [[48], 2], [[52], 1],
    [[47], 1], [[50], 1], [[43], 1],
    [[57], 2], [[54], 1],
    [[55], 2], [[47], 1],
    [[50], 1], [[47], 1], [[50], 1],
    [[62], 1], [[57], 1], [[54], 1],
  ];

  const measureQn = 3;
  const measureCount = 8;
  const pageWidth = 595;
  const staffTop = [120, 200];
  const systemLeft = 60;
  const systemWidth = pageWidth - 120;
  const measureWidth = systemWidth / 4;

  const measures: Measure[] = [];
  for (let i = 0; i < measureCount; i++) {
    const system = Math.floor(i / 4);
    const col = i % 4;
    const x = systemLeft + col * measureWidth;
    measures.push({
      index: i,
      durationQn: measureQn,
      firstStartQn: i * measureQn,
      layout: staffTop.map((top) => ({
        page: 0,
        x,
        y: top + system * 220,
        width: measureWidth,
        height: 40,
      })),
      repeatStart: i === 0,
      repeatEnd: i === measureCount - 1,
    });
  }

  const timeline: TimelineSegment[] = [];
  let qn = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < measureCount; i++) {
      timeline.push({ measure: i, startQn: qn, durationQn: measureQn });
      qn += measureQn;
    }
  }
  const durationQn = qn;

  const notes = (
    trackId: string,
    seq: Array<[number[], number]>,
    staff: number,
  ): NoteEvent[] => {
    const out: NoteEvent[] = [];
    let n = 0;
    for (let pass = 0; pass < 2; pass++) {
      let pos = pass * measureCount * measureQn;
      for (const [pitches, dur] of seq) {
        const measureInPass = Math.floor((pos - pass * measureCount * measureQn) / measureQn);
        const m = measures[measureInPass];
        const box = m.layout[staff];
        const frac = ((pos - pass * measureCount * measureQn) % measureQn) / measureQn;
        for (const midi of pitches) {
          out.push({
            id: `${trackId}-${n++}`,
            trackId,
            midi,
            startQn: pos,
            durationQn: dur,
            velocity: 0.8,
            measure: measureInPass,
            layout: { page: 0, x: box.x + 10 + frac * (box.width - 20), y: box.y + 20 },
          });
        }
        pos += dur;
      }
    }
    return out;
  };

  const tracks: Track[] = [
    {
      id: 'track-1',
      name: 'Right hand',
      instrument: 'piano',
      clef: 'treble',
      staffIndex: 0,
      defaultGain: 0.8,
      notes: notes('track-1', rh.map(([m, d]) => [[m], d]), 0),
    },
    {
      id: 'track-2',
      name: 'Left hand',
      instrument: 'piano',
      clef: 'bass',
      staffIndex: 1,
      defaultGain: 0.7,
      notes: notes('track-2', lh, 1),
    },
  ];

  return {
    title: 'Menuet in G (demo excerpt)',
    composer: 'J. S. Bach (attr. C. Petzold)',
    source: { fileName: 'demo-score.synthetic', pageCount: 1, engine: 'vector' },
    tempoBpm: 108,
    tempoMarks: [{ qn: 0, bpm: 108 }],
    timeSignatures: [{ measure: 0, beats: 3, beatType: 4 }],
    keySignatures: [{ measure: 0, fifths: 1 }],
    measures,
    timeline,
    tracks,
    durationQn,
    warnings: [],
  };
}
