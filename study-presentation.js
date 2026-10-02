let sessionPanel = null;
let questionText = null;
let answerCard = null;
let showAnswerButton = null;
let navigationControls = null;
let manualAnswerVisible = false;
let lastQuestion = '';
let reconcileQueued = false;
let initialized = false;

export function answerPresentationModel({ phase = 'question', manualAnswerVisible: manual = false } = {}) {
  const automaticAnswer = phase === 'answer' || phase === 'feedback';
  return {
    showAnswer: automaticAnswer || Boolean(manual),
    showRevealControl: !automaticAnswer,
    revealLabel: manual ? 'Hide answer' : 'Show answer'
  };
}

function installStyles() {
  if (document.getElementById('same3le-study-presentation-styles')) return;
  const style = document.createElement('style');
  style.id = 'same3le-study-presentation-styles';
  style.textContent = `
    .question-reveal-controls {
      display: grid;
      margin: 12px 0 0;
    }

    .question-reveal-controls .button {
      width: 100%;
      min-height: 48px;
    }

    .answer-navigation-controls {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin: 14px 0 0;
    }

    .answer-navigation-controls .button,
    .answer-navigation-controls .icon-button {
      width: 100%;
      min-height: 48px;
    }

    @media (max-width: 640px) {
      .answer-navigation-controls { grid-template-columns: 1fr; }
    }
  `;
  document.head.append(style);
}

function ensureLayout() {
  sessionPanel = document.querySelector('#sessionPanel');
  questionText = document.querySelector('#currentQuestion');
  answerCard = document.querySelector('#answerCard');
  const questionCard = questionText?.closest('.question-card');
  const previousButton = document.querySelector('#previousButton');
  const nextButton = document.querySelector('#nextButton');
  if (!sessionPanel || !questionCard || !answerCard || !previousButton || !nextButton) return false;

  let revealControls = document.querySelector('#manualAnswerControls');
  if (!revealControls) {
    revealControls = document.createElement('div');
    revealControls.id = 'manualAnswerControls';
    revealControls.className = 'question-reveal-controls';
    revealControls.innerHTML = '<button id="showAnswerButton" class="button secondary" type="button">Show answer</button>';
    questionCard.insertAdjacentElement('afterend', revealControls);
  }
  showAnswerButton = revealControls.querySelector('#showAnswerButton');

  navigationControls = document.querySelector('#answerNavigationControls');
  if (!navigationControls) {
    navigationControls = document.createElement('div');
    navigationControls.id = 'answerNavigationControls';
    navigationControls.className = 'answer-navigation-controls';
    navigationControls.setAttribute('aria-label', 'Question navigation');
    answerCard.insertAdjacentElement('afterend', navigationControls);
  }

  navigationControls.append(previousButton, nextButton);
  return true;
}

function setHidden(element, hidden) {
  if (!element || element.hidden === hidden) return;
  element.hidden = hidden;
}

function reconcile() {
  reconcileQueued = false;
  if (!sessionPanel || !questionText || !answerCard || !showAnswerButton) return;

  const currentQuestion = questionText.textContent || '';
  if (currentQuestion !== lastQuestion) {
    lastQuestion = currentQuestion;
    manualAnswerVisible = false;
  }

  const model = answerPresentationModel({
    phase: sessionPanel.dataset.phase || 'question',
    manualAnswerVisible
  });

  setHidden(answerCard, !model.showAnswer);
  setHidden(showAnswerButton, !model.showRevealControl);
  showAnswerButton.textContent = model.revealLabel;
  showAnswerButton.setAttribute('aria-expanded', model.showAnswer ? 'true' : 'false');
}

function scheduleReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcile);
}

function toggleManualAnswer() {
  manualAnswerVisible = !manualAnswerVisible;
  reconcile();
  if (!manualAnswerVisible || answerCard?.hidden) return;

  window.requestAnimationFrame(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    answerCard.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  });
}

export function setupStudyPresentation() {
  if (initialized) return;
  installStyles();
  if (!ensureLayout()) return;
  initialized = true;
  lastQuestion = questionText.textContent || '';

  showAnswerButton.addEventListener('click', toggleManualAnswer);

  const observer = new MutationObserver(scheduleReconcile);
  observer.observe(sessionPanel, { attributes: true, attributeFilter: ['data-phase', 'hidden'] });
  observer.observe(answerCard, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(questionText, { childList: true, characterData: true, subtree: true });

  reconcile();
}
