import type { AppController, AudioEngine, ScoreDocument, ScoreParser } from './contracts';
import type { WritableStore } from './store';
import type { PageInfo } from './types';

export const DEMO_URL = '/fixtures/bach-minuet-g.pdf';
export const DEMO_FILE_NAME = 'Bach - Menuet in G (BWV Anh. 114).pdf';

export function createController(
  store: WritableStore,
  parser: ScoreParser,
  engine: AudioEngine,
): AppController {
  let doc: ScoreDocument | undefined;

  engine.subscribe((transport) => store.setState({ transport }));

  async function loadArrayBuffer(data: ArrayBuffer, fileName: string): Promise<void> {
    engine.stop();
    doc?.dispose();
    doc = undefined;
    store.setState({
      status: 'parsing',
      fileName,
      error: undefined,
      score: undefined,
      pages: [],
      progress: { fraction: 0, stage: 'Opening PDF' },
    });
    try {
      const next = await parser.parse(data, {
        fileName,
        onProgress: (progress) => store.setState({ progress }),
      });
      doc = next;
      engine.load(next.score);
      const pages: PageInfo[] = next.pages;
      store.setState({
        status: 'ready',
        score: next.score,
        pages,
        progress: undefined,
        transport: engine.getState(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.setState({ status: 'error', error: message, progress: undefined });
      throw err;
    }
  }

  return {
    async loadFile(file) {
      store.setState({ status: 'loading', fileName: file.name, error: undefined });
      const data = await file.arrayBuffer();
      await loadArrayBuffer(data, file.name);
    },
    loadArrayBuffer,
    async loadDemo() {
      store.setState({ status: 'loading', fileName: DEMO_FILE_NAME, error: undefined });
      const res = await fetch(DEMO_URL);
      if (!res.ok) {
        const message = `Demo fetch failed: ${res.status}`;
        store.setState({ status: 'error', error: message });
        throw new Error(message);
      }
      await loadArrayBuffer(await res.arrayBuffer(), DEMO_FILE_NAME);
    },
    play: () => engine.play(),
    pause: () => engine.pause(),
    stop: () => engine.stop(),
    async togglePlay() {
      if (engine.getState().playing) engine.pause();
      else await engine.play();
    },
    seek: (qn) => engine.seek(qn),
    seekToMeasure(measureIndex) {
      const score = store.getState().score;
      const measure = score?.measures[measureIndex];
      if (measure) engine.seek(measure.firstStartQn);
    },
    setTempo: (bpm) => engine.setTempo(bpm),
    setMasterGain: (gain) => engine.setMasterGain(gain),
    setTrackGain: (id, gain) => engine.setTrackGain(id, gain),
    setTrackMuted: (id, muted) => engine.setTrackMuted(id, muted),
    setTrackSolo: (id, solo) => engine.setTrackSolo(id, solo),
    async renderPage(pageIndex, canvas, scale) {
      if (!doc) throw new Error('No document loaded');
      await doc.renderPage(pageIndex, canvas, scale);
    },
  };
}
