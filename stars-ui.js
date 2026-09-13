import { isSignedIn, loadSupabaseClient, onAuthChange } from './auth.js';
import { refreshMyDecks } from './account-ui.js';
import { elements, state, updateControls } from './dom.js';
import {
  createSavedSourceRepository,
  inferDeckDisplayName
} from './saved-sources.js';
import { loadSavedGoogleSheet } from './sheet-v2.js';
import {
  canOfferStarredQuestion,
  createStarredQuestionRepository,
  findSavedSourceForSheet,
  starredCountsBySource,
  starredRowsForSource
} from './starred-questions.js';

let loadedSourceId = null;
let starredRows = new Set();
let starRequestInFlight = false;
let decoratingDecks = false;
let resolvingSourcePromise = null;

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

function currentQuestionCanBeStarred() {
  return canOfferStarredQuestion({
    sourceKind: state.sourceKind,
    sourceRow: currentSourceRow()
  });
}

function currentQuestionIsStarred() {
  const sourceRow = currentSourceRow();
  return Boolean(
    sourceRow
    && state.savedSourceId
    && loadedSourceId === state.savedSourceId
    && starredRows.has(sourceRow)
  );
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

function focusSignIn() {
  const panel = document.querySelector('#signInPanel');
  panel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => document.querySelector('#accountEmail')?.focus(), 250);
}

export function renderStarControl() {
  const { button } = ensureStarControls();
  if (!button) return;

  const eligible = currentQuestionCanBeStarred();
  button.hidden = !eligible;
  if (!eligible) {
    button.disabled = false;
    button.setAttribute('aria-pressed', 'false');
    if (button.textContent !== '☆ Star') button.textContent = '☆ Star';
    return;
  }

  const isStarred = currentQuestionIsStarred();
  const label = starRequestInFlight
    ? (isStarred ? '★ Updating…' : '☆ Saving…')
    : (isStarred ? '★ Starred' : '☆ Star');

  button.disabled = starRequestInFlight;
  button.setAttribute('aria-pressed', isStarred ? 'true' : 'false');
  button.setAttribute('aria-label', isStarred ? 'Remove star from this question' : 'Star this question');
  if (button.textContent !== label) button.textContent = label;

  if (!isSignedIn()) {
    button.title = 'Sign in to star this question and sync it across devices.';
  } else if (!state.savedSourceId) {
    button.title = 'Star this question. same3le will save this Google Sheet reference to My decks so the star can sync.';
  } else {
    button.title = isStarred ? 'Remove this question from Starred questions' : 'Save this question to Starred questions';
  }
}

async function resolveCurrentSavedSource({ createIfMissing = false } = {}) {
  if (!isSignedIn() || !currentQuestionCanBeStarred()) return null;
  if (state.savedSourceId) return state.savedSourceId;
  if (resolvingSourcePromise) return resolvingSourcePromise;

  const identity = state.googleSheetIdentity;
  if (!identity?.spreadsheetId) return null;

  resolvingSourcePromise = (async () => {
    const { sources } = await repositories();
    if (!sources) return null;

    const savedSources = await sources.list();
    const existing = findSavedSourceForSheet(savedSources, identity);
    if (existing?.id) {
      state.savedSourceId = existing.id;
      return existing.id;
    }

    if (!createIfMissing) return null;

    const result = await sources.upsert({
      source_type: 'google-sheet',
      spreadsheet_id: identity.spreadsheetId,
      sheet_gid: identity.sheetGid,
      display_name: inferDeckDisplayName({ displayName: state.sourceName }),
      last_source_row: currentSourceRow(),
      last_opened_at: new Date().toISOString()
    });
    state.savedSourceId = result.record.id;
    state.sourceName = result.record.display_name;
    await refreshMyDecks();
    return result.record.id;
  })();

  try {
    return await resolvingSourcePromise;
  } finally {
    resolvingSourcePromise = null;
  }
}

export async function refreshCurrentStars() {
  if (!isSignedIn() || !currentQuestionCanBeStarred()) {
    loadedSourceId = null;
    starredRows = new Set();
    renderStarControl();
    return [];
  }

  try {
    const sourceId = state.savedSourceId || await resolveCurrentSavedSource({ createIfMissing: false });
    if (!sourceId) {
      loadedSourceId = null;
      starredRows = new Set();
      renderStarControl();
      return [];
    }

    if (loadedSourceId === sourceId) {
      renderStarControl();
      return [...starredRows];
    }

    const { stars } = await repositories();
    if (!stars) return [];
    const rows = await stars.listForSource(sourceId);
    if (state.savedSourceId !== sourceId) return [];
    loadedSourceId = sourceId;
    starredRows = new Set(starredRowsForSource(rows, sourceId));
    setStarStatus('');
    renderStarControl();
    return [...starredRows];
  } catch (error) {
    console.warn('Starred questions could not be loaded', error);
    loadedSourceId = null;
    starredRows = new Set();
    setStarStatus('Starred questions are temporarily unavailable.');
    renderStarControl();
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
  if (!currentQuestionCanBeStarred() || starRequestInFlight) return;

  if (!isSignedIn()) {
    setStarStatus('Sign in to star this question and sync it across devices.');
    focusSignIn();
    return;
  }

  const sourceRow = currentSourceRow();
  if (!sourceRow) return;

  starRequestInFlight = true;
  renderStarControl();
  try {
    const sourceId = await resolveCurrentSavedSource({ createIfMissing: true });
    if (!sourceId) throw new Error('This Google Sheet could not be connected to My decks.');

    const { stars } = await repositories();
    if (!stars) throw new Error('Account sync is unavailable.');

    if (loadedSourceId !== sourceId) {
      const rows = await stars.listForSource(sourceId);
      loadedSourceId = sourceId;
      starredRows = new Set(starredRowsForSource(rows, sourceId));
    }

    const wasStarred = starredRows.has(sourceRow);
    if (wasStarred) {
      await stars.remove(sourceId, sourceRow);
      starredRows.delete(sourceRow);
      setStarStatus('Removed from Starred questions.');
    } else {
      await stars.add(sourceId, sourceRow);
      starredRows.add(sourceRow);
      setStarStatus('Saved to Starred questions.');
    }

    window.dispatchEvent(new CustomEvent('same3le:stars-changed', {
      detail: { savedSourceId: sourceId }
    }));
  } catch (error) {
    console.warn('Starred question could not be updated', error);
    setStarStatus(error.message || 'Could not update this star. Try again.');
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
      const countText = count ? `★ ${count} starred` : '☆ No starred questions yet';
      if (countLabel.textContent !== countText) countLabel.textContent = countText;

      let reviewButton = actions.querySelector('[data-deck-starred]');
      if (!reviewButton) {
        reviewButton = document.createElement('button');
        reviewButton.type = 'button';
        reviewButton.className = 'button secondary';
        reviewButton.dataset.deckStarred = '';
        actions.insertBefore(reviewButton, actions.querySelector('[data-deck-rename]'));
      }
      reviewButton.disabled = count === 0;
      const buttonText = count ? `★ Review starred (${count})` : '☆ Review starred';
      if (reviewButton.textContent !== buttonText) reviewButton.textContent = buttonText;
    });
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
    // Visibility is synchronous: the star is available with the question,
    // before any answer reveal or background account lookup completes.
    renderStarControl();
    if (isSignedIn() && currentQuestionCanBeStarred()) refreshCurrentStars();
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
    // Always render first so account/network work can never delay the control.
    renderStarControl();
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
