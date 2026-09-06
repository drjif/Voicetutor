import { elements, state } from './dom.js';
import { lockScreenMetadataFields } from './study-timeline.js';
import { assertGeneration, createCancellationError } from './voice.js';

export { createLockScreenTrack } from './study-timeline.js';

function selectedVoice() {
  return state.voices.find((voice) => voice.voiceURI === elements.voiceSelect.value) ?? null;
}

export function speakLockScreenTrack(text, generation, onBoundary) {
  return new Promise(async (resolve, reject) => {
    try {
      assertGeneration(generation);
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      const voice = selectedVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = Number(elements.speechRate.value);
      utterance.pitch = 1;
      utterance.volume = 1;
      state.currentUtterance = utterance;

      const finish = (callback) => {
        if (state.lockScreenWatchdog) clearInterval(state.lockScreenWatchdog);
        state.lockScreenWatchdog = null;
        state.currentUtterance = null;
        callback();
      };

      utterance.onboundary = (event) => {
        if (typeof event.charIndex === 'number') onBoundary?.(event.charIndex);
      };
      utterance.onend = () => finish(resolve);
      utterance.onerror = (event) => {
        finish(() => {
          if (event.error === 'canceled' || event.error === 'interrupted') {
            reject(createCancellationError());
          } else {
            reject(new Error(`Lock-screen speech error: ${event.error}`));
          }
        });
      };

      state.lockScreenWatchdog = window.setInterval(() => {
        if (state.mode === 'lockscreen' && state.status === 'running' && window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      }, 5000);

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

export function clearLockScreenMediaSession() {
  if (state.lockScreenWatchdog) clearInterval(state.lockScreenWatchdog);
  state.lockScreenWatchdog = null;
  if (!('mediaSession' in navigator)) return;
  ['play', 'pause', 'stop', 'nexttrack', 'previoustrack'].forEach((action) => setAction(action, null));
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  } catch {
    // Ignore cleanup failures.
  }
}
