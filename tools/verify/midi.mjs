import fs from 'node:fs';
import { parseMidi } from 'midi-file';

/**
 * Loads a Standard MIDI File into reference tracks:
 *   { ticksPerBeat, tempoBpm, timeSignature, tracks: [{ name, notes: [{ midi, startQn, durationQn }] }] }
 * Tracks without notes are dropped. Times are quarter notes from the start.
 */
export function loadReferenceMidi(file) {
  const midi = parseMidi(fs.readFileSync(file));
  const tpb = midi.header.ticksPerBeat || 480;
  let tempoBpm = 120;
  let timeSignature = null;
  let keyFifths = null;
  const tracks = [];
  for (const events of midi.tracks) {
    let tick = 0;
    let name = '';
    const open = new Map();
    const notes = [];
    for (const ev of events) {
      tick += ev.deltaTime;
      if (ev.type === 'trackName') name = ev.text;
      else if (ev.type === 'setTempo') tempoBpm = Math.round(60_000_000 / ev.microsecondsPerBeat);
      else if (ev.type === 'timeSignature') timeSignature = { beats: ev.numerator, beatType: ev.denominator };
      else if (ev.type === 'keySignature') keyFifths = ev.key;
      else if (ev.type === 'noteOn' && ev.velocity > 0) {
        const k = `${ev.channel}:${ev.noteNumber}`;
        if (!open.has(k)) open.set(k, []);
        open.get(k).push({ tick, velocity: ev.velocity });
      } else if (ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) {
        const k = `${ev.channel}:${ev.noteNumber}`;
        const list = open.get(k);
        if (list && list.length) {
          const start = list.shift();
          notes.push({
            midi: ev.noteNumber,
            startQn: +(start.tick / tpb).toFixed(4),
            durationQn: +((tick - start.tick) / tpb).toFixed(4),
            velocity: start.velocity / 127,
          });
        }
      }
    }
    if (notes.length) {
      notes.sort((a, b) => a.startQn - b.startQn || a.midi - b.midi);
      tracks.push({ name, notes });
    }
  }
  return { ticksPerBeat: tpb, tempoBpm, timeSignature, keyFifths, tracks };
}
