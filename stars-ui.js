import { isSignedIn, loadSupabaseClient, onAuthChange } from './auth.js';
import { state } from './dom.js';
import { createStarredQuestionRepository, starredRowsForSource } from './starred-questions.js';

let loadedSourceId = null;
let starredRows = new Set();
let starRequestInFlight = false;

async function repository() {
  const client = await loadSupabaseClient();
  return client ? createStarredQuestionRepository(client) : null;
}

function ensureStarControls() {
  const card = document.querySelector('.question-card');
  const question = document.querySelector('#currentQuestion');
  if (!card || !question) return { button: null, status: null };

  let button = document.querySelector('#starQuestionButton');
  if (!button) {
    button = document.createElement('button');
    button.id = 'starQuestionButton';
    button.type = 'button';
    button.className = 'button ghost compact-button';
    button.hidden = true;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', 'Star this question');
    button.style.float = 'right';
    button.style.margin = '-4px 0 8px 12px';
    card.insertBefore(button, question);
  }

  let status = document.querySelector('#starQuestionStatus');
  if (!status) {
    status = document.createElement('span');
    status.id = 'starQuestionStatus';
    status.className = 'sr-only';
    status.setAttribute('aria-live', 'polite');
    card.insertBefore(status, question);
  }

  return { button, status };
}

function currentSourceRow() {
  const value = Number(state.questions[state.currentIndex]?.sourceRow);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function canUseCloudStars() {
  return isSignedIn()
    && state.sourceKind === 'google-sheet'
    && Boolean(state.savedSourceId)
    && Boolean(currentSourceRow());
}

function setStarStatus(message = '') {
  const { status } = ensureStarControls();
  if (status) status.textContent = message;
}

export function renderStarControl() {
  const { button } = ensureStarControls();
  if (!button) return;

  const sourceRow = currentSourceRow();
  const ready = canUseCloudStars() && loadedSourceId === state.savedSourceId;
  button.hidden = !ready;
  if (!ready) {
    button.disabled = false;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = '☆ Star';
    return;
  }

  const isStarred = starredRows.has(sourceRow);
  button.disabled = starRequestInFlight;
  button.setAttribute('aria-pressed', isStarred ? 'true' : 'false');
  button.setAttribute('aria-label', isStarred ? 'Remove star from this question' : 'Star this question');
  button.textContent = isStarred ? '★ Starred' : '☆ Star';
  button.title = isStarred ? 'Remove this question from Starred questions' : 'Save this question to Starred questions';
}

export async function refreshCurrentStars() {
  if (!isSignedIn() || state.sourceKind !== 'google-sheet' || !state.savedSourceId) {
    loadedSourceId = null;
    starredRows = new Set();
    renderStarControl();
    return [];
  }

  const sourceId = state.savedSourceId;
  const repo = await repository();
  if (!repo) {
    loadedSourceId = null;
    starredRows = new Set();
    renderStarControl();
    return [];
  }

  try {
    const rows = await repo.listForSource(sourceId);
    if (state.savedSourceId !== sourceId) return [];
    loadedSourceId = sourceId;
    starredRows = new Set(starredRowsForSource(rows, sourceId));
    setStarStatus('');
    renderStarControl();
    return [...starredRows];
  } catch (error) {
    console.warn('Starred questions could not be loaded', error);
    if (state.savedSourceId === sourceId) {
      loadedSourceId = null;
      starredRows = new Set();
      setStarStatus('Starred questions are temporarily unavailable.');
      renderStarControl();
    }
    return [];
  }
}

export function currentStarredRows() {
  return loadedSourceId === state.savedSourceId ? [...starredRows].sort((a, b) => a - b) : [];
}

async function toggleCurrentQuestionStar() {
  if (!canUseCloudStars() || starRequestInFlight) return;
  const sourceId = state.savedSourceId;
  const sourceRow = currentSourceRow();
  if (!sourceRow) return;

  const repo = await repository();
  if (!repo) return;

  const wasStarred = loadedSourceId === sourceId && starredRows.has(sourceRow);
  starRequestInFlight = true;
  renderStarControl();
  try {
    if (wasStarred) {
      await repo.remove(sourceId, sourceRow);
      starredRows.delete(sourceRow);
      setStarStatus('Removed from Starred questions.');
    } else {
      await repo.add(sourceId, sourceRow);
      if (loadedSourceId !== sourceId) starredRows = new Set();
      loadedSourceId = sourceId;
      starredRows.add(sourceRow);
      setStarStatus('Saved to Starred questions.');
    }
    window.dispatchEvent(new CustomEvent('same3le:stars-changed', {
      detail: { savedSourceId: sourceId }
    }));
  } catch (error) {
    console.warn('Starred question could not be updated', error);
    setStarStatus('Could not update this star. Try again.');
  } finally {
    starRequestInFlight = false;
    renderStarControl();
  }
}

export function setupStarredQuestionUI() {
  const { button } = ensureStarControls();
  button?.addEventListener('click', toggleCurrentQuestionStar);
  onAuthChange(async (snapshot) => {
    if (snapshot.status === 'signed-in') await refreshCurrentStars();
    else {
      loadedSourceId = null;
      starredRows = new Set();
      renderStarControl();
    }
  });
  renderStarControl();
}
