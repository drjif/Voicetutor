import { clamp } from './lib.js';
import { gradeTranscriptAlternatives } from './grading.js';
import {
  elements,
  saveProgress,
  saveSettings,
  selectedMode,
  setSessionStatus,
  setSheetStatus,
  state,
  updateControls
} from './dom.js';
import { noteQuestionCompleted, noteSessionCompleted, noteSessionStarted } from './beta.js';
import {
  clearLockScreenMediaSession,
  configureLockScreenMediaSession,
  createLockScreenCardTrack,
  lockScreenCardPhase,
  setLockScreenMetadata,
  setLockScreenPlaybackState,
  speakLockScreenTrack
} from './lockscreen.js';
import { releaseSessionWakeLock, requestSessionWakeLock } from './power.js';
import {
  ACTIVE_SESSION_STATUSES,
  shouldApplySpeechBoundary,
  transportAnchorIndex
} from './session-transport.js';
import { assertGeneration, listenForAnswer, pausableWait, speak, waitUntilResumed } from './voice.js';

const PASSIVE_ANSWER_HOLD_MS = 1600;
const ACTIVE_CORRECT_HOLD_MS = 1200;

function hideReviewControls() {
  elements.reviewDecision.hidden = true;
  state.reviewChoice = null;
}

function sourceBadgeText(item) {
  if (state.sourceKind === 'paste') return `Pasted question ${state.currentIndex + 1}`;
  if (state.sourceKind === 'demo') return `Demo question ${state.currentIndex + 1}`;
  if (state.sourceKind === 'csv') return `CSV row ${item.sourceRow}`;
  if (state.sourceKind === 'google-sheet') return `Sheet row ${item.sourceRow}`;
  return `Question ${state.currentIndex + 1}`;
}

function ensureAnswerVisible() {
  window.requestAnimationFrame(() => {
    if (elements.answerCard.hidden || document.visibilityState === 'hidden') return;
    const rect = elements.answerCard.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    if (rect.top >= 0 && rect.bottom <= viewportHeight) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    elements.answerCard.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest'
    });
  });
}

function setStudyPhase(phase, item, { syncLockScreen = false, bringAnswerIntoView = true } = {}) {
  elements.sessionPanel.dataset.phase = phase;
  const showAnswer = phase === 'answer' || phase === 'feedback';
  elements.answerCard.hidden = !showAnswer;

  if (showAnswer && bringAnswerIntoView) ensureAnswerVisible();
  if (syncLockScreen && state.mode === 'lockscreen') {
    setLockScreenMetadata(item, state.currentIndex, state.questions.length, phase);
  }
}

function cancelSpeechForTransport() {
  const synth = window.speechSynthesis;
  try {
    if (synth?.paused) synth.resume();
  } catch {}
  try {
    synth?.cancel();
  } catch {}
}

export function renderCurrentQuestion() {
  const item = state.questions[state.currentIndex];
  if (!item) return;
  elements.sessionPanel.hidden = false;
  elements.currentQuestion.textContent = item.question;
  elements.currentAnswer.textContent = item.answer;
  setStudyPhase('question', item, { bringAnswerIntoView: false });
  elements.transcriptCard.hidden = true;
  elements.listeningIndicator.hidden = true;
  elements.transcript.textContent = '';
  elements.matchResult.textContent = '';
  elements.sourceRowBadge.textContent = sourceBadgeText(item);
  elements.progressText.textContent = `Question ${state.currentIndex + 1} of ${state.questions.length}`;
  elements.progressBar.style.width = `${((state.currentIndex + 1) / state.questions.length) * 100}%`;
  elements.startRow.value = String(state.currentIndex);
  hideReviewControls();
  saveProgress();
  updateControls();
}

async function runPassiveItem(item, generation) {
  setStudyPhase('question', item, { bringAnswerIntoView: false });
  setSessionStatus('running', 'Reading question');
  await speak(item.question, generation);
  setStudyPhase('thinking', item, { bringAnswerIntoView: false });
  setSessionStatus('waiting', `Waiting ${elements.answerDelay.value}s`);
  await pausableWait(Number(elements.answerDelay.value) * 1000, generation);
  setStudyPhase('answer', item);
  setSessionStatus('running', 'Reading answer');
  await speak(`The answer is: ${item.answer}`, generation);
  await pausableWait(PASSIVE_ANSWER_HOLD_MS, generation);
}

function voiceCommand(transcript) {
  const value = transcript.toLowerCase().trim().replace(/[.!?]+$/g, '');
  if (/^(pause|pause session)$/.test(value)) return 'pause';
  if (/^(stop|stop session|end session)$/.test(value)) return 'stop';
  if (/^(repeat|repeat question|say that again)$/.test(value)) return 'repeat';
  if (/^(next|next question|skip)$/.test(value)) return 'next';
  if (/^(previous|previous question|go back)$/.test(value)) return 'previous';
  return null;
}

function recognitionSummary(grading, primaryTranscript) {
  const percentage = Math.round(grading.score * 100);
  const label = grading.outcome === 'correct'
    ? 'Accepted'
    : grading.outcome === 'partial'
      ? 'Partially correct'
      : 'Not matched';
  const usedAlternative = grading.transcript
    && primaryTranscript
    && grading.transcript.toLowerCase() !== primaryTranscript.toLowerCase();
  const confidence = grading.confidence == null
    ? ''
    : ` · speech confidence ${Math.round(grading.confidence * 100)}%`;
  const alternative = usedAlternative ? ' · used a recognition alternative' : '';
  return `${label} · local match ${percentage}%${confidence}${alternative}`;
}

async function waitForReviewDecision(generation, outcome) {
  state.reviewChoice = null;
  elements.reviewMessage.textContent = outcome === 'partial'
    ? 'A correct component was recognized, but the stored answer contains additional points.'
    : 'The browser may have misheard a word. Correct the result before it advances.';
  elements.reviewDecision.hidden = false;
  setSessionStatus('waiting', outcome === 'partial' ? 'Partial answer' : 'Check recognition');

  let remaining = outcome === 'partial' ? 5000 : 6500;
  while (remaining > 0 && !state.reviewChoice) {
    assertGeneration(generation);
    await waitUntilResumed(generation);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (state.status !== 'paused') remaining -= 100;
  }

  const choice = state.reviewChoice ?? 'continue';
  hideReviewControls();
  return choice;
}

function applyVoiceCommand(command) {
  if (command === 'pause') {
    pauseSession();
    state.restartCurrentQuestion = true;
    return true;
  }
  if (command === 'stop') {
    stopSession();
    return true;
  }
  if (command === 'repeat') {
    state.restartCurrentQuestion = true;
    return true;
  }
  if (command === 'previous') {
    state.currentIndex = clamp(state.currentIndex - 1, 0, state.questions.length - 1);
    state.restartCurrentQuestion = true;
    return true;
  }
  if (command === 'next') return true;
  return false;
}

async function runActiveItem(item, generation) {
  setStudyPhase('question', item, { bringAnswerIntoView: false });
  setSessionStatus('running', 'Reading question');
  await speak(item.question, generation);
  setStudyPhase('thinking', item, { bringAnswerIntoView: false });
  await pausableWait(250, generation);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await listenForAnswer(generation);
    if (result.paused) {
      state.restartCurrentQuestion = true;
      return;
    }

    elements.listeningIndicator.hidden = true;
    const primaryTranscript = result.transcript?.trim() ?? '';
    const command = voiceCommand(primaryTranscript);
    if (command && applyVoiceCommand(command)) return;

    const grading = gradeTranscriptAlternatives(
      result.alternatives?.length ? result.alternatives : [primaryTranscript],
      item.answer,
      item.acceptedAnswers,
      elements.strictness.value
    );

    elements.transcriptCard.hidden = false;
    elements.transcript.textContent = grading.transcript || 'No answer detected.';
    elements.matchResult.textContent = grading.transcript
      ? recognitionSummary(grading, primaryTranscript)
      : 'No spoken answer detected.';

    if (grading.outcome === 'correct') {
      setStudyPhase('feedback', item);
      setSessionStatus('running', 'Correct');
      await speak('Correct.', generation);
      await pausableWait(ACTIVE_CORRECT_HOLD_MS, generation);
      return;
    }

    const shouldRetry = attempt === 0
      && (!grading.transcript || grading.score >= 0.1);

    if (shouldRetry && grading.outcome === 'incorrect') {
      setStudyPhase('thinking', item, { bringAnswerIntoView: false });
      setSessionStatus('running', 'Try once more');
      const heard = grading.transcript
        ? `I heard: ${grading.transcript}. `
        : 'I did not catch an answer. ';
      await speak(`${heard}Please try once more.`, generation);
      await pausableWait(250, generation);
      continue;
    }

    setStudyPhase('feedback', item);
    if (grading.outcome === 'partial') {
      setSessionStatus('running', 'Partially correct');
      await speak(`Partially correct. The full answer is: ${item.answer}`, generation);
    } else {
      setSessionStatus('running', 'Showing answer');
      await speak(`Not quite. The correct answer is: ${item.answer}`, generation);
    }

    const decision = await waitForReviewDecision(generation, grading.outcome);
    if (decision === 'retry') {
      state.restartCurrentQuestion = true;
      return;
    }
    if (decision === 'correct') {
      setSessionStatus('running', 'Marked correct');
      await speak('Marked correct.', generation);
      await pausableWait(300, generation);
    }
    return;
  }
}

async function runLockScreenReview(generation) {
  const startIndex = clamp(state.currentIndex, 0, state.questions.length - 1);

  configureLockScreenMediaSession({
    onPlay: resumeSession,
    onPause: pauseSession,
    onStop: stopSession,
    onNext: () => restartAt(transportAnchorIndex(state, state.questions.length) + 1),
    onPrevious: () => restartAt(transportAnchorIndex(state, state.questions.length) - 1)
  });

  setSessionStatus('running', 'Lock-screen review');
  setLockScreenPlaybackState('playing');

  try {
    for (let index = startIndex; index < state.questions.length; index += 1) {
      assertGeneration(generation);

      // The application, not SpeechSynthesis boundary events, owns navigation.
      // A browser callback can reveal the answer for this card, but it can never
      // mutate currentIndex or move to another question.
      state.pausedIndex = null;
      state.currentIndex = index;
      const item = state.questions[index];
      renderCurrentQuestion();
      setStudyPhase('question', item, { syncLockScreen: true, bringAnswerIntoView: false });

      const cardTrack = createLockScreenCardTrack(
        item,
        index,
        Number(elements.answerDelay.value)
      );
      let answerShown = false;

      await speakLockScreenTrack(cardTrack.text, generation, (charIndex) => {
        if (!shouldApplySpeechBoundary({
          generation,
          currentGeneration: state.generation,
          status: state.status
        })) return;
        if (answerShown) return;
        if (lockScreenCardPhase(cardTrack.answerCharIndex, charIndex) !== 'answer') return;

        answerShown = true;
        setStudyPhase('answer', item, { syncLockScreen: true, bringAnswerIntoView: true });
      });
      assertGeneration(generation);

      // Some speech engines do not emit boundary events. In that case reveal the
      // answer at utterance completion, without affecting navigation.
      if (!answerShown) {
        setStudyPhase('answer', item, { syncLockScreen: true, bringAnswerIntoView: true });
      }
      noteQuestionCompleted();
    }

    assertGeneration(generation);
    state.pausedIndex = null;
    setSessionStatus('complete', 'Review complete');
    elements.startButton.disabled = false;
    noteSessionCompleted();
  } catch (error) {
    if (error.name !== 'SessionCancelledError') {
      console.error(error);
      setSessionStatus('idle', 'Stopped');
      setSheetStatus(error.message || 'The lock-screen review stopped unexpectedly.', 'error');
      updateControls();
    }
  } finally {
    clearLockScreenMediaSession();
    await releaseSessionWakeLock();
  }
}

async function runSession(generation) {
  try {
    while (state.currentIndex < state.questions.length) {
      assertGeneration(generation);
      await waitUntilResumed(generation);
      renderCurrentQuestion();
      const item = state.questions[state.currentIndex];
      state.restartCurrentQuestion = false;
      if (state.mode === 'passive') await runPassiveItem(item, generation);
      else await runActiveItem(item, generation);
      assertGeneration(generation);
      if (state.status === 'idle' || state.status === 'complete') return;
      if (state.restartCurrentQuestion) continue;
      noteQuestionCompleted();
      state.currentIndex += 1;
    }

    state.pausedIndex = null;
    state.currentIndex = Math.max(0, state.questions.length - 1);
    renderCurrentQuestion();
    setStudyPhase('answer', state.questions[state.currentIndex]);
    setSessionStatus('complete', 'Session complete');
    elements.startButton.disabled = false;
    noteSessionCompleted();
    await speak('Session complete.', generation).catch(() => {});
  } catch (error) {
    if (error.name === 'SessionCancelledError') return;
    console.error(error);
    setSessionStatus('idle', 'Stopped');
    setSheetStatus(error.message || 'The voice session stopped unexpectedly.', 'error');
    updateControls();
  } finally {
    await releaseSessionWakeLock();
  }
}

export async function startSession() {
  if (!state.questions.length) return;
  saveSettings();
  cancelSpeechForTransport();
  clearLockScreenMediaSession({ force: true });
  await releaseSessionWakeLock({ force: true });
  state.generation += 1;
  state.pausedIndex = null;
  state.currentIndex = clamp(Number(elements.startRow.value) || 0, 0, state.questions.length - 1);
  state.mode = selectedMode();
  state.status = 'running';
  state.resumeResolvers.splice(0).forEach((resolve) => resolve());
  renderCurrentQuestion();
  noteSessionStarted();

  if (state.mode === 'active') {
    requestSessionWakeLock();
    setSessionStatus('running', 'Starting recall');
  } else if (state.mode === 'passive') {
    setSessionStatus('running', 'Starting review');
  } else {
    setSessionStatus('running', 'Preparing lock-screen review');
  }

  updateControls();
  if (state.mode === 'lockscreen') runLockScreenReview(state.generation);
  else runSession(state.generation);
}

export function pauseSession() {
  if (!['running', 'listening', 'waiting'].includes(state.status)) return;

  state.pausedIndex = clamp(state.currentIndex, 0, Math.max(0, state.questions.length - 1));
  setSessionStatus('paused', 'Paused');

  try { window.speechSynthesis.pause(); } catch {}
  if (state.recognition) {
    try { state.recognition.abort(); } catch {}
  }
  if (state.mode === 'lockscreen') setLockScreenPlaybackState('paused');
  updateControls();
}

export function resumeSession() {
  if (state.status !== 'paused') return;

  const anchorIndex = transportAnchorIndex(state, state.questions.length);
  if (state.mode === 'lockscreen') {
    // Lock-screen transport restarts the current card instead of resuming an
    // opaque browser speech position. This makes Pause/Resume deterministic.
    restartAt(anchorIndex);
    return;
  }

  state.pausedIndex = null;
  setSessionStatus('running', 'Resuming');
  try { window.speechSynthesis.resume(); } catch {}
  state.resumeResolvers.splice(0).forEach((resolve) => resolve());
  if (state.mode === 'active') requestSessionWakeLock();
  updateControls();
}

export function stopSession() {
  state.generation += 1;
  state.pausedIndex = null;
  state.status = 'idle';
  cancelSpeechForTransport();
  if (state.recognition) {
    try { state.recognition.abort(); } catch {}
    state.recognition = null;
  }
  state.resumeResolvers.splice(0).forEach((resolve) => resolve());
  elements.listeningIndicator.hidden = true;
  hideReviewControls();
  clearLockScreenMediaSession({ force: true });
  releaseSessionWakeLock({ force: true });
  setSessionStatus('idle', 'Stopped');
  updateControls();
}

export function restartAt(index) {
  if (!state.questions.length) return;

  const targetIndex = clamp(index, 0, state.questions.length - 1);
  const wasActive = ACTIVE_SESSION_STATUSES.includes(state.status);
  state.generation += 1;
  state.pausedIndex = null;

  cancelSpeechForTransport();
  if (state.recognition) {
    try { state.recognition.abort(); } catch {}
  }
  hideReviewControls();
  clearLockScreenMediaSession({ force: true });
  state.currentIndex = targetIndex;

  if (wasActive) state.status = 'running';
  renderCurrentQuestion();

  if (wasActive) {
    const generation = state.generation;
    setSessionStatus('running', 'Continuing');
    if (state.mode === 'lockscreen') runLockScreenReview(generation);
    else runSession(generation);
  } else {
    setSessionStatus('idle', 'Ready');
  }
}

export function setupSessionEvents() {
  elements.startButton.addEventListener('click', startSession);
  elements.pauseButton.addEventListener('click', pauseSession);
  elements.resumeButton.addEventListener('click', resumeSession);
  elements.stopButton.addEventListener('click', stopSession);
  elements.previousButton.addEventListener('click', () => {
    restartAt(transportAnchorIndex(state, state.questions.length) - 1);
  });
  elements.nextButton.addEventListener('click', () => {
    restartAt(transportAnchorIndex(state, state.questions.length) + 1);
  });
  elements.tryAgainButton.addEventListener('click', () => { state.reviewChoice = 'retry'; });
  elements.markCorrectButton.addEventListener('click', () => { state.reviewChoice = 'correct'; });
  elements.continueButton.addEventListener('click', () => { state.reviewChoice = 'continue'; });
  elements.startRow.addEventListener('change', () => {
    if (state.status === 'idle' || state.status === 'complete') {
      state.pausedIndex = null;
      state.currentIndex = Number(elements.startRow.value) || 0;
      renderCurrentQuestion();
      setSessionStatus('idle', 'Ready');
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !elements.answerCard.hidden) ensureAnswerVisible();
  });
  document.addEventListener('keydown', (event) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const key = event.key.toLowerCase();
    const anchorIndex = transportAnchorIndex(state, state.questions.length);

    if (event.code === 'Space') {
      event.preventDefault();
      if (state.status === 'paused') resumeSession();
      else pauseSession();
    } else if (event.key === 'ArrowRight') {
      restartAt(anchorIndex + 1);
    } else if (event.key === 'ArrowLeft') {
      restartAt(anchorIndex - 1);
    } else if (event.altKey && key === 'r') {
      event.preventDefault();
      restartAt(anchorIndex);
    } else if (event.altKey && key === 't' && !elements.reviewDecision.hidden) {
      event.preventDefault();
      state.reviewChoice = 'retry';
    } else if (event.altKey && key === 'm' && !elements.reviewDecision.hidden) {
      event.preventDefault();
      state.reviewChoice = 'correct';
    } else if (event.key === 'Enter' && !elements.reviewDecision.hidden) {
      state.reviewChoice = 'continue';
    } else if (event.key === 'Escape') {
      stopSession();
    }
  });
}
