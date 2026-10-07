import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer, DORIAN_PITCH_CLASSES, INST, MACHINE_ORDER, type Style } from './composer';

type Ev = { step: number; inst: number; midi: number; vel: number; dur: number; delay: number; pan: number };

function render(
  c: Composer,
  from: number,
  to: number,
  style: Style = 'game',
  drums = true,
  machine = 0,
): Ev[] {
  const out: Ev[] = [];
  for (let step = from; step < to; step++) {
    const n = c.compose(step, style, drums, machine);
    for (let i = 0; i < n; i++) out.push({ step, ...c.events[i]! });
  }
  return out;
}

const PITCHED: number[] = [INST.BASS, INST.KEYS, INST.BELL];
const KIT: number[] = [INST.KICK, INST.SNARE, INST.HAT, INST.OHAT, INST.CLANK, INST.THUMP, INST.FEED];
const MACHINE: number[] = [INST.CLANK, INST.THUMP, INST.FEED];

afterEach(() => vi.restoreAllMocks());

describe('Composer', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = render(new Composer(42), 0, 64 * 16);
    const b = render(new Composer(42), 0, 64 * 16);
    const c = render(new Composer(43), 0, 64 * 16);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('never calls Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    render(new Composer(7), 0, 32 * 16, 'game', true, 0.7);
    render(new Composer(7), 0, 32 * 16, 'menu', false, 0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('is history-independent (skipping ahead yields the same music)', () => {
    const seq = new Composer(99);
    const full = render(seq, 0, 80 * 16);
    const jumped = render(new Composer(99), 61 * 16, 63 * 16);
    expect(jumped).toEqual(full.filter((e) => e.step >= 61 * 16 && e.step < 63 * 16));
  });

  it('stays in D Dorian', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const evs = [
        ...render(new Composer(seed), 0, 48 * 16),
        ...render(new Composer(seed), 0, 48 * 16, 'menu', false),
      ];
      for (const e of evs)
        if (PITCHED.includes(e.inst)) expect(DORIAN_PITCH_CLASSES.has(((e.midi % 12) + 12) % 12)).toBe(true);
    }
  });

  it('menu mode is sparse: keys and soft bass, no drums or machine', () => {
    const evs = render(new Composer(5), 0, 32 * 16, 'menu', false, 1);
    expect(evs.some((e) => e.inst === INST.KEYS)).toBe(true);
    expect(evs.some((e) => e.inst === INST.BASS)).toBe(true);
    expect(evs.filter((e) => KIT.includes(e.inst))).toEqual([]);
    const game = render(new Composer(5), 0, 32 * 16, 'game', true, 0);
    expect(evs.length).toBeLessThan(game.length / 2);
  });

  it('game mode has kick, snare, hats, bass and keys', () => {
    const evs = render(new Composer(11), 0, 16 * 16);
    for (const inst of [INST.KICK, INST.SNARE, INST.HAT, INST.BASS, INST.KEYS]) {
      expect(evs.some((e) => e.inst === inst)).toBe(true);
    }
    // Backbeat: snare on 2 and 4 of every bar.
    for (let bar = 0; bar < 16; bar++) {
      for (const s of [4, 12])
        expect(evs.some((e) => e.inst === INST.SNARE && e.step === bar * 16 + s)).toBe(true);
    }
  });

  it('machine layer density follows intensity: none at 0, busy 16ths at 1', () => {
    const perBar = (machine: number) => {
      const evs = render(new Composer(3), 0, 8 * 16, 'game', true, machine).filter((e) =>
        MACHINE.includes(e.inst),
      );
      return evs.length / 8;
    };
    expect(perBar(0)).toBe(0);
    expect(perBar(1)).toBe(16);
    expect(perBar(0.5)).toBe(8);
    let prev = -1;
    for (let d = 0; d <= 1.0001; d += 0.125) {
      const n = perBar(d);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    // Low intensity starts with the press "ka-chunk" on offbeat 8ths.
    const low = render(new Composer(3), 0, 16, 'game', true, 2 / 16).filter((e) => MACHINE.includes(e.inst));
    expect(low.map((e) => e.step % 16).sort((a, b) => a - b)).toEqual(
      [...MACHINE_ORDER.slice(0, 2)].sort((a, b) => a - b),
    );
  });

  it('does not loop audibly: phrases of 8–16 bars with varied bars', () => {
    const c = new Composer(2024);
    const starts = new Set<number>();
    for (let bar = 0; bar < 200; bar++) {
      const p = c.phraseInfo(bar);
      expect([8, 16]).toContain(p.len);
      starts.add(p.start);
    }
    expect(starts.size).toBeGreaterThan(10);
    const evs = render(new Composer(2024), 0, 64 * 16);
    const sig = (bar: number) =>
      JSON.stringify(
        evs.filter((e) => Math.floor(e.step / 16) === bar).map((e) => [e.inst, e.midi, e.step % 16]),
      );
    const sigs = new Set(Array.from({ length: 64 }, (_, b) => sig(b)));
    expect(sigs.size).toBeGreaterThan(40);
    const block = (from: number) => Array.from({ length: 16 }, (_, i) => sig(from + i)).join('|');
    expect(block(0)).not.toBe(block(16));
    expect(block(16)).not.toBe(block(32));
  });

  it('starts fresh music on a phrase boundary on the tonic chord', () => {
    const c = new Composer(77);
    for (const bar of [0, 1, 5, 9, 23, 57]) {
      const start = c.nextPhraseStart(bar);
      expect(start).toBeGreaterThanOrEqual(bar);
      expect(c.phraseInfo(start).start).toBe(start);
    }
    expect(c.chordAt(0)).toBe(0); // Dm9
  });

  it('writes into a fixed event pool (no per-step allocation of events)', () => {
    const c = new Composer(1);
    const pool = c.events;
    const first = pool[0];
    render(c, 0, 4 * 16, 'game', true, 1);
    expect(c.events).toBe(pool);
    expect(c.events[0]).toBe(first);
  });
});
