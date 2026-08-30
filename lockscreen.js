import { elements, state } from './dom.js';
import { assertGeneration, createCancellationError } from './voice.js';

function selectedVoice() {
  return state.voices.find((voice) => voice.voiceURI === elements.voiceSelect.value) ?? null;
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function thinkingPause(seconds) {
  const beats = Math.max(1, Math.min(10, Math.round(Number(seconds) / 1.5)));
  return Array.from({ length: beats }, () => ' ...').join('');
}

export function createLockScreenTrack(questions, startIndex, thinkSeconds) {
  let text = 'Lock-screen review starting. ';
  const markers = [];
  const pause = thinkingPause(thinkSeconds);

  questions.slice(startIndex).forEach((item, offset) => {
    const index = startIndex + offset;
    markers.push({ index, charIndex: text.length });
    text += `Question ${index + 1}. ${cleanText(item.question)}. Think about your answer.${pause} The answer is ${cleanText(item.answer)}. `;
    if (index < questions.length - 1) text += 'Next question. ';
  });

  text += 'Review complete.';
  return { text, markers };
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

export function setLockScreenMetadata(item, index, total) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined' || !item) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: item.question,
    artist: 'same3le — Lock-screen review',
    album: `Question ${index + 1} of ${total}`,
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
