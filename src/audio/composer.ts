/**
 * Generative lo-fi "print-shop groove" — the pure composition layer.
 *
 * compose(step) returns the notes of one 16th-note grid step. Every decision is a
 * pure function of (seed, phrase, bar, step) through hash-seeded PRNGs — no
 * Math.random, no history — so the scheduler can skip ahead (tab throttling,
 * resume) and the music continues exactly as if it had played through.
 *
 * Structure: 92 BPM, swung 16ths, D Dorian. Phrases of 8 or 16 bars, each with its
 * own 4-chord progression, bass riff (2-bar), comping rhythm, kick pattern and hat
 * feel; bars vary those (substitute chords, inversions, alternative patterns,
 * melodic sprinkles, ghost notes, end-of-phrase fills) so it never loops audibly.
 * The "machine" layer (press clanks → busy 16ths) is added by density 0..1.
 *
 * Writes into a preallocated event pool: no allocation per step.
 */

import { hash32, Prng } from './prng';

export const BPM = 92;
/** Seconds per 16th note. */
export const STEP = 60 / BPM / 4;
/** Odd 16ths are delayed by this fraction of a step (≈ 60 % swing). */
export const SWING = 0.2;
export const STEPS_PER_BAR = 16;

export const INST = {
  KICK: 0,
  SNARE: 1,
  HAT: 2,
  OHAT: 3,
  BASS: 4,
  KEYS: 5,
  BELL: 6,
  CLANK: 7,
  THUMP: 8,
  FEED: 9,
} as const;
export type Inst = (typeof INST)[keyof typeof INST];

export interface MusicEvent {
  inst: Inst;
  midi: number;
  /** 0..1 */
  vel: number;
  /** Seconds. */
  dur: number;
  /** Seconds after the step time (humanising, strums). */
  delay: number;
  /** -1..1 (machine layer). */
  pan: number;
}

export type Style = 'menu' | 'game';

/** D Dorian intervals from D. */
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
/** Pitch classes of D Dorian (D E F G A B C). */
export const DORIAN_PITCH_CLASSES: ReadonlySet<number> = new Set([2, 4, 5, 7, 9, 11, 0]);

/** Scale degree (0 = D2) → MIDI note. */
export function dorian(deg: number): number {
  const o = Math.floor(deg / 7);
  return 38 + 12 * o + (DORIAN[deg - o * 7] ?? 0);
}

interface Chord {
  /** Root as a Dorian degree (0 = D). */
  root: number;
  /** Electric-piano voicing (MIDI), low → high, rootless. */
  voicing: readonly [number, number, number, number];
}

const CHORDS: readonly Chord[] = [
  { root: 0, voicing: [53, 57, 60, 64] }, // 0 Dm9   (F A C E)
  { root: 1, voicing: [55, 59, 62, 64] }, // 1 Em7   (G B D E)
  { root: 2, voicing: [52, 55, 57, 60] }, // 2 Fmaj9 (E G A C)
  { root: 3, voicing: [53, 59, 64, 69] }, // 3 G13   (F B E A)
  { root: 3, voicing: [53, 57, 59, 62] }, // 4 G9    (F A B D)
  { root: 4, voicing: [55, 60, 64, 67] }, // 5 Am7   (G C E G)
  { root: -1, voicing: [52, 55, 59, 62] }, // 6 Cmaj9 (E G B D)
];

/** Four-chord progressions (one chord per bar). */
const PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 3, 1, 5], // Dm9 G13 Em7 Am7
  [0, 4, 2, 6], // Dm9 G9 Fmaj9 Cmaj9
  [0, 1, 2, 3], // Dm9 Em7 Fmaj9 G13
  [2, 1, 0, 4], // Fmaj9 Em7 Dm9 G9
];
/** Substitute for the 4th chord of a cycle (gentle variation). */
const SUBS = [2, 5, 0, 4, 3, 6, 5];

/** Bass note: [step, degree above chord root | APPROACH, length in steps, velocity]. */
type BassNote = readonly [number, number, number, number];
const APPROACH = 100;
/** 2-bar riffs: [bar A, bar B]. Bar B ends with a diatonic approach to the next root. */
const RIFFS: readonly (readonly [readonly BassNote[], readonly BassNote[]])[] = [
  [
    [
      [0, 0, 3, 1],
      [3, 0, 1, 0.55],
      [6, 7, 2, 0.7],
      [10, 4, 2, 0.85],
      [14, 0, 1, 0.5],
    ],
    [
      [0, 0, 3, 1],
      [6, 4, 1, 0.6],
      [8, 6, 2, 0.7],
      [11, 4, 2, 0.75],
      [14, APPROACH, 2, 0.7],
    ],
  ],
  [
    [
      [0, 0, 6, 1],
      [7, 4, 1, 0.6],
      [10, 0, 4, 0.8],
    ],
    [
      [0, 0, 5, 1],
      [8, 2, 2, 0.65],
      [10, 4, 2, 0.75],
      [14, APPROACH, 2, 0.7],
    ],
  ],
  [
    [
      [0, 0, 2, 1],
      [2, 7, 1, 0.5],
      [4, 0, 2, 0.8],
      [8, 4, 2, 0.8],
      [11, 0, 2, 0.7],
      [14, 4, 1, 0.55],
    ],
    [
      [0, 0, 2, 1],
      [3, 0, 1, 0.55],
      [6, 2, 2, 0.7],
      [10, 4, 2, 0.8],
      [13, 5, 1, 0.6],
      [14, APPROACH, 2, 0.7],
    ],
  ],
];

/** Chord hit: [step, length in steps, velocity]. */
type Hit = readonly [number, number, number];
const COMP: readonly (readonly Hit[])[] = [
  [
    [0, 7, 0.8],
    [10, 5, 0.6],
  ],
  [
    [0, 3, 0.75],
    [3, 4, 0.55],
    [8, 7, 0.7],
  ],
  [
    [2, 4, 0.7],
    [6, 3, 0.5],
    [10, 5, 0.65],
  ],
  [[0, 14, 0.7]],
  [
    [0, 5, 0.75],
    [7, 2, 0.5],
    [10, 2, 0.55],
    [14, 2, 0.5],
  ],
];
const MENU_COMP: readonly (readonly Hit[])[] = [
  [[0, 16, 0.55]],
  [
    [0, 10, 0.55],
    [10, 6, 0.4],
  ],
  [
    [0, 6, 0.5],
    [6, 10, 0.45],
  ],
];

function bits(...steps: number[]): number {
  let m = 0;
  for (const s of steps) m |= 1 << s;
  return m;
}
const KICKS = [bits(0, 10), bits(0, 7, 10), bits(0, 3, 10), bits(0, 6, 10)];
const SNARES = bits(4, 12);
const MELODY_STEPS = [3, 6, 11, 14];

/**
 * Machine layer fill order: offbeat 8ths first ("ka-CHUNK" of the press), then
 * downbeats, then the 16ths. Density d → the first round(d·16) steps sound.
 */
export const MACHINE_ORDER = [2, 10, 6, 14, 0, 8, 4, 12, 3, 11, 7, 15, 1, 9, 5, 13];
const MACHINE_RANK: number[] = new Array<number>(16).fill(0);
MACHINE_ORDER.forEach((s, i) => (MACHINE_RANK[s] = i));

interface Phrase {
  index: number;
  start: number;
  len: number;
  prog: number;
  riff: number;
  comp: number;
  menuComp: number;
  kick: number;
  hats16: boolean;
  /** First bar of the phrase without kick (a breath). */
  dropIn: boolean;
}

interface Bar {
  bar: number;
  chord: Chord;
  next: Chord;
  riff: readonly BassNote[];
  comp: readonly Hit[];
  menuComp: readonly Hit[];
  kick: number;
  fill: boolean;
  noKick: boolean;
  ghost: number;
  ghostRoll: number;
  openHat: boolean;
  hats16: boolean;
  rot: boolean;
  menuFifth: boolean;
  approachUp: boolean;
  melN: number;
  melSteps: number[];
  melNotes: number[];
  machinePitch: number;
}

const POOL = 32;

export class Composer {
  /** Output of the last compose() call (first `count` entries are valid). */
  readonly events: MusicEvent[] = [];
  private count = 0;
  private readonly phRng = new Prng();
  private readonly barRng = new Prng();
  private readonly stepRng = new Prng();
  private readonly ph: Phrase;
  private readonly peek: Phrase;
  private readonly b: Bar;

  constructor(readonly seed: number) {
    for (let i = 0; i < POOL; i++)
      this.events.push({ inst: INST.KICK, midi: 0, vel: 0, dur: 0, delay: 0, pan: 0 });
    const blank = (): Phrase => ({
      index: 0,
      start: 0,
      len: 8,
      prog: 0,
      riff: 0,
      comp: 0,
      menuComp: 0,
      kick: 0,
      hats16: false,
      dropIn: false,
    });
    this.ph = blank();
    this.peek = blank();
    this.phraseParams(0, 0, this.ph);
    const c0 = CHORDS[0] as Chord;
    this.b = {
      bar: -1,
      chord: c0,
      next: c0,
      riff: RIFFS[0]![0],
      comp: COMP[0]!,
      menuComp: MENU_COMP[0]!,
      kick: 0,
      fill: false,
      noKick: false,
      ghost: 7,
      ghostRoll: 1,
      openHat: false,
      hats16: false,
      rot: false,
      menuFifth: false,
      approachUp: true,
      melN: 0,
      melSteps: [0, 0, 0],
      melNotes: [0, 0, 0],
      machinePitch: 50,
    };
  }

  /** First bar ≥ `bar` that starts a phrase (fresh music starts there, on the tonic). */
  nextPhraseStart(bar: number): number {
    const p = this.phraseAt(Math.max(0, bar));
    return bar <= p.start ? p.start : p.start + p.len;
  }

  /** Phrase info for diagnostics/tests. */
  phraseInfo(bar: number): { start: number; len: number; prog: number } {
    const p = this.phraseAt(bar);
    return { start: p.start, len: p.len, prog: p.prog };
  }

  /** Chord index (into the internal table) sounding in `bar`. */
  chordAt(bar: number): number {
    return this.chordIndex(this.phraseAt(bar), bar);
  }

  /**
   * Notes for one grid step. `drums`: kit allowed (game, or fading out of game);
   * `machine`: machine-layer density 0..1. Returns the number of events written.
   */
  compose(step: number, style: Style, drums: boolean, machine: number): number {
    this.count = 0;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const s = step - bar * STEPS_PER_BAR;
    if (bar !== this.b.bar) this.computeBar(bar);
    const b = this.b;
    const r = this.stepRng.reseed(hash32(this.seed, step, 0x57e9));
    const dens = machine > 0 ? Math.min(1, machine) : 0;

    if (style === 'game') {
      if (drums) {
        const bit = 1 << s;
        const kick = b.fill ? KICKS[0]! : b.kick;
        if (!b.noKick && kick & bit) this.push(INST.KICK, 36, s === 0 ? 1 : 0.8, 0.3, 0, 0);
        if (SNARES & bit) this.push(INST.SNARE, 38, 0.9, 0.2, r.next() * 0.004, 0);
        else if (b.fill && s >= 13) this.push(INST.SNARE, 38, 0.3 + 0.15 * (s - 12), 0.2, 0, 0);
        else if (s === b.ghost && b.ghostRoll < 0.15 + 0.5 * dens)
          this.push(INST.SNARE, 38, 0.22, 0.15, 0, 0);
        if (s % 2 === 0) {
          const v = (s % 4 === 0 ? 0.5 : 0.75) * (0.85 + 0.3 * r.next());
          if (s === 14 && b.openHat) this.push(INST.OHAT, 0, v * 0.8, 0.2, 0, 0);
          else this.push(INST.HAT, 0, v, 0.04, 0, 0);
        } else if (b.hats16 || dens > 0.55) {
          this.push(INST.HAT, 0, 0.3 * (0.8 + 0.4 * r.next()), 0.03, 0, 0);
        }
        // Machine layer: the press itself, density driven by SERIA.
        const n = Math.round(dens * 16);
        const rank = MACHINE_RANK[s] ?? 16;
        if (rank < n) {
          const pan = (s >> 2) & 1 ? 0.35 : -0.35;
          if (rank < 4) this.push(INST.CLANK, b.machinePitch, s === 2 ? 1 : 0.8, 0.1, 0, pan);
          else if (rank < 8) this.push(INST.THUMP, 38, 0.6, 0.1, 0, -pan);
          else this.push(INST.FEED, 0, 0.3 + 0.25 * dens, 0.03, 0, pan);
        }
      }
      // Bass riff.
      for (let i = 0; i < b.riff.length; i++) {
        const note = b.riff[i]!;
        if (note[0] !== s) continue;
        const deg = note[1];
        const midi =
          deg === APPROACH ? dorian(b.next.root + (b.approachUp ? 1 : -1)) : dorian(b.chord.root + deg);
        this.push(
          INST.BASS,
          midi,
          note[3] * (0.9 + 0.2 * r.next()),
          note[2] * STEP * 0.92,
          r.next() * 0.004,
          0,
        );
      }
      this.chordHits(b.comp, s, 1, r);
    } else {
      // Menu: sparse — long chords, soft roots, no drums.
      if (s === 0) this.push(INST.BASS, dorian(b.chord.root), 0.6, (b.menuFifth ? 10 : 15) * STEP, 0, 0);
      if (s === 10 && b.menuFifth) this.push(INST.BASS, dorian(b.chord.root + 4), 0.45, 6 * STEP, 0, 0);
      this.chordHits(b.menuComp, s, 0.8, r);
    }

    for (let i = 0; i < b.melN; i++) {
      if (b.melSteps[i] === s)
        this.push(INST.BELL, b.melNotes[i] ?? 69, 0.5 * (0.85 + 0.3 * r.next()), 1.2, r.next() * 0.006, 0);
    }
    return this.count;
  }

  /* ------------------------------------------------------------------ internals */

  private chordHits(hits: readonly Hit[], s: number, velScale: number, r: Prng): void {
    const v = this.b.chord.voicing;
    for (let h = 0; h < hits.length; h++) {
      const hit = hits[h]!;
      if (hit[0] !== s) continue;
      const len = hit[1];
      const vel = hit[2];
      for (let i = 0; i < 4; i++) {
        // Inversion: lowest note up an octave (strum stays low → high).
        const j = this.b.rot ? (i + 1) % 4 : i;
        const midi = this.b.rot && j === 0 ? v[0] + 12 : (v[j] ?? v[0]);
        this.push(
          INST.KEYS,
          midi,
          vel * velScale * (0.85 + 0.3 * r.next()),
          len * STEP,
          i * 0.011 + r.next() * 0.004,
          0,
        );
      }
    }
  }

  private push(inst: Inst, midi: number, vel: number, dur: number, delay: number, pan: number): void {
    if (this.count >= POOL) return;
    const e = this.events[this.count++]!;
    e.inst = inst;
    e.midi = midi;
    e.vel = vel;
    e.dur = dur;
    e.delay = delay;
    e.pan = pan;
  }

  /** Pure: phrase parameters for phrase `index` starting at bar `start`. */
  private phraseParams(index: number, start: number, out: Phrase): void {
    const r = this.phRng.reseed(hash32(this.seed, index, 0x0f1a));
    out.index = index;
    out.start = start;
    out.len = index === 0 ? 8 : r.chance(0.5) ? 8 : 16;
    out.prog = index === 0 ? 0 : r.int(PROGRESSIONS.length);
    out.riff = r.int(RIFFS.length);
    out.comp = r.int(COMP.length);
    out.menuComp = r.int(MENU_COMP.length);
    out.kick = r.int(KICKS.length);
    out.hats16 = r.chance(0.3);
    out.dropIn = index > 0 && r.chance(0.25);
  }

  private phraseAt(bar: number): Phrase {
    const p = this.ph;
    if (bar < p.start) this.phraseParams(0, 0, p);
    while (bar >= p.start + p.len) this.phraseParams(p.index + 1, p.start + p.len, p);
    return p;
  }

  private chordIndex(p: Phrase, bar: number): number {
    const pos = (bar - p.start) % 4;
    const prog = PROGRESSIONS[p.prog] ?? PROGRESSIONS[0]!;
    let ci = prog[pos] ?? 0;
    if (pos === 3 && hash32(this.seed, bar, 0x5b) % 4 === 0) ci = SUBS[ci] ?? ci;
    return ci;
  }

  private computeBar(bar: number): void {
    const p = this.phraseAt(bar);
    const b = this.b;
    const pos = bar - p.start;
    b.bar = bar;
    b.chord = CHORDS[this.chordIndex(p, bar)] ?? CHORDS[0]!;
    if (pos + 1 < p.len) {
      b.next = CHORDS[this.chordIndex(p, bar + 1)] ?? CHORDS[0]!;
    } else {
      this.phraseParams(p.index + 1, p.start + p.len, this.peek);
      b.next = CHORDS[PROGRESSIONS[this.peek.prog]?.[0] ?? 0] ?? CHORDS[0]!;
    }
    const r = this.barRng.reseed(hash32(this.seed, bar, 0x0ba7));
    b.comp = (r.chance(0.3) ? COMP[r.int(COMP.length)] : COMP[p.comp]) ?? COMP[0]!;
    b.menuComp =
      (r.chance(0.35) ? MENU_COMP[r.int(MENU_COMP.length)] : MENU_COMP[p.menuComp]) ?? MENU_COMP[0]!;
    b.kick = (r.chance(0.25) ? KICKS[r.int(KICKS.length)] : KICKS[p.kick]) ?? KICKS[0]!;
    b.riff = RIFFS[p.riff]?.[pos % 2] ?? RIFFS[0]![0];
    b.fill = pos === p.len - 1;
    b.noKick = pos === 0 && p.dropIn;
    b.ghost = r.chance(0.5) ? 7 : 15;
    b.ghostRoll = r.next();
    b.openHat = r.chance(0.3);
    b.hats16 = p.hats16;
    b.rot = r.chance(0.4);
    b.menuFifth = r.chance(0.4);
    b.approachUp = r.chance(0.5);
    b.machinePitch = r.chance(0.5) ? 50 : 57;
    b.melN = r.chance(0.4) ? 1 + r.int(3) : 0;
    const off = r.int(MELODY_STEPS.length);
    for (let i = 0; i < b.melN; i++) {
      b.melSteps[i] = MELODY_STEPS[(off + i) % MELODY_STEPS.length] ?? 3;
      b.melNotes[i] = b.chord.voicing[1 + r.int(3)]! + 12;
    }
  }
}
