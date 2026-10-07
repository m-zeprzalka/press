/**
 * Test-only Web Audio fakes (Vitest runs in node, which has no Web Audio).
 * They are strict like the real API: non-finite values/times throw, exponential
 * ramps to ≤ 0 throw, sources can be started once and not stopped before start.
 * AudioParams keep an automation timeline that can be evaluated with valueAt().
 *
 * Not imported by production code.
 */

import type { Timers } from './util';

function checkTime(t: number): void {
  if (!Number.isFinite(t) || t < 0) throw new RangeError(`invalid time ${t}`);
}
function checkValue(v: number): void {
  if (!Number.isFinite(v)) throw new TypeError(`non-finite value ${v}`);
}

export interface ParamEvent {
  kind: 'set' | 'linear' | 'exp' | 'target';
  value: number;
  time: number;
  tau?: number;
}

export class FakeParam {
  /** Intrinsic value (what `.value =` sets); the curve starts from it. */
  private base: number;
  private current: number;
  /** Active automation timeline (sorted by time, stable). */
  readonly timeline: ParamEvent[] = [];
  /** Every call, in order, including cancels. */
  readonly log: string[] = [];

  constructor(defaultValue: number) {
    this.base = defaultValue;
    this.current = defaultValue;
  }

  /** Approximation of the real getter: the most recently scheduled value. */
  get value(): number {
    return this.current;
  }
  set value(v: number) {
    checkValue(v);
    this.base = v;
    this.current = v;
  }

  private insert(e: ParamEvent): this {
    let i = this.timeline.length;
    while (i > 0 && (this.timeline[i - 1] as ParamEvent).time > e.time) i--;
    this.timeline.splice(i, 0, e);
    this.current = e.value;
    this.log.push(`${e.kind}:${e.value}@${e.time}`);
    return this;
  }

  setValueAtTime(v: number, t: number): this {
    checkValue(v);
    checkTime(t);
    return this.insert({ kind: 'set', value: v, time: t });
  }
  linearRampToValueAtTime(v: number, t: number): this {
    checkValue(v);
    checkTime(t);
    return this.insert({ kind: 'linear', value: v, time: t });
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    checkValue(v);
    checkTime(t);
    if (v <= 0) throw new RangeError(`exponential ramp to ${v}`);
    return this.insert({ kind: 'exp', value: v, time: t });
  }
  setTargetAtTime(v: number, t: number, tau: number): this {
    checkValue(v);
    checkTime(t);
    if (!(tau > 0)) throw new RangeError(`time constant ${tau}`);
    return this.insert({ kind: 'target', value: v, time: t, tau });
  }
  cancelScheduledValues(t: number): this {
    checkTime(t);
    this.log.push(`cancel@${t}`);
    for (let i = this.timeline.length - 1; i >= 0; i--)
      if ((this.timeline[i] as ParamEvent).time >= t) this.timeline.splice(i, 1);
    return this;
  }
  cancelAndHoldAtTime(t: number): this {
    checkTime(t);
    const v = this.valueAt(t);
    this.log.push(`hold@${t}`);
    for (let i = this.timeline.length - 1; i >= 0; i--)
      if ((this.timeline[i] as ParamEvent).time >= t) this.timeline.splice(i, 1);
    this.timeline.push({ kind: 'set', value: v, time: t });
    this.current = v;
    return this;
  }

  /** Evaluate the automation curve at time T (spec-like, good enough for tests). */
  valueAt(T: number): number {
    let v = this.base;
    let prevT = 0;
    const tl = this.timeline;
    for (let i = 0; i < tl.length; i++) {
      const e = tl[i] as ParamEvent;
      if (e.kind === 'set') {
        if (e.time > T) break;
        v = e.value;
        prevT = e.time;
      } else if (e.kind === 'linear' || e.kind === 'exp') {
        if (e.time <= T) {
          v = e.value;
          prevT = e.time;
          continue;
        }
        const f = e.time > prevT ? (T - prevT) / (e.time - prevT) : 1;
        if (e.kind === 'linear') return v + (e.value - v) * f;
        return v > 0 ? v * Math.pow(e.value / v, f) : v;
      } else {
        if (e.time > T) break;
        const next = tl[i + 1];
        const until = next && next.time <= T ? next.time : T;
        v = e.value + (v - e.value) * Math.exp(-(until - e.time) / (e.tau ?? 1));
        prevT = until;
        if (until === T) return v;
      }
    }
    return v;
  }
}

export class FakeNode {
  readonly outputs: (FakeNode | FakeParam)[] = [];
  disconnected = false;

  constructor(
    readonly ctx: FakeBaseContext,
    readonly kind: string,
  ) {
    ctx.nodes.push(this);
  }

  connect<T extends FakeNode | FakeParam>(dest: T): T {
    if (!dest) throw new TypeError('connect() without destination');
    this.outputs.push(dest);
    return dest;
  }

  disconnect(): void {
    this.outputs.length = 0;
    this.disconnected = true;
  }

  /** All FakeParams owned by this node. */
  params(): FakeParam[] {
    return Object.values(this).filter((v): v is FakeParam => v instanceof FakeParam);
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
  constructor(ctx: FakeBaseContext) {
    super(ctx, 'gain');
  }
}

export class FakeSource extends FakeNode {
  startTime: number | null = null;
  /** ctx.currentTime when start() was called. */
  calledAt = 0;
  readonly stopTimes: number[] = [];
  onended: (() => void) | null = null;

  start(t = 0, offset = 0): void {
    if (this.startTime !== null) throw new Error('InvalidStateError: start() called twice');
    checkTime(t);
    checkTime(offset);
    this.startTime = t;
    this.calledAt = this.ctx.currentTime;
    this.ctx.sources.push(this);
  }

  stop(t = 0): void {
    if (this.startTime === null) throw new Error('InvalidStateError: stop() before start()');
    checkTime(t);
    this.stopTimes.push(t);
  }

  get stopTime(): number {
    return this.stopTimes.length
      ? (this.stopTimes[this.stopTimes.length - 1] as number)
      : Number.POSITIVE_INFINITY;
  }
}

export class FakeOscillator extends FakeSource {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
  constructor(ctx: FakeBaseContext) {
    super(ctx, 'oscillator');
  }
}

export class FakeBuffer {
  private readonly data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    if (!(length > 0) || !(sampleRate > 0)) throw new RangeError('bad buffer');
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(i: number): Float32Array {
    const d = this.data[i];
    if (!d) throw new RangeError('channel');
    return d;
  }
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);
  readonly detune = new FakeParam(0);
  constructor(ctx: FakeBaseContext) {
    super(ctx, 'buffer');
  }
}

export class FakeBiquad extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  readonly gain = new FakeParam(0);
  readonly detune = new FakeParam(0);
  constructor(ctx: FakeBaseContext) {
    super(ctx, 'biquad');
  }
}

export class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
  reduction = 0;
  constructor(ctx: FakeBaseContext) {
    super(ctx, 'compressor');
  }
}

export class FakePanner extends FakeNode {
  readonly pan = new FakeParam(0);
  constructor(ctx: FakeBaseContext) {
    super(ctx, 'panner');
  }
}

export class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = 'none';
  constructor(ctx: FakeBaseContext) {
    super(ctx, 'shaper');
  }
}

export class FakeDelay extends FakeNode {
  readonly delayTime = new FakeParam(0);
  constructor(ctx: FakeBaseContext) {
    super(ctx, 'delay');
  }
}

export class FakeBaseContext {
  currentTime = 0;
  readonly destination: FakeNode;
  readonly nodes: FakeNode[] = [];
  readonly sources: FakeSource[] = [];

  constructor(readonly sampleRate: number) {
    this.destination = new FakeNode(this, 'destination');
  }

  createGain(): FakeGain {
    return new FakeGain(this);
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }
  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this);
  }
  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this);
  }
  createStereoPanner(): FakePanner {
    return new FakePanner(this);
  }
  createWaveShaper(): FakeShaper {
    return new FakeShaper(this);
  }
  createDelay(_max = 1): FakeDelay {
    return new FakeDelay(this);
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }

  count(kind: string): number {
    return this.nodes.filter((n) => n.kind === kind).length;
  }
}

export class FakeAudioContext extends FakeBaseContext {
  state: AudioContextState = 'running';
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  /** resume() never settles and the state stays 'suspended' (Chrome without a gesture). */
  autoplayBlocked = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly options?: AudioContextOptions,
    initialState: AudioContextState = 'running',
  ) {
    super(48000);
    this.state = initialState;
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.state === 'closed') return Promise.reject(new Error('InvalidStateError: closed'));
    if (this.autoplayBlocked) return new Promise<void>(() => undefined);
    this.setState('running');
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCalls++;
    if (this.state === 'closed') return Promise.reject(new Error('InvalidStateError: closed'));
    this.setState('suspended');
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls++;
    this.setState('closed');
    return Promise.resolve();
  }

  addEventListener(type: string, fn: () => void): void {
    if (type === 'statechange') this.listeners.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    if (type === 'statechange') this.listeners.delete(fn);
  }

  /** Advance the audio clock (frozen unless running, like the real thing). */
  advance(dt: number): void {
    if (this.state === 'running') this.currentTime += dt;
  }

  setState(s: AudioContextState): void {
    if (this.state === s) return;
    this.state = s;
    for (const l of this.listeners) l();
  }
}

export class FakeOfflineContext extends FakeBaseContext {
  oncomplete: ((e: { renderedBuffer: FakeBuffer }) => void) | null = null;
  result: FakeBuffer | null = null;

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    sampleRate: number,
  ) {
    super(sampleRate);
  }

  startRendering(): Promise<FakeBuffer> {
    this.result = new FakeBuffer(this.numberOfChannels, this.length, this.sampleRate);
    return Promise.resolve(this.result);
  }
}

/** Deterministic manual timers (ms). */
export class ManualTimers implements Timers {
  now = 0;
  readonly intervalsCreated: number[] = [];
  private seq = 0;
  private readonly q = new Map<number, { at: number; fn: () => void; every: number | null }>();

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.q.set(id, { at: this.now + ms, fn, every: null });
    return id;
  }
  clearTimeout(id: unknown): void {
    this.q.delete(id as number);
  }
  setInterval(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.intervalsCreated.push(ms);
    this.q.set(id, { at: this.now + ms, fn, every: ms });
    return id;
  }
  clearInterval(id: unknown): void {
    this.q.delete(id as number);
  }

  get activeIntervals(): number {
    let n = 0;
    for (const t of this.q.values()) if (t.every !== null) n++;
    return n;
  }

  /** Run every timer due within the next `ms` milliseconds, in time order. */
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let nextId = -1;
      let next: { at: number; fn: () => void; every: number | null } | null = null;
      for (const [id, t] of this.q) {
        if (t.at <= end && (!next || t.at < next.at)) {
          next = t;
          nextId = id;
        }
      }
      if (!next) break;
      this.now = Math.max(this.now, next.at);
      if (next.every !== null) next.at += Math.max(1, next.every);
      else this.q.delete(nextId);
      next.fn();
    }
    this.now = end;
  }
}

/** Fake `document` for visibilitychange. */
export class FakeDoc {
  hidden = false;
  private readonly fns = new Set<() => void>();
  addEventListener(_type: 'visibilitychange', fn: () => void): void {
    this.fns.add(fn);
  }
  removeEventListener(_type: 'visibilitychange', fn: () => void): void {
    this.fns.delete(fn);
  }
  get listenerCount(): number {
    return this.fns.size;
  }
  setHidden(h: boolean): void {
    this.hidden = h;
    for (const f of this.fns) f();
  }
}

export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
