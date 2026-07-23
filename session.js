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
import { assertGeneration, listenForAnswer, pausableWait, speak, waitUntilResumed } from './voice.js';

function hideReviewControls() {
  elements.reviewDecision.hidden = true;
  state.reviewChoice = null;
}

export function renderCurrentQuestion() {
  const item = state.questions[state.currentIndex];
  if (!item) return;
  elements.sessionPanel.hidden = false;
  elements.currentQuestion.textContent = item.question;
  elements.currentAnswer.textContent = item.answer;
  elements.answerCard.hidden = true;
  elements.transcriptCard.hidden = true;
  elements.listeningIndicator.hidden = true;
  elements.transcript.textContent = '';
  elements.matchResult.textContent = '';
  elements.sourceRowBadge.textContent = `Sheet row ${item.sourceRow}`;
  elements.progressText.textContent = `Question ${state.currentIndex + 1} of ${state.questions.length}`;
  elements.progressBar.style.width = `${((state.currentIndex + 1) / state.questions.length) * 100}%`;
  elements.startRow.value = String(state.currentIndex);
  hideReviewControls();
  saveProgress();
  updateControls();
}

async function runPassiveItem(item, generation) {
  setSessionStatus('running', 'Reading question');
  await speak(item.question, generation);
  setSessionStatus('waiting', `Waiting ${elements.answerDelay.value}s`);
  await pausableWait(Number(elements.answerDelay.value) * 1000, generation);
  elements.answerCard.hidden = false;
  setSessionStatus('running', 'Reading answer');
  await speak(`The answer is: ${item.answer}`, generation);
  await pausableWait(650, generation);
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
    : 'The browser may have misheard a medical term. Correct the result before it advances.';
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
  setSessionStatus('running', 'Reading question');
  await speak(item.question, generation);
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
      elements.answerCard.hidden = true;
      setSessionStatus('running', 'Correct');
      await speak('Correct.', generation);
      await pausableWait(450, generation);
      return;
    }

    const shouldRetry = attempt === 0
      && (!grading.transcript || grading.score >= 0.1);

    if (shouldRetry && grading.outcome === 'incorrect') {
      setSessionStatus('running', 'Try once more');
      const heard = grading.transcript
        ? `I heard: ${grading.transcript}. `
        : 'I did not catch an answer. ';
      await speak(`${heard}Please try once more.`, generation);
      await pausableWait(250, generation);
      continue;
    }

    elements.answerCard.hidden = false;
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
      state.currentIndex += 1;
    }

    state.currentIndex = Math.max(0, state.questions.length - 1);
    renderCurrentQuestion();
    setSessionStatus('complete', 'Session complete');
    elements.startButton.disabled = false;
    await speak('Session complete.', generation).catch(() => {});
  } catch (error) {
    if (error.name === 'SessionCancelledError') return;
    console.error(error);
    setSessionStatus('idle', 'Stopped');
    setSheetStatus(error.message || 'The voice session stopped unexpectedly.', 'error');
    updateControls();
  }
}

export function startSession() {
  if (!state.questions.length) return;
  saveSettings();
  state.generation += 1;
  state.currentIndex = clamp(Number(elements.startRow.value) || 0, 0, state.questions.length - 1);
  state.mode = selectedMode();
  state.status = 'running';
  state.resumeResolvers.splice(0).forEach((resolve) => resolve());
  renderCurrentQuestion();
  setSessionStatus('running', state.mode === 'passive' ? 'Starting review' : 'Starting recall');
  updateControls();
  runSession(state.generation);
}

export function pauseSession() {
  if (!['running', 'listening', 'waiting'].includes(state.status)) return;
  state.status = 'paused';
  window.speechSynthesis.pause();
  if (state.recognition) {
    try { state.recognition.abort(); } catch {}
  }
  setSessionStatus('paused', 'Paused');
  updateControls();
}

export function resumeSession() {
  if (state.status !== 'paused') return;
  state.status = 'running';
  window.speechSynthesis.resume();
  state.resumeResolvers.splice(0).forEach((resolve) => resolve());
  setSessionStatus('running', 'Resuming');
  updateControls();
}

export function stopSession() {
  state.generation += 1;
  state.status = 'idle';
  window.speechSynthesis.cancel();
  if (state.recognition) {
    try { state.recognition.abort(); } catch {}
    state.recognition = null;
  }
  state.resumeResolvers.splice(0).forEach((resolve) => resolve());
  elements.listeningIndicator.hidden = true;
  hideReviewControls();
  setSessionStatus('idle', 'Stopped');
  updateControls();
}

export function restartAt(index) {
  if (!state.questions.length) return;
  const wasActive = ['running', 'listening', 'waiting', 'paused'].includes(state.status);
  state.generation += 1;
  window.speechSynthesis.cancel();
  if (state.recognition) {
    try { state.recognition.abort(); } catch {}
  }
  hideReviewControls();
  state.currentIndex = clamp(index, 0, state.questions.length - 1);
  renderCurrentQuestion();
  if (wasActive) {
    state.status = 'running';
    const generation = state.generation;
    setSessionStatus('running', 'Continuing');
    runSession(generation);
  } else {
    setSessionStatus('idle', 'Ready');
  }
}

export function setupSessionEvents() {
  elements.startButton.addEventListener('click', startSession);
  elements.pauseButton.addEventListener('click', pauseSession);
  elements.resumeButton.addEventListener('click', resumeSession);
  elements.stopButton.addEventListener('click', stopSession);
  elements.repeatButton.addEventListener('click', () => restartAt(state.currentIndex));
  elements.previousButton.addEventListener('click', () => restartAt(state.currentIndex - 1));
  elements.nextButton.addEventListener('click', () => restartAt(state.currentIndex + 1));
  elements.tryAgainButton.addEventListener('click', () => { state.reviewChoice = 'retry'; });
  elements.markCorrectButton.addEventListener('click', () => { state.reviewChoice = 'correct'; });
  elements.continueButton.addEventListener('click', () => { state.reviewChoice = 'continue'; });
  elements.startRow.addEventListener('change', () => {
    if (state.status === 'idle' || state.status === 'complete') {
      state.currentIndex = Number(elements.startRow.value) || 0;
      renderCurrentQuestion();
      setSessionStatus('idle', 'Ready');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (state.status === 'paused') resumeSession();
      else pauseSession();
    } else if (event.key === 'ArrowRight') restartAt(state.currentIndex + 1);
    else if (event.key === 'ArrowLeft') restartAt(state.currentIndex - 1);
    else if (event.key.toLowerCase() === 'r') restartAt(state.currentIndex);
    else if (event.key.toLowerCase() === 't' && !elements.reviewDecision.hidden) state.reviewChoice = 'retry';
    else if (event.key.toLowerCase() === 'm' && !elements.reviewDecision.hidden) state.reviewChoice = 'correct';
    else if (event.key === 'Enter' && !elements.reviewDecision.hidden) state.reviewChoice = 'continue';
    else if (event.key === 'Escape') stopSession();
  });
}
