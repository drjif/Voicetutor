import { isSignedIn, loadSupabaseClient, onAuthChange } from './auth.js';
import { elements, state, updateControls } from './dom.js';
import { createSavedSourceRepository } from './saved-sources.js';
import { loadSavedGoogleSheet } from './sheet-v2.js';
import {
  createStarredQuestionRepository,
  starredCountsBySource,
  starredRowsForSource
} from './starred-questions.js';

let loadedSourceId = null;
let starredRows = new Set();
let starRequestInFlight = false;
let decoratingDecks = false;

async function repositories() {
  const client = await loadSupabaseClient();
  if (!client) return { stars: null, sources: null };
  return {
    stars: createStarredQuestionRepository(client),
    sources: createSavedSourceRepository(client)
  };
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

function setDeckStatus(message = '', type = 'neutral') {
  const status = document.querySelector('#myDecksStatus');
  if (!status) return;
  status.hidden = !message;
  status.textContent = message;
  status.dataset.type = type;
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
  const { stars } = await repositories();
  if (!stars) {
    loadedSourceId = null;
    starredRows = new Set();
    renderStarControl();
    return [];
  }

  try {
    const rows = await stars.listForSource(sourceId);
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

export function applyStarredQuestionSubset(sourceRows) {
  const wanted = new Set((sourceRows ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0));
  const filtered = state.questions.filter((item) => wanted.has(Number(item.sourceRow)));
  if (!filtered.length) return 0;

  state.questions = filtered;
  if (state.currentDeck) state.currentDeck = { ...state.currentDeck, cards: filtered };
  state.currentIndex = 0;
  state.pausedIndex = null;
  state.resumeSourceRow = null;
  state.reviewingStarred = true;

  elements.startRow.replaceChildren();
  filtered.forEach((item, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `Starred ${index + 1} — Sheet row ${item.sourceRow}`;
    elements.startRow.append(option);
  });
  elements.startRow.disabled = false;
  elements.startRow.value = '0';
  elements.bankSummary.textContent = `${filtered.length} starred question${filtered.length === 1 ? '' : 's'} ready.`;
  updateControls();
  renderStarControl();
  return filtered.length;
}

async function toggleCurrentQuestionStar() {
  if (!canUseCloudStars() || starRequestInFlight) return;
  const sourceId = state.savedSourceId;
  const sourceRow = currentSourceRow();
  if (!sourceRow) return;

  const { stars } = await repositories();
  if (!stars) return;

  const wasStarred = loadedSourceId === sourceId && starredRows.has(sourceRow);
  starRequestInFlight = true;
  renderStarControl();
  try {
    if (wasStarred) {
      await stars.remove(sourceId, sourceRow);
      starredRows.delete(sourceRow);
      setStarStatus('Removed from Starred questions.');
    } else {
      await stars.add(sourceId, sourceRow);
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

async function refreshDeckStarDecorations() {
  const list = document.querySelector('#myDecksList');
  if (!list || decoratingDecks || !isSignedIn()) return;
  decoratingDecks = true;
  try {
    const { stars } = await repositories();
    if (!stars) return;
    const allStars = await stars.listAll();
    const counts = starredCountsBySource(allStars);

    list.querySelectorAll('.deck-card').forEach((card) => {
      const sourceId = card.dataset.sourceId;
      const count = counts.get(sourceId) ?? 0;
      const copy = card.querySelector('.deck-card-copy');
      const actions = card.querySelector('.deck-card-actions');
      if (!copy || !actions) return;

      let countLabel = copy.querySelector('[data-star-count]');
      if (!countLabel) {
        countLabel = document.createElement('p');
        countLabel.dataset.starCount = '';
        countLabel.className = 'deck-opened';
        copy.append(countLabel);
      }
      countLabel.textContent = count ? `★ ${count} starred` : '☆ No starred questions yet';

      let reviewButton = actions.querySelector('[data-deck-starred]');
      if (!reviewButton) {
        reviewButton = document.createElement('button');
        reviewButton.type = 'button';
        reviewButton.className = 'button secondary';
        reviewButton.dataset.deckStarred = '';
        actions.insertBefore(reviewButton, actions.querySelector('[data-deck-rename]'));
      }
      reviewButton.disabled = count === 0;
      reviewButton.textContent = count ? `★ Review starred (${count})` : '☆ Review starred';
    });

    if (canUseCloudStars() && loadedSourceId !== state.savedSourceId) {
      await refreshCurrentStars();
    }
  } catch (error) {
    console.warn('Star counts could not be loaded', error);
  } finally {
    decoratingDecks = false;
  }
}

async function reviewStarredDeck(card) {
  if (!isSignedIn()) return;
  const sourceId = card?.dataset?.sourceId;
  if (!sourceId) return;
  setDeckStatus('Loading your starred questions…', 'loading');

  try {
    const { stars, sources } = await repositories();
    if (!stars || !sources) throw new Error('Account sync is unavailable.');
    const [starRows, decks] = await Promise.all([
      stars.listForSource(sourceId),
      sources.list()
    ]);
    const deck = decks.find((item) => item.id === sourceId);
    if (!deck) throw new Error('That saved deck could not be found.');
    const sourceRows = starredRowsForSource(starRows, sourceId);
    if (!sourceRows.length) {
      setDeckStatus('This deck has no starred questions yet.', 'neutral');
      return;
    }

    await loadSavedGoogleSheet(deck);
    const matchedCount = applyStarredQuestionSubset(sourceRows);
    if (!matchedCount) {
      setDeckStatus('Your saved stars no longer match rows in the current Google Sheet. Open the full deck and star the questions again.', 'warning');
      return;
    }

    await refreshCurrentStars();
    const missing = sourceRows.length - matchedCount;
    setDeckStatus(
      missing > 0
        ? `${matchedCount} starred question${matchedCount === 1 ? '' : 's'} ready. ${missing} saved star${missing === 1 ? '' : 's'} no longer matches the current Sheet rows.`
        : `${matchedCount} starred question${matchedCount === 1 ? '' : 's'} ready.`,
      missing > 0 ? 'warning' : 'success'
    );
    document.querySelector('#session-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    elements.startButton?.focus();
  } catch (error) {
    console.warn('Starred review could not be opened', error);
    setDeckStatus(error.message || 'Starred questions could not be opened.', 'error');
  }
}

function observeCurrentQuestion() {
  const question = document.querySelector('#currentQuestion');
  if (!question) return;
  const observer = new MutationObserver(() => {
    if (canUseCloudStars() && loadedSourceId !== state.savedSourceId) refreshCurrentStars();
    else renderStarControl();
  });
  observer.observe(question, { childList: true, characterData: true, subtree: true });
}

function observeMyDecks() {
  const list = document.querySelector('#myDecksList');
  if (!list) return;
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-deck-starred]');
    if (!button) return;
    const card = button.closest('.deck-card');
    reviewStarredDeck(card);
  });
  const observer = new MutationObserver(() => refreshDeckStarDecorations());
  observer.observe(list, { childList: true, subtree: true });
}

export function setupStarredQuestionUI() {
  const { button } = ensureStarControls();
  button?.addEventListener('click', toggleCurrentQuestionStar);
  observeCurrentQuestion();
  observeMyDecks();
  window.addEventListener('same3le:stars-changed', refreshDeckStarDecorations);
  onAuthChange(async (snapshot) => {
    if (snapshot.status === 'signed-in') {
      await Promise.all([refreshCurrentStars(), refreshDeckStarDecorations()]);
    } else {
      loadedSourceId = null;
      starredRows = new Set();
      renderStarControl();
    }
  });
  renderStarControl();
  refreshDeckStarDecorations();
}
