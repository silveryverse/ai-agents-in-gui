/**
 * Tiny optional WebAudio cues.
 *
 * Sound is off unless the person explicitly enables it. No assets are loaded;
 * every cue is a short, quiet oscillator envelope so the application stays
 * lightweight and network-free.
 */

let audio = null;
let enabled = false;
let master = null;
const lastPlayed = new Map();

const CUES = {
  select: [[660, 0.035, 0.012]],
  handoff: [
    [392, 0.07, 0.018],
    [523, 0.09, 0.014],
  ],
  success: [
    [523, 0.06, 0.016],
    [659, 0.07, 0.014],
    [784, 0.1, 0.012],
  ],
  error: [
    [196, 0.08, 0.02],
    [147, 0.12, 0.016],
  ],
};

function ensureAudio() {
  if (audio) return audio;
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return null;
  audio = new Ctor();
  master = audio.createGain();
  master.gain.value = 0.045;
  master.connect(audio.destination);
  return audio;
}

function userCanPlay() {
  const activation = navigator.userActivation;
  return !activation || activation.hasBeenActive;
}

export function setSoundEnabled(value) {
  enabled = Boolean(value);
  if (enabled && userCanPlay()) {
    const context = ensureAudio();
    if (context?.state === "suspended") context.resume().catch(() => {});
  }
  return enabled;
}

export function isSoundEnabled() {
  return enabled;
}

// Browsers can suspend an AudioContext created before the first gesture. If the
// preference was stored as on, the next click quietly resumes it.
window.addEventListener(
  "pointerdown",
  () => {
    if (enabled) setSoundEnabled(true);
  },
  { passive: true },
);

export function playCue(kind) {
  if (!enabled || !userCanPlay()) return;
  const notes = CUES[kind];
  if (!notes) return;
  const now = performance.now();
  const previous = lastPlayed.get(kind) ?? 0;
  if (now - previous < 90) return;
  lastPlayed.set(kind, now);

  const context = ensureAudio();
  if (!context || !master) return;
  if (context.state === "suspended") context.resume().catch(() => {});

  let offset = 0;
  for (const [frequency, duration, volume] of notes) {
    const start = context.currentTime + offset;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
    offset += duration * 0.72;
  }
}
