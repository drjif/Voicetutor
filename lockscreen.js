import { elements, state } from './dom.js';
import {
  createLockScreenCardTrack,
  lockScreenMetadataFields
} from './study-timeline.js';
import { assertGeneration } from './voice.js';

export { createLockScreenCardTrack, createLockScreenTrack, lockScreenCardPhase } from './study-timeline.js';

let queuedLockScreenRun = null;

function selectedVoice() {
  return state.voices.find((voice) => voice.voiceURI === elements.voiceSelect.value) ?? null;
}

function settleEntry(entry) {
  if (!entry || entry.settled) return;
  entry.settled = true;
  if (state.currentUtterance === entry.utterance) state.currentUtterance = null;
  entry.resolve();
}

function discardQueuedLockScreenRun() {
  const run = queuedLockScreenRun;
  queuedLockScreenRun = null;
  if (!run) return;

  run.entries.forEach((entry) => {
    entry.externalBoundary = null;
    // Resolve rather than reject here. Explicit transport operations increment the
    // generation first, so the awaiting session will fail its next generation
    // assertion without creating unhandled rejections for future queued cards.
    settleEntry(entry);
  });

  if (state.lockScreenWatchdog) clearInterval(state.lockScreenWatchdog);
  state.lockScreenWatchdog = null;
  state.currentUtterance = null;
}

function buildQueuedLockScreenRun(generation, startIndex) {
  const voice = selectedVoice();
  const rate = Number(elements.speechRate.value);
  const thinkSeconds = Number(elements.answerDelay.value);
  const total = state.questions.length;
  const entries = new Map();

  const run = {
    generation,
    startIndex,
    entries
  };

  for (let index = startIndex; index < total; index += 1) {
    const item = state.questions[index];
    const track = createLockScreenCardTrack(item, index, thinkSeconds);
    const utterance = new SpeechSynthesisUtterance(track.text);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;

    let resolveEntry;
    const promise = new Promise((resolve) => {
      resolveEntry = resolve;
    });

    const entry = {
      index,
      item,
      track,
      utterance,
      promise,
      resolve: resolveEntry,
      settled: false,
      error: null,
      answerReached: false,
      externalBoundary: null
    };
    entries.set(index, entry);

    utterance.onstart = () => {
      if (generation !== state.generation || state.status !== 'running') return;

      // The speech engine may start the next queued card while the document is
      // backgrounded. One onstart event maps to exactly one known card; unlike
      // word-boundary charIndex values, it cannot skip hundreds of questions.
      state.currentIndex = index;
      state.currentUtterance = utterance;
      setLockScreenMetadata(item, index, total, 'question');
      setLockScreenPlaybackState('playing');
    };

    utterance.onboundary = (event) => {
      if (generation !== state.generation || state.status !== 'running') return;
      if (typeof event.charIndex !== 'number') return;

      if (!entry.answerReached && event.charIndex >= track.answerCharIndex) {
        entry.answerReached = true;
        setLockScreenMetadata(item, index, total, 'answer');
      }

      entry.externalBoundary?.(event.charIndex);
    };

    utterance.onend = () => {
      settleEntry(entry);
    };

    utterance.onerror = (event) => {
      if (generation === state.generation
          && event.error !== 'canceled'
          && event.error !== 'interrupted') {
        entry.error = new Error(`Lock-screen speech error: ${event.error}`);
      }
      settleEntry(entry);
    };
  }

  queuedLockScreenRun = run;

  if (state.lockScreenWatchdog) clearInterval(state.lockScreenWatchdog);
  const watchdog = window.setInterval(() => {
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

  // Queue every remaining card synchronously while the page is still foregrounded.
  // The browser speech queue can then continue from card to card after screen lock
  // without waiting for page JavaScript to wake up and enqueue the next question.
  entries.forEach((entry) => window.speechSynthesis.speak(entry.utterance));

  return run;
}

export async function speakLockScreenTrack(text, generation, onBoundary) {
  assertGeneration(generation);

  const requestedIndex = state.currentIndex;
  let run = queuedLockScreenRun;

  if (!run || run.generation !== generation || !run.entries.has(requestedIndex)) {
    discardQueuedLockScreenRun();

    // Give an explicitly cancelled speech queue one task turn to settle, then
    // prequeue the entire remaining review before the device can suspend the page.
    await new Promise((settle) => setTimeout(settle, 25));
    assertGeneration(generation);
    run = buildQueuedLockScreenRun(generation, requestedIndex);
  }

  const entry = run.entries.get(requestedIndex);
  if (!entry) throw new Error('Lock-screen speech queue lost the current question.');

  entry.externalBoundary = onBoundary ?? null;

  // If this card already passed its answer boundary while the page was suspended,
  // let the visual session catch up immediately when JavaScript resumes.
  if (entry.answerReached && entry.externalBoundary) {
    entry.externalBoundary(entry.track.answerCharIndex);
  }

  try {
    await entry.promise;
    assertGeneration(generation);
    if (entry.error) throw entry.error;
  } finally {
    if (entry.externalBoundary === onBoundary) entry.externalBoundary = null;
  }

  // Preserve the supplied argument in the public API. The first queued entry was
  // built from the same card content; later calls attach to their already-queued
  // utterances rather than enqueueing duplicate speech.
  void text;
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

  discardQueuedLockScreenRun();
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
