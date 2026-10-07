import { describe, expect, it } from 'vitest';
import { makeNoiseBuffer, type SynthKit } from './dsp';
import { FakeBaseContext, FakeGain, FakeOscillator, type FakeSource } from './fakeAudio';
import { Prng } from './prng';
import { SFX } from './sfx';
import { SFX_LIST } from './types';

function kitFor(ctx: FakeBaseContext): { kit: SynthKit; tracked: FakeSource[] } {
  const tracked: FakeSource[] = [];
  const c = ctx as unknown as BaseAudioContext;
  const kit: SynthKit = {
    c,
    noise: makeNoiseBuffer(c, 1, 1),
    rng: new Prng(1),
    sink: { track: (s) => tracked.push(s as unknown as FakeSource) },
  };
  return { kit, tracked };
}

describe('SFX recipes', () => {
  for (const sfx of SFX_LIST) {
    it(`${sfx}: valid automation, bounded duration, envelopes return to 0`, () => {
      const def = SFX[sfx];
      const variants = def.heavy?.variants ?? 1;
      for (let variant = 0; variant < variants; variant++) {
        for (const pitch of [-12, 0, 7, 24]) {
          const ctx = new FakeBaseContext(48000);
          const { kit, tracked } = kitFor(ctx);
          const out = ctx.createGain();
          const t = 0.25;
          // Fakes throw on NaN/Infinity, negative times and exp ramps to 0.
          const end = def.recipe(kit, out as unknown as AudioNode, t, pitch, 1, variant);
          expect(Number.isFinite(end)).toBe(true);
          expect(end).toBeGreaterThan(t);
          expect(end - t).toBeLessThan(2.5);
          if (def.heavy) expect(end).toBeLessThanOrEqual(t + def.heavy.dur); // pre-render buffer is long enough

          expect(ctx.sources.length).toBeGreaterThan(0);
          // Every source is tracked (stealable), starts at/after t, and stops by `end`.
          expect(tracked.length).toBe(ctx.sources.length);
          for (const s of ctx.sources) {
            expect(s.startTime).toBeGreaterThanOrEqual(t - 1e-9);
            expect(s.stopTime).toBeLessThanOrEqual(end + 1e-9);
          }
          // Amplitude envelopes (gains starting from 0) end at exactly 0, before `end`.
          for (const n of ctx.nodes) {
            if (!(n instanceof FakeGain)) continue;
            const tl = n.gain.timeline;
            if (tl.length === 0 || tl[0]!.value !== 0) continue;
            const last = tl[tl.length - 1]!;
            expect(last.value === 0 || last.kind === 'target').toBe(true);
            expect(n.gain.valueAt(end)).toBeLessThan(1e-3);
          }
        }
      }
    });
  }

  it('streak_up climbs the pentatonic with the streak step', () => {
    let prev = 0;
    for (let step = 0; step <= 12; step++) {
      const ctx = new FakeBaseContext(48000);
      const { kit } = kitFor(ctx);
      SFX.streak_up.recipe(kit, ctx.createGain() as unknown as AudioNode, 0, step, 1, 0);
      const carrier = ctx.nodes.find((n): n is FakeOscillator => n instanceof FakeOscillator)!;
      const f = carrier.frequency.timeline[0]!.value;
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
  });

  it('print variants get heavier with intensity (longer ring)', () => {
    const ends = [0, 1, 2].map((v) => {
      const ctx = new FakeBaseContext(48000);
      const { kit } = kitFor(ctx);
      return SFX.print.recipe(kit, ctx.createGain() as unknown as AudioNode, 0, 0, 1, v);
    });
    expect(ends[0]!).toBeLessThan(ends[1]!);
    expect(ends[1]!).toBeLessThan(ends[2]!);
  });
});
