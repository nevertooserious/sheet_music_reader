import type { AppController, AudioEngine, ScoreDocument, ScoreParser } from './contracts';
import type { WritableStore } from './store';

export const DEMO_URL = `${import.meta.env.BASE_URL}fixtures/bach-minuet-g.pdf`;
export const DEMO_FILE_NAME = 'Bach - Menuet in G (BWV Anh. 114).pdf';

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createController(
  store: WritableStore,
  parser: ScoreParser,
  engine: AudioEngine,
): AppController {
  let doc: ScoreDocument | undefined;
  let loadSeq = 0;

  engine.subscribe((transport) => store.setState({ transport }));

  function beginLoad(fileName: string): number {
    engine.pause();
    store.setState({ status: 'loading', fileName, error: undefined, progress: undefined });
    return ++loadSeq;
  }

  async function parseInto(seq: number, data: ArrayBuffer, fileName: string): Promise<void> {
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
    const next = await parser.parse(data, {
      fileName,
      onProgress: (progress) => {
        if (seq === loadSeq) store.setState({ progress });
      },
    });
    if (seq !== loadSeq) {
      next.dispose();
      return;
    }
    try {
      engine.load(next.score);
    } catch (err) {
      next.dispose();
      throw err;
    }
    doc = next;
    store.setState({
      status: 'ready',
      score: next.score,
      pages: next.pages,
      progress: undefined,
      transport: engine.getState(),
    });
  }

  async function runLoad(seq: number, fileName: string, read: () => Promise<ArrayBuffer>): Promise<void> {
    try {
      const data = await read();
      if (seq !== loadSeq) return;
      await parseInto(seq, data, fileName);
    } catch (err) {
      if (seq !== loadSeq) return;
      store.setState({ status: 'error', error: errorMessage(err), progress: undefined });
      throw err;
    }
  }

  return {
    loadFile(file) {
      const seq = beginLoad(file.name);
      return runLoad(seq, file.name, () => file.arrayBuffer());
    },
    loadArrayBuffer(data, fileName) {
      const seq = beginLoad(fileName);
      return runLoad(seq, fileName, async () => data);
    },
    loadDemo() {
      const seq = beginLoad(DEMO_FILE_NAME);
      return runLoad(seq, DEMO_FILE_NAME, async () => {
        const res = await fetch(DEMO_URL);
        if (!res.ok) throw new Error(`Demo fetch failed: ${res.status}`);
        return res.arrayBuffer();
      });
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
