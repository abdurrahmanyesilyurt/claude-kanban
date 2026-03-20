"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const STORAGE_KEY = "kanban-sound-muted";

interface UseSoundReturn {
  isMuted: boolean;
  toggleMute: () => void;
  playSuccess: () => void;
  playError: () => void;
}

/**
 * Lazily initializes an AudioContext on first user interaction.
 * Web Audio API requires a user gesture before audio can play.
 */
function getOrCreateContext(ref: React.MutableRefObject<AudioContext | null>): AudioContext | null {
  if (ref.current) return ref.current;

  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    ref.current = new Ctx();
    return ref.current;
  } catch {
    return null;
  }
}

/**
 * Plays a synthesized tone using the Web Audio API.
 *
 * @param ctx       - AudioContext
 * @param frequency - Base frequency in Hz
 * @param type      - Oscillator waveform
 * @param duration  - Total duration in seconds
 * @param envelope  - Attack / Decay / Sustain / Release times in seconds
 */
function playTone(
  ctx: AudioContext,
  frequency: number,
  type: OscillatorType,
  duration: number,
  envelope: { attack: number; decay: number; sustain: number; release: number }
): void {
  const now = ctx.currentTime;

  // Master gain (envelope)
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.4, now + envelope.attack);
  gain.gain.linearRampToValueAtTime(envelope.sustain * 0.4, now + envelope.attack + envelope.decay);
  gain.gain.setValueAtTime(envelope.sustain * 0.4, now + duration - envelope.release);
  gain.gain.linearRampToValueAtTime(0, now + duration);

  // Soft low-pass filter to avoid harshness
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 4000;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration);
}

/**
 * Success "ding" — two ascending sine tones (pleasant chime).
 */
function synthesizeSuccess(ctx: AudioContext): void {
  const envelope = { attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.3 };
  playTone(ctx, 880, "sine", 0.5, envelope);   // A5
  // Slight delay on second note for a pleasant chord / arpeggio
  setTimeout(() => {
    if (ctx.state === "closed") return;
    playTone(ctx, 1108, "sine", 0.55, envelope); // C#6
  }, 80);
}

/**
 * Error tone — two descending square/triangle tones (distinct, non-aggressive).
 */
function synthesizeError(ctx: AudioContext): void {
  const envelope = { attack: 0.005, decay: 0.05, sustain: 0.4, release: 0.25 };
  playTone(ctx, 440, "triangle", 0.4, envelope);  // A4
  setTimeout(() => {
    if (ctx.state === "closed") return;
    playTone(ctx, 330, "triangle", 0.45, envelope); // E4
  }, 100);
}

export function useSound(): UseSoundReturn {
  const isSupported = typeof window !== "undefined" && ("AudioContext" in window || "webkitAudioContext" in window);

  const ctxRef = useRef<AudioContext | null>(null);

  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  // Persist mute preference
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(isMuted));
    } catch {
      // ignore
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const playSuccess = useCallback(() => {
    if (!isSupported || isMuted) return;
    const ctx = getOrCreateContext(ctxRef);
    if (!ctx) return;

    // Resume suspended context (required after user gesture policy)
    const resume = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    resume.then(() => synthesizeSuccess(ctx)).catch(() => {/* silent fail */});
  }, [isSupported, isMuted]);

  const playError = useCallback(() => {
    if (!isSupported || isMuted) return;
    const ctx = getOrCreateContext(ctxRef);
    if (!ctx) return;

    const resume = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    resume.then(() => synthesizeError(ctx)).catch(() => {/* silent fail */});
  }, [isSupported, isMuted]);

  return { isMuted, toggleMute, playSuccess, playError };
}
