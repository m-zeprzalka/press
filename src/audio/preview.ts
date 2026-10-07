/**
 * Dev-only audition page for the audio engine: `npx vite` → /src/audio/preview.html.
 * Not part of the game bundle.
 */

import { createAudioEngine, SFX_LIST, type PlayOpts, type Sfx } from './index';

const audio = createAudioEngine();

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}

const status = el<HTMLSpanElement>('status');
const pitch = el<HTMLInputElement>('pitch');
const intensity = el<HTMLInputElement>('intensity');
const pan = el<HTMLInputElement>('pan');
const musicIntensity = el<HTMLInputElement>('music-intensity');
const musicVol = el<HTMLInputElement>('music-vol');
const sfxVol = el<HTMLInputElement>('sfx-vol');

function opts(): PlayOpts {
  return { pitch: Number(pitch.value), intensity: Number(intensity.value), pan: Number(pan.value) };
}

function refresh(): void {
  status.textContent = audio.ready ? 'running' : 'locked / suspended — tap anywhere';
  status.dataset.ready = String(audio.ready);
  for (const input of document.querySelectorAll<HTMLInputElement>('input[type=range]')) {
    const out = document.querySelector<HTMLOutputElement>(`output[for="${input.id}"]`);
    if (out) out.value = input.value;
  }
}

// Autoplay policy: unlock on every gesture until running.
const unlock = (): void => {
  if (!audio.ready) void audio.unlock().then(refresh);
};
addEventListener('pointerdown', unlock, { capture: true });
addEventListener('keydown', unlock, { capture: true });

const grid = el<HTMLDivElement>('sfx');
SFX_LIST.forEach((sfx, i) => {
  const b = document.createElement('button');
  b.textContent = sfx;
  b.title = i < 9 ? `key ${i + 1}` : '';
  b.addEventListener('click', () => audio.play(sfx, opts()));
  grid.appendChild(b);
});
addEventListener('keydown', (e) => {
  const n = Number(e.key);
  const sfx = SFX_LIST[n - 1];
  if (n >= 1 && sfx) audio.play(sfx, opts());
});

for (const mode of ['menu', 'game', 'off'] as const) {
  el<HTMLButtonElement>(`music-${mode}`).addEventListener('click', () => audio.setMusic(mode));
}
musicIntensity.addEventListener('input', () => audio.setIntensity(Number(musicIntensity.value)));
musicVol.addEventListener('input', () => audio.setMusicVolume(Number(musicVol.value)));
sfxVol.addEventListener('input', () => audio.setSfxVolume(Number(sfxVol.value)));
el<HTMLButtonElement>('suspend').addEventListener('click', () => void audio.suspend().then(refresh));
el<HTMLButtonElement>('resume').addEventListener('click', () => void audio.resume().then(refresh));

/** Fire a timed sequence of SFX (ms offsets). */
function sequence(steps: [number, Sfx, PlayOpts?][]): void {
  for (const [ms, sfx, o] of steps) setTimeout(() => audio.play(sfx, o), ms);
}

el<HTMLButtonElement>('demo-count').addEventListener('click', () => {
  // A Balatro-style count-up at 16 ms per event: the engine throttles to ≤ 25 ticks/s.
  const steps: [number, Sfx, PlayOpts?][] = [
    [0, 'place'],
    [60, 'print', { intensity: 0.5 }],
  ];
  for (let i = 0; i < 40; i++) steps.push([300 + i * 16, 'tick_prints', { pitch: Math.floor(i / 3) }]);
  for (let i = 0; i < 8; i++) steps.push([1000 + i * 70, 'tick_mult', { pitch: i }]);
  steps.push([1650, 'xmult']);
  sequence(steps);
});
el<HTMLButtonElement>('demo-streak').addEventListener('click', () => {
  const steps: [number, Sfx, PlayOpts?][] = [];
  for (let i = 0; i < 9; i++) steps.push([i * 380, 'streak_up', { pitch: i }]);
  steps.push([9 * 380 + 200, 'streak_break']);
  sequence(steps);
  let v = 0;
  const id = setInterval(() => {
    v = Math.min(1, v + 0.12);
    audio.setIntensity(v);
    musicIntensity.value = String(v);
    refresh();
    if (v >= 1) clearInterval(id);
  }, 380);
});
el<HTMLButtonElement>('demo-turn').addEventListener('click', () => {
  sequence([
    [0, 'pickup'],
    [250, 'snap'],
    [330, 'snap'],
    [420, 'place'],
    [520, 'print_big'],
    [1300, 'quota_done'],
    [2800, 'card_flip'],
    [2900, 'card_flip', { pan: 0.4 }],
    [3000, 'card_flip', { pan: 0.8 }],
    [3600, 'card_take'],
  ]);
});
el<HTMLButtonElement>('demo-spam').addEventListener('click', () => {
  // 40 prints in 200 ms: voice limit (16, steal oldest) must keep it clean.
  for (let i = 0; i < 40; i++) setTimeout(() => audio.play('print', { intensity: Math.random() }), i * 5);
});

for (const input of document.querySelectorAll<HTMLInputElement>('input[type=range]')) {
  input.addEventListener('input', refresh);
}
setInterval(refresh, 500);
refresh();
