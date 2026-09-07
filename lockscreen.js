import { elements, state } from './dom.js';
import {
  advanceExpectedMarker,
  createLockScreenTrack,
  lockScreenMetadataFields
} from './study-timeline.js';
import { assertGeneration } from './voice.js';

export { createLockScreenCardTrack, createLockScreenTrack, lockScreenCardPhase } from './study-timeline.js';

let continuousRun = null;

function selectedVoice() {
  return state.voices.find((voice) => voice.voiceURI === elements.voiceSelect.value) ?? null;
}

function createEntry() {
  let resolveEntry;
  const promise = new Promise((resolve) => {
    resolveEntry = resolve;
  });
  return {
    promise,
    resolve: resolveEntry,
    settled: false,
    externalBoundary: null
  };
}

function entryFor(run, index) {
  let entry = run.entries.get(index);
  if (!entry) {
    entry = createEntry();
    run.entries.set(index, entry);
    if (run.completedThrough >= index || run.ended) settleEntry(entry);
  }
  return entry;
}

function settleEntry(entry) {
  if (!entry || entry.settled) return;
  entry.settled = true;
  entry.resolve();
}

function settleAll(run) {
  run.entries.forEach((entry) => settleEntry(entry));
}

function discardContinuousRun() {
  const run = continuousRun;
  continuousRun = null;
  if (!run) return;

  run.entries.forEach((entry) => {
    entry.externalBoundary = null;
    settleEntry(entry);
  });

  if (state.lockScreenWatchdog) clearInterval(state.lockScreenWatchdog);
  state.lockScreenWatchdog = null;
  if (state.currentUtterance === run.utterance) state.currentUtterance = null;
}

function markerOffsets(track) {
  const questionStart = new Map();
  const answerStart = new Map();
  track.markers.forEach((marker) => {
    if (marker.phase === 'question') questionStart.set(marker.index, marker.charIndex);
    else if (marker.phase === 'answer') answerStart.set(marker.index, marker.charIndex);
  });
  return { questionStart, answerStart };
}

function localBoundaryIndex(run, index, globalCharIndex) {
  const start = run.questionStart.get(index) ?? 0;
  return Math.max(0, globalCharIndex - start);
}

function buildContinuousRun(generation, startIndex) {
  const track = createLockScreenTrack(
    state.questions,
    startIndex,
    Number(elements.answerDelay.value)
  );
  const offsets = markerOffsets(track);
  const utterance = new SpeechSynthesisUtterance(track.text);
  const voice = selectedVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = Number(elements.speechRate.value);
  utterance.pitch = 1;
  utterance.volume = 1;

  const run = {
    generation,
    startIndex,
    track,
    utterance,
    cursor: 0,
    currentIndex: startIndex,
    completedThrough: startIndex - 1,
    ended: false,
    error: null,
    entries: new Map(),
    answerReached: new Set(),
    ...offsets
  };
  continuousRun = run;
  state.currentUtterance = utterance;
  state.currentIndex = startIndex;
  setLockScreenMetadata(state.questions[startIndex], startIndex, state.questions.length, 'question');
  setLockScreenPlaybackState('playing');

  utterance.onboundary = (event) => {
    if (generation !== state.generation || state.status !== 'running') return;
    if (typeof event.charIndex !== 'number') return;

    const step = advanceExpectedMarker(run.track.markers, run.cursor, event.charIndex);
    if (!step.marker) return;

    run.cursor = step.cursor;
    const marker = step.marker;
    const item = state.questions[marker.index];

    if (marker.phase === 'answer') {
      run.answerReached.add(marker.index);
      setLockScreenMetadata(item, marker.index, state.questions.length, 'answer');
      const entry = entryFor(run, marker.index);
      entry.externalBoundary?.(localBoundaryIndex(run, marker.index, event.charIndex));
      return;
    }

    if (marker.index > run.currentIndex) {
      run.completedThrough = Math.max(run.completedThrough, run.currentIndex);
      settleEntry(entryFor(run, run.currentIndex));
    }

    run.currentIndex = marker.index;
    state.currentIndex = marker.index;
    setLockScreenMetadata(item, marker.index, state.questions.length, 'question');
  };

  utterance.onend = () => {
    if (continuousRun !== run) return;
    run.ended = true;
    run.completedThrough = state.questions.length - 1;
    settleAll(run);
    if (state.currentUtterance === utterance) state.currentUtterance = null;
  };

  utterance.onerror = (event) => {
    if (continuousRun !== run) return;
    if (generation === state.generation
        && event.error !== 'canceled'
        && event.error !== 'interrupted') {
      run.error = new Error(`Lock-screen speech error: ${event.error}`);
    }
    run.ended = true;
    settleAll(run);
    if (state.currentUtterance === utterance) state.currentUtterance = null;
  };

  if (state.lockScreenWatchdog) clearInterval(state.lockScreenWatchdog);
  const watchdog = window.setInterval(() => {
    if (generation !== state.generation || continuousRun !== run) {
      clearInterval(watchdog);
      if (state.lockScreenWatchdog === watchdog) state.lockScreenWatchdog = null;
      return;
    }
    if (state.mode === 'lockscreen' && state.status === 'running' && window.speechSynthesis.paused) {
      try { window.speechSynthesis.resume(); } catch {}
    }
  }, 5000);
  state.lockScreenWatchdog = watchdog;

  // One already-running utterance is intentional. iOS can suspend page JavaScript
  // when the screen locks, but an utterance that is already in progress has a much
  // better chance of continuing than asking the suspended page to enqueue another
  // utterance between cards.
  window.speechSynthesis.speak(utterance);
  return run;
}

export async function speakLockScreenTrack(text, generation, onBoundary) {
  assertGeneration(generation);
  const requestedIndex = state.currentIndex;
  let run = continuousRun;

  if (!run
      || run.generation !== generation
      || requestedIndex < run.startIndex
      || requestedIndex >= state.questions.length) {
    discardContinuousRun();
    await new Promise((settle) => setTimeout(settle, 25));
    assertGeneration(generation);
    run = buildContinuousRun(generation, requestedIndex);
  }

  const entry = entryFor(run, requestedIndex);
  entry.externalBoundary = onBoundary ?? null;

  if (run.answerReached.has(requestedIndex) && entry.externalBoundary) {
    const answerStart = run.answerStart.get(requestedIndex) ?? run.questionStart.get(requestedIndex) ?? 0;
    entry.externalBoundary(localBoundaryIndex(run, requestedIndex, answerStart));
  }

  try {
    await entry.promise;
    assertGeneration(generation);
    if (run.error) throw run.error;
  } finally {
    if (entry.externalBoundary === onBoundary) entry.externalBoundary = null;
  }

  // The live lock-screen engine owns a single whole-review utterance. The per-card
  // text argument is retained only so the session controller API stays unchanged.
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

  discardContinuousRun();
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
