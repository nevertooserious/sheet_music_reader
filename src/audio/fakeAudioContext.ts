/**
 * Minimal Web Audio double for unit tests: records automation, tracks node graphs and fires
 * `onended` when the fake clock passes an oscillator's stop time. `FakeAudioParam.valueAt`
 * evaluates set/ramp/target/hold automation so tests can check envelope continuity.
 */

export type ParamEventKind = 'set' | 'ramp' | 'exp' | 'target' | 'hold';

export interface ParamEvent {
  kind: ParamEventKind;
  time: number;
  value: number;
  tau?: number;
}

export class FakeAudioParam {
  events: ParamEvent[] = [];
  constructor(public value: number) {}

  setValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'set', time, value });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'ramp', time, value });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'exp', time, value });
    return this;
  }

  setTargetAtTime(value: number, time: number, tau: number): this {
    this.events.push({ kind: 'target', time, value, tau });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.events = this.events.filter((e) => e.time < time);
    return this;
  }

  cancelAndHoldAtTime(time: number): this {
    const held = this.valueAt(time);
    this.events = this.events.filter((e) => e.time < time);
    this.events.push({ kind: 'hold', time, value: held });
    return this;
  }

  /** Value the automation produces at `t`, following the Web Audio semantics of the recorded events. */
  valueAt(t: number): number {
    const events = [...this.events].sort((a, b) => a.time - b.time);
    let tPrev = -Infinity;
    let vPrev = this.value;
    let target: { value: number; tau: number } | undefined;
    const between = (time: number, next?: ParamEvent): number => {
      if (next && (next.kind === 'ramp' || next.kind === 'exp')) {
        if (!Number.isFinite(tPrev) || next.time <= tPrev) return next.value;
        return vPrev + (next.value - vPrev) * ((time - tPrev) / (next.time - tPrev));
      }
      if (target && Number.isFinite(tPrev)) return target.value + (vPrev - target.value) * Math.exp(-(time - tPrev) / target.tau);
      return vPrev;
    };
    for (const e of events) {
      if (e.time > t) return between(t, e);
      const reached = between(e.time, e);
      if (e.kind === 'target') {
        vPrev = reached;
        target = { value: e.value, tau: e.tau ?? 0.01 };
      } else if (e.kind === 'hold') {
        vPrev = reached;
        target = undefined;
      } else {
        vPrev = e.value;
        target = undefined;
      }
      tPrev = e.time;
    }
    return between(t);
  }
}

export class FakeAudioNode {
  outputs: FakeAudioNode[] = [];
  /** Every node this one was ever connected to; survives disconnect() so torn-down voices stay identifiable. */
  everConnected: FakeAudioNode[] = [];
  constructor(readonly context: FakeBaseAudioContext) {}

  connect<T extends FakeAudioNode>(destination: T): T {
    this.outputs.push(destination);
    this.everConnected.push(destination);
    return destination;
  }

  disconnect(): void {
    this.outputs = [];
  }
}

export class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam(1);
}

export class FakeOscillatorNode extends FakeAudioNode {
  type: OscillatorType = 'sine';
  frequency = new FakeAudioParam(440);
  detune = new FakeAudioParam(0);
  startTime: number | undefined;
  stopTime: number | undefined;
  stopCalls = 0;
  ended = false;
  onended: (() => void) | null = null;

  start(when = 0): void {
    if (this.startTime !== undefined) throw new Error('InvalidStateError: start() called twice');
    this.startTime = when;
  }

  stop(when = 0): void {
    this.stopCalls++;
    this.stopTime = when;
  }
}

export class FakeAudioBufferSourceNode extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  playbackRate = new FakeAudioParam(1);
  loop = false;
  startTime: number | undefined;
  offset = 0;
  stopTime: number | undefined;
  stopCalls = 0;
  ended = false;
  onended: (() => void) | null = null;

  start(when = 0, offset = 0): void {
    if (this.startTime !== undefined) throw new Error('InvalidStateError: start() called twice');
    this.startTime = when;
    this.offset = offset;
  }

  stop(when = 0): void {
    this.stopCalls++;
    this.stopTime = when;
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = 'lowpass';
  frequency = new FakeAudioParam(350);
  Q = new FakeAudioParam(1);
}

export class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  /** Constant sample value handed out by getFloatTimeDomainData, so tests can drive meters. */
  level = 0;

  getFloatTimeDomainData(array: Float32Array): void {
    array.fill(this.level);
  }

  getByteFrequencyData(array: Uint8Array): void {
    array.fill(0);
  }
}

export class FakeDynamicsCompressorNode extends FakeAudioNode {
  threshold = new FakeAudioParam(-24);
  knee = new FakeAudioParam(30);
  ratio = new FakeAudioParam(12);
  attack = new FakeAudioParam(0.003);
  release = new FakeAudioParam(0.25);
}

export class FakeStereoPannerNode extends FakeAudioNode {
  pan = new FakeAudioParam(0);
}

export class FakeAudioBuffer {
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

export class FakeBaseAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  destination = new FakeAudioNode(this);
  gains: FakeGainNode[] = [];
  oscillators: FakeOscillatorNode[] = [];
  sources: FakeAudioBufferSourceNode[] = [];
  filters: FakeBiquadFilterNode[] = [];
  analysers: FakeAnalyserNode[] = [];
  panners: FakeStereoPannerNode[] = [];
  compressors: FakeDynamicsCompressorNode[] = [];

  createGain(): FakeGainNode {
    const node = new FakeGainNode(this);
    this.gains.push(node);
    return node;
  }

  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode(this);
    this.oscillators.push(node);
    return node;
  }

  createBufferSource(): FakeAudioBufferSourceNode {
    const node = new FakeAudioBufferSourceNode(this);
    this.sources.push(node);
    return node;
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    const node = new FakeBiquadFilterNode(this);
    this.filters.push(node);
    return node;
  }

  createAnalyser(): FakeAnalyserNode {
    const node = new FakeAnalyserNode(this);
    this.analysers.push(node);
    return node;
  }

  createDynamicsCompressor(): FakeDynamicsCompressorNode {
    const node = new FakeDynamicsCompressorNode(this);
    this.compressors.push(node);
    return node;
  }

  createStereoPanner(): FakeStereoPannerNode {
    const node = new FakeStereoPannerNode(this);
    this.panners.push(node);
    return node;
  }

  /** Moves the clock and ends oscillators and buffer sources whose stop time has passed. */
  advance(seconds: number): void {
    this.currentTime += seconds;
    for (const node of [...this.oscillators, ...this.sources]) {
      if (!node.ended && node.stopTime !== undefined && node.stopTime <= this.currentTime) {
        node.ended = true;
        node.onended?.();
      }
    }
  }

  /** Voice envelopes are the gain nodes feeding a filter. */
  envelopeParams(): FakeAudioParam[] {
    return this.gains.filter((g) => g.everConnected.some((o) => o instanceof FakeBiquadFilterNode)).map((g) => g.gain);
  }

  /** Track bus inputs feed a 256-point analyser (live) or a panner/master directly (offline). */
  trackBusParams(): FakeAudioParam[] {
    return this.gains
      .filter((g) => g.everConnected.some((o) => (o instanceof FakeAnalyserNode && o.fftSize === 256) || o instanceof FakeStereoPannerNode))
      .map((g) => g.gain);
  }
}

export type ResumeMode = 'resolve' | 'hang' | 'reject';

export class FakeAudioContext extends FakeBaseAudioContext {
  state: AudioContextState = 'suspended';
  baseLatency = 0.01;
  resumeCalls = 0;
  resumeMode: ResumeMode = 'resolve';
  private listeners = new Set<() => void>();

  addEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.listeners.delete(listener);
  }

  setState(state: AudioContextState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.state === 'closed') return Promise.reject(new Error('The AudioContext is closed.'));
    if (this.resumeMode === 'hang') return new Promise(() => undefined);
    if (this.resumeMode === 'reject') return Promise.reject(new Error('Autoplay blocked.'));
    this.setState('running');
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.setState('suspended');
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.setState('closed');
    return Promise.resolve();
  }
}

export class FakeOfflineAudioContext extends FakeBaseAudioContext {
  rendered = false;

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    sampleRate: number,
  ) {
    super();
    this.sampleRate = sampleRate;
  }

  startRendering(): Promise<FakeAudioBuffer> {
    this.rendered = true;
    return Promise.resolve(new FakeAudioBuffer(this.numberOfChannels, this.length, this.sampleRate));
  }
}
