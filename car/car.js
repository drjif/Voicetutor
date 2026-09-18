import {
  currentUser,
  initializeAuth,
  isSignedIn,
  loadSupabaseClient,
  onAuthChange
} from '../auth.js';
import {
  createSavedSourceRepository,
  reconstructSavedSourceRequest
} from '../saved-sources.js';
import {
  createStarredQuestionRepository,
  starredCountsBySource,
  starredRowsForSource
} from '../starred-questions.js';
import { buildQuestionBank, detectColumns, parseDelimited } from '../sheet-data.js';

const ui = {
  accountGate: document.querySelector('#accountGate'),
  accountStatus: document.querySelector('#accountStatus'),
  signInLink: document.querySelector('#signInLink'),
  deckPanel: document.querySelector('#deckPanel'),
  deckList: document.querySelector('#deckList'),
  deckStatus: document.querySelector('#deckStatus'),
  refreshDecks: document.querySelector('#refreshDecks'),
  drivePanel: document.querySelector('#drivePanel'),
  deckName: document.querySelector('#deckName'),
  changeDeck: document.querySelector('#changeDeck'),
  progressText: document.querySelector('#progressText'),
  syncText: document.querySelector('#syncText'),
  progressBar: document.querySelector('#progressBar'),
  questionText: document.querySelector('#questionText'),
  answerCard: document.querySelector('#answerCard'),
  answerText: document.querySelector('#answerText'),
  playButton: document.querySelector('#playButton'),
  starButton: document.querySelector('#starButton'),
  previousButton: document.querySelector('#previousButton'),
  revealButton: document.querySelector('#revealButton'),
  nextButton: document.querySelector('#nextButton'),
  recallPause: document.querySelector('#recallPause'),
  reviewSet: document.querySelector('#reviewSet'),
  mediaPlayer: document.querySelector('#mediaPlayer'),
  driveStatus: document.querySelector('#driveStatus')
};

const state = {
  sources: [],
  source: null,
  allCards: [],
  cards: [],
  index: 0,
  starredRows: new Set(),
  starRowsAll: [],
  audioManifest: null,
  playing: false,
  runToken: 0,
  answerVisible: false,
  progressTimer: null
};

let repositoriesPromise = null;

function setStatus(element, message = '', type = 'neutral') {
  element.textContent = message;
  element.dataset.type = type;
}

async function repositories() {
  if (repositoriesPromise) return repositoriesPromise;
  repositoriesPromise = (async () => {
    const client = await loadSupabaseClient();
    if (!client) throw new Error('Account sync is unavailable.');
    return {
      sources: createSavedSourceRepository(client),
      stars: createStarredQuestionRepository(client)
    };
  })();
  return repositoriesPromise;
}

function stopDrive(message = '') {
  state.runToken += 1;
  state.playing = false;
  try {
    ui.mediaPlayer.pause();
    ui.mediaPlayer.removeAttribute('src');
    ui.mediaPlayer.load();
  } catch {}
  ui.playButton.textContent = '▶ Start Drive';
  if (message) setStatus(ui.driveStatus, message);
}

function currentCard() {
  return state.cards[state.index] ?? null;
}

function renderCard({ reveal = false } = {}) {
  const card = currentCard();
  if (!card) {
    ui.questionText.textContent = 'No questions are available in this review set.';
    ui.answerCard.hidden = true;
    ui.progressText.textContent = '0 questions';
    ui.progressBar.style.width = '0%';
    ui.starButton.disabled = true;
    ui.previousButton.disabled = true;
    ui.nextButton.disabled = true;
    ui.playButton.disabled = true;
    return;
  }

  state.answerVisible = reveal;
  ui.questionText.textContent = card.question;
  ui.answerText.textContent = card.answer;
  ui.answerCard.hidden = !reveal;
  ui.revealButton.textContent = reveal ? 'Hide answer' : 'Show answer';
  ui.progressText.textContent = `Question ${state.index + 1} of ${state.cards.length}`;
  ui.progressBar.style.width = `${((state.index + 1) / state.cards.length) * 100}%`;
  ui.previousButton.disabled = state.index <= 0;
  ui.nextButton.disabled = state.index >= state.cards.length - 1;
  ui.playButton.disabled = false;

  const starred = state.starredRows.has(Number(card.sourceRow));
  ui.starButton.disabled = false;
  ui.starButton.setAttribute('aria-pressed', starred ? 'true' : 'false');
  ui.starButton.textContent = starred ? '★ Starred' : '☆ Star';

  scheduleProgressSync(card.sourceRow);
}

function scheduleProgressSync(sourceRow) {
  window.clearTimeout(state.progressTimer);
  if (!state.source?.id || !sourceRow || !isSignedIn()) return;
  ui.syncText.textContent = 'Syncing…';
  state.progressTimer = window.setTimeout(async () => {
    try {
      const { sources } = await repositories();
      const updated = await sources.touchProgress(state.source.id, {
        last_source_row: sourceRow,
        last_opened_at: new Date().toISOString()
      });
      if (state.source?.id === updated.id) state.source = updated;
      ui.syncText.textContent = 'Synced to account';
    } catch (error) {
      console.warn('Car Mode progress sync failed', error);
      ui.syncText.textContent = 'Sync unavailable';
    }
  }, 300);
}

function renderDeckList() {
  ui.deckList.replaceChildren();
  if (!state.sources.length) {
    setStatus(ui.deckStatus, 'No saved decks yet. Open a Google Sheet in same3le and save it to My decks first.');
    return;
  }

  const counts = starredCountsBySource(state.starRowsAll);
  state.sources.forEach((source) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'deck-button';
    button.dataset.sourceId = source.id;

    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = source.display_name;
    const meta = document.createElement('span');
    meta.className = 'deck-meta';
    const starCount = counts.get(source.id) ?? 0;
    const resume = source.last_source_row ? `Resume near row ${source.last_source_row}` : 'Start from the beginning';
    meta.textContent = `${starCount ? `★ ${starCount} starred · ` : ''}${resume}`;
    copy.append(title, meta);

    const arrow = document.createElement('span');
    arrow.className = 'deck-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '›';
    button.append(copy, arrow);
    button.addEventListener('click', () => openDeck(source));
    ui.deckList.append(button);
  });
  setStatus(ui.deckStatus, `${state.sources.length} saved deck${state.sources.length === 1 ? '' : 's'} available.`, 'success');
}

async function refreshDecks() {
  if (!isSignedIn()) return;
  ui.refreshDecks.disabled = true;
  setStatus(ui.deckStatus, 'Loading your decks…', 'loading');
  try {
    const { sources, stars } = await repositories();
    const [savedSources, allStars] = await Promise.all([sources.list(), stars.listAll()]);
    state.sources = savedSources;
    state.starRowsAll = allStars;
    renderDeckList();
  } catch (error) {
    console.warn('Car Mode decks could not be loaded', error);
    setStatus(ui.deckStatus, error.message || 'Could not load your saved decks.', 'error');
  } finally {
    ui.refreshDecks.disabled = false;
  }
}

async function fetchSheetRows(source) {
  const request = reconstructSavedSourceRequest(source);
  const candidates = [...new Set([request.exportCsvUrl, request.csvUrl].filter(Boolean))];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      url.searchParams.set('_', String(Date.now()));
      const response = await fetch(url, { cache: 'no-store', redirect: 'follow' });
      if (!response.ok) throw new Error(`Google returned HTTP ${response.status}`);
      const text = await response.text();
      if (/<!doctype html|<html/i.test(text)) throw new Error('The saved Sheet is not publicly readable.');
      const rows = parseDelimited(text);
      if (rows.length < 2) throw new Error('The saved Sheet does not contain enough rows.');
      return rows;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Could not load the saved Sheet.');
}

function recordsFromRows(rows) {
  const detection = detectColumns(rows, true);
  return buildQuestionBank(rows, {
    hasHeaders: true,
    headerRowIndex: detection.headerRowIndex,
    questionIndex: detection.questionIndex,
    answerIndex: detection.answerIndex,
    acceptedIndex: detection.acceptedIndex
  });
}

async function loadAudioManifest(sourceId) {
  const explicit = new URLSearchParams(window.location.search).get('manifest');
  const candidates = explicit
    ? [explicit]
    : [`../car-audio/manifests/${encodeURIComponent(sourceId)}.json`];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { cache: 'no-store' });
      if (!response.ok) continue;
      const manifest = await response.json();
      if (manifest?.cards && typeof manifest.cards === 'object') return manifest;
    } catch {
      // A missing manifest simply means this deck has not had Tesla-safe audio prepared yet.
    }
  }
  return null;
}

async function openDeck(source) {
  stopDrive();
  setStatus(ui.deckStatus, `Loading ${source.display_name}…`, 'loading');
  try {
    const { stars } = await repositories();
    const [rows, savedStars, manifest] = await Promise.all([
      fetchSheetRows(source),
      stars.listForSource(source.id),
      loadAudioManifest(source.id)
    ]);
    const cards = recordsFromRows(rows);
    if (!cards.length) throw new Error('No usable question-answer rows were found in this deck.');

    state.source = source;
    state.allCards = cards;
    state.cards = cards;
    state.starredRows = new Set(starredRowsForSource(savedStars, source.id));
    state.audioManifest = manifest;
    state.index = 0;

    if (source.last_source_row) {
      const resumeIndex = cards.findIndex((card) => Number(card.sourceRow) === Number(source.last_source_row));
      if (resumeIndex >= 0) state.index = resumeIndex;
    }

    ui.deckName.textContent = source.display_name;
    ui.deckPanel.hidden = true;
    ui.accountGate.hidden = true;
    ui.drivePanel.hidden = false;
    ui.reviewSet.value = 'all';
    renderCard();

    if (manifest) {
      setStatus(ui.driveStatus, 'Tesla-safe audio is ready for this deck.', 'success');
    } else {
      setStatus(ui.driveStatus, 'This deck is connected and synced, but its MP3 audio has not been prepared yet.', 'loading');
    }
  } catch (error) {
    console.warn('Car Mode deck load failed', error);
    setStatus(ui.deckStatus, error.message || 'Could not open that deck.', 'error');
  }
}

function applyReviewSet() {
  stopDrive();
  const previousRow = currentCard()?.sourceRow ?? null;
  if (ui.reviewSet.value === 'starred') {
    state.cards = state.allCards.filter((card) => state.starredRows.has(Number(card.sourceRow)));
  } else {
    state.cards = state.allCards;
  }
  const retainedIndex = previousRow
    ? state.cards.findIndex((card) => Number(card.sourceRow) === Number(previousRow))
    : -1;
  state.index = retainedIndex >= 0 ? retainedIndex : 0;
  renderCard();
  if (ui.reviewSet.value === 'starred' && !state.cards.length) {
    setStatus(ui.driveStatus, 'No questions in this deck are starred yet. Switch to Full deck or star questions first.');
  }
}

async function toggleStar() {
  const card = currentCard();
  if (!card || !state.source?.id || !isSignedIn()) return;
  const sourceRow = Number(card.sourceRow);
  if (!Number.isInteger(sourceRow) || sourceRow <= 0) return;

  ui.starButton.disabled = true;
  try {
    const { stars } = await repositories();
    if (state.starredRows.has(sourceRow)) {
      await stars.remove(state.source.id, sourceRow);
      state.starredRows.delete(sourceRow);
      setStatus(ui.driveStatus, 'Removed from Starred questions.', 'success');
    } else {
      await stars.add(state.source.id, sourceRow);
      state.starredRows.add(sourceRow);
      setStatus(ui.driveStatus, 'Starred. This will also appear starred in your regular same3le deck.', 'success');
    }
    renderCard({ reveal: state.answerVisible });
  } catch (error) {
    console.warn('Car Mode star update failed', error);
    setStatus(ui.driveStatus, error.message || 'Could not update this star.', 'error');
  } finally {
    ui.starButton.disabled = false;
  }
}

function audioEntry(card) {
  if (!state.audioManifest || !card) return null;
  return state.audioManifest.cards?.[String(card.sourceRow)] ?? null;
}

function wait(ms, token) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (token !== state.runToken || !state.playing) {
        reject(new DOMException('Drive stopped', 'AbortError'));
        return;
      }
      const remaining = ms - (Date.now() - started);
      if (remaining <= 0) resolve();
      else window.setTimeout(tick, Math.min(remaining, 150));
    };
    tick();
  });
}

function playMedia(url, token) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('This question does not have prepared audio yet.'));
      return;
    }
    if (token !== state.runToken || !state.playing) {
      reject(new DOMException('Drive stopped', 'AbortError'));
      return;
    }

    const cleanup = () => {
      ui.mediaPlayer.removeEventListener('ended', handleEnded);
      ui.mediaPlayer.removeEventListener('error', handleError);
    };
    const handleEnded = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error('Tesla could not play one of the prepared audio files.'));
    };
    ui.mediaPlayer.addEventListener('ended', handleEnded, { once: true });
    ui.mediaPlayer.addEventListener('error', handleError, { once: true });
    ui.mediaPlayer.src = url;
    ui.mediaPlayer.play().catch((error) => {
      cleanup();
      reject(error);
    });
  });
}

async function runDrive() {
  if (!state.cards.length || state.playing) return;
  if (!state.audioManifest) {
    setStatus(ui.driveStatus, 'Audio for this deck has not been prepared yet. The account, stars, and resume position are already connected; MP3 generation is the remaining backend step.', 'error');
    return;
  }

  state.playing = true;
  state.runToken += 1;
  const token = state.runToken;
  ui.playButton.textContent = '■ Stop Drive';

  try {
    while (state.index < state.cards.length && token === state.runToken && state.playing) {
      const card = currentCard();
      const audio = audioEntry(card);
      renderCard({ reveal: false });
      setStatus(ui.driveStatus, 'Reading question…', 'loading');
      await playMedia(audio?.question, token);
      setStatus(ui.driveStatus, `Recall pause: ${ui.recallPause.value} seconds`, 'loading');
      await wait(Number(ui.recallPause.value) * 1000, token);
      renderCard({ reveal: true });
      setStatus(ui.driveStatus, 'Reading answer…', 'loading');
      await playMedia(audio?.answer, token);
      await wait(1200, token);
      if (state.index >= state.cards.length - 1) break;
      state.index += 1;
    }

    if (token === state.runToken && state.playing) {
      state.playing = false;
      ui.playButton.textContent = '▶ Start Drive';
      setStatus(ui.driveStatus, 'Drive review complete.', 'success');
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.warn('Car Mode playback stopped', error);
    stopDrive(error.message || 'Playback stopped unexpectedly.');
    ui.driveStatus.dataset.type = 'error';
  }
}

function changeIndex(delta) {
  stopDrive();
  if (!state.cards.length) return;
  state.index = Math.max(0, Math.min(state.cards.length - 1, state.index + delta));
  renderCard();
}

async function handleAuthSnapshot(snapshot) {
  const signedIn = snapshot?.status === 'signed-in' && Boolean(snapshot?.user?.id || currentUser()?.id);
  if (!signedIn) {
    stopDrive();
    ui.accountGate.hidden = false;
    ui.deckPanel.hidden = true;
    ui.drivePanel.hidden = true;
    ui.signInLink.hidden = false;
    ui.accountStatus.textContent = snapshot?.status === 'unavailable'
      ? 'Account sync is unavailable right now.'
      : 'Sign in first so Car Mode can use your saved decks, stars, and resume position.';
    return;
  }

  ui.accountStatus.textContent = `Signed in as ${snapshot.email || currentUser()?.email || 'your account'}.`;
  ui.signInLink.hidden = true;
  ui.accountGate.hidden = true;
  ui.deckPanel.hidden = false;
  ui.drivePanel.hidden = true;
  await refreshDecks();
}

ui.refreshDecks.addEventListener('click', refreshDecks);
ui.changeDeck.addEventListener('click', () => {
  stopDrive();
  ui.drivePanel.hidden = true;
  ui.deckPanel.hidden = false;
  refreshDecks();
});
ui.previousButton.addEventListener('click', () => changeIndex(-1));
ui.nextButton.addEventListener('click', () => changeIndex(1));
ui.revealButton.addEventListener('click', () => renderCard({ reveal: !state.answerVisible }));
ui.starButton.addEventListener('click', toggleStar);
ui.reviewSet.addEventListener('change', applyReviewSet);
ui.playButton.addEventListener('click', () => {
  if (state.playing) stopDrive('Drive review stopped.');
  else runDrive();
});

onAuthChange(handleAuthSnapshot);
const initialAuth = await initializeAuth();
await handleAuthSnapshot(initialAuth);
