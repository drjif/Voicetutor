import { elements, state } from './dom.js';
import { lockScreenMetadataFields } from './study-timeline.js';
import { assertGeneration, createCancellationError } from './voice.js';

export { createLockScreenTrack } from './study-timeline.js';

function selectedVoice() {
  return state.voices.find((voice) => voice.voiceURI === elements.voiceSelect.value) ?? null;
}

export function speakLockScreenTrack(text, generation, onBoundary) {
  return new Promise((resolve, reject) => {
    try {
      assertGeneration(generation);

      const utterance = new SpeechSynthesisUtterance(text);
      const voice = selectedVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = Number(elements.speechRate.value);
      utterance.pitch = 1;
      utterance.volume = 1;
      state.currentUtterance = utterance;

      let watchdog = null;
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        if (watchdog) clearInterval(watchdog);
        if (state.lockScreenWatchdog === watchdog) state.lockScreenWatchdog = null;
        if (state.currentUtterance === utterance) state.currentUtterance = null;
        callback();
      };

      utterance.onboundary = (event) => {
        if (generation !== state.generation || state.status !== 'running') return;
        if (typeof event.charIndex === 'number') onBoundary?.(event.charIndex);
      };
      utterance.onend = () => finish(() => {
        if (generation !== state.generation) reject(createCancellationError());
        else resolve();
      });
      utterance.onerror = (event) => finish(() => {
        if (generation !== state.generation
            || event.error === 'canceled'
            || event.error === 'interrupted') {
          reject(createCancellationError());
        } else {
          reject(new Error(`Lock-screen speech error: ${event.error}`));
        }
      });

      watchdog = window.setInterval(() => {
        if (generation !== state.generation) {
          clearInterval(watchdog);
          if (state.lockScreenWatchdog === watchdog) state.lockScreenWatchdog = null;
          return;
        }
        if (state.mode === 'lockscreen' && state.status === 'running' && window.speechSynthesis.paused) {
          try { window.speechSynthesis.resume(); } catch {}
        }
      }, 5000);
      state.lockScreenWatchdog = watchdog;

      // Lock-screen review intentionally uses one already-running utterance for the
      // remaining deck. On iOS, starting a *new* utterance after the page is locked
      // depends on suspended page JavaScript and is unreliable. Transport actions
      // cancel this utterance explicitly and create a fresh one from the target card.
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      reject(error);
    }
  });
}

function setAction(action, handler) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Some browsers expose Media Session but do not support every action.
  }
}

export function configureLockScreenMediaSession({ onPlay, onPause, onStop, onNext, onPrevious }) {
  setAction('play', onPlay);
  setAction('pause', onPause);
  setAction('stop', onStop);
  setAction('nexttrack', onNext);
  setAction('previoustrack', onPrevious);
}

export function setLockScreenMetadata(item, index, total, phase = 'question') {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined' || !item) return;
  const metadata = lockScreenMetadataFields(item, index, total, phase);
  navigator.mediaSession.metadata = new MediaMetadata({
    ...metadata,
    artwork: [
      {
        src: new URL('./icon.svg', window.location.href).href,
        sizes: '512x512',
        type: 'image/svg+xml'
      }
    ]
  });
}

export function setLockScreenPlaybackState(value) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = value;
  } catch {
    // Ignore unsupported playback-state updates.
  }
}

export function clearLockScreenMediaSession({ force = false } = {}) {
  const newerLockScreenRunOwnsMedia = !force
    && state.mode === 'lockscreen'
    && ['running', 'listening', 'waiting', 'paused'].includes(state.status)
    && Boolean(state.currentUtterance);
  if (newerLockScreenRunOwnsMedia) return false;

  if (state.lockScreenWatchdog) clearInterval(state.lockScreenWatchdog);
  state.lockScreenWatchdog = null;
  if (!('mediaSession' in navigator)) return true;
  ['play', 'pause', 'stop', 'nexttrack', 'previoustrack'].forEach((action) => setAction(action, null));
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  } catch {
    // Ignore cleanup failures.
  }
  return true;
}
