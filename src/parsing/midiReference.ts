import type { Reference, RefNote, RefTrack } from './compare';

/**
 * Minimal Standard MIDI File reader (formats 0/1, running status, meta events)
 * producing the same reduction as tools/verify/midi.mjs, so the showcase can
 * compare against the fixture MIDI in the browser without a dependency.
 */
export function parseReferenceMidi(data: Uint8Array): Reference {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const ascii = (at: number, len: number): string => String.fromCharCode(...data.subarray(at, at + len));
  if (data.length < 14 || ascii(0, 4) !== 'MThd') throw new Error('Not a Standard MIDI File.');
  const headerLength = view.getUint32(4);
  const division = view.getUint16(12);
  const tpb = division & 0x8000 ? 480 : division || 480;
  const trackCount = view.getUint16(10);
  pos = 8 + headerLength;

  let tempoBpm = 120;
  let timeSignature: Reference['timeSignature'] = null;
  let keyFifths: number | null = null;
  const tracks: RefTrack[] = [];

  for (let t = 0; t < trackCount && pos + 8 <= data.length; t++) {
    if (ascii(pos, 4) !== 'MTrk') break;
    const length = view.getUint32(pos + 4);
    let p = pos + 8;
    const end = Math.min(data.length, p + length);
    pos = end;

    const readVar = (): number => {
      let value = 0;
      for (let i = 0; i < 4 && p < end; i++) {
        const b = data[p++];
        value = (value << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return value;
    };

    let tick = 0;
    let name = '';
    let status = 0;
    const open = new Map<string, Array<{ tick: number; velocity: number }>>();
    const notes: RefNote[] = [];
    while (p < end) {
      tick += readVar();
      let b = data[p];
      if (b & 0x80) {
        status = b;
        p++;
      } else b = status;
      if (b === 0xff) {
        const type = data[p++];
        const len = readVar();
        const start = p;
        p += len;
        if (type === 0x03) name = ascii(start, len);
        else if (type === 0x51 && len >= 3) {
          const us = (data[start] << 16) | (data[start + 1] << 8) | data[start + 2];
          if (us > 0) tempoBpm = Math.round(60_000_000 / us);
        } else if (type === 0x58 && len >= 2) timeSignature = { beats: data[start], beatType: 2 ** data[start + 1] };
        else if (type === 0x59 && len >= 1) keyFifths = (data[start] << 24) >> 24;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        p += readVar();
        continue;
      }
      const kind = b & 0xf0;
      const channel = b & 0x0f;
      if (kind === 0xc0 || kind === 0xd0) {
        p += 1;
        continue;
      }
      const d1 = data[p++];
      const d2 = data[p++];
      if (kind === 0x90 && d2 > 0) {
        const k = `${channel}:${d1}`;
        if (!open.has(k)) open.set(k, []);
        open.get(k)!.push({ tick, velocity: d2 });
      } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
        const list = open.get(`${channel}:${d1}`);
        if (list && list.length) {
          const on = list.shift()!;
          notes.push({
            midi: d1,
            startQn: +(on.tick / tpb).toFixed(4),
            durationQn: +((tick - on.tick) / tpb).toFixed(4),
            velocity: on.velocity / 127,
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
