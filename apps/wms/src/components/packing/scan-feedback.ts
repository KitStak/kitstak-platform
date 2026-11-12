'use client';

/**
 * Audible scan feedback for the stations (Web Audio, no assets): a short high chirp on
 * a good scan, a low double buzz on a wrong one. Silently does nothing when audio is
 * unavailable (tests, autoplay blocked before the first gesture).
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, startAt: number, duration: number, type: OscillatorType, gain = 0.08): void {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g).connect(a.destination);
  const t = a.currentTime + startAt;
  osc.start(t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.stop(t + duration + 0.02);
}

export function beepOk(): void {
  tone(1320, 0, 0.09, 'sine');
}

export function beepError(): void {
  tone(220, 0, 0.16, 'square', 0.06);
  tone(180, 0.2, 0.22, 'square', 0.06);
}

export function beepDone(): void {
  tone(880, 0, 0.08, 'sine');
  tone(1320, 0.1, 0.12, 'sine');
}
