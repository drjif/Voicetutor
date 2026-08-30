import {
  currentUser,
  initializeAuth,
  isSignedIn,
  loadSupabaseClient,
  onAuthChange,
  requestEmailSignIn,
  signOutAccount,
  verifyEmailCode
} from './auth.js';
import { AUTH_STATUS, accountViewModel, formatLastOpened } from './auth-state.js';
import {
  SOURCE_TYPE_LABEL,
  createSavedSourceRepository,
  inferDeckDisplayName
} from './saved-sources.js';
import { elements, onProgressSaved, state } from './dom.js';

const SIGN_IN_PROMPT = 'Sign in to use this deck on your other devices.';
const SAVE_FAILURE = 'The deck could not be saved. Your current study session is unchanged.';
const LOAD_FAILURE = 'That saved sheet could not be opened. The current study session was left as it is.';

let decks = [];
let lastSnapshot = { status: AUTH_STATUS.signedOut, configured: false };
let loadSavedSheet = async () => {};
let progressSyncTimer = 0;

function qs(id) {
  return document.getElementById(id);
}

function setStatus(element, message, type = 'neutral') {
  if (!element) return;
  element.hidden = !message;
  element.textContent = message || '';
  element.dataset.type = type;
}

async function repository() {
  const client = await loadSupabaseClient();
  return client ? createSavedSourceRepository(client) : null;
}

function view() {
  return accountViewModel(lastSnapshot);
}

function currentGoogleSheetIdentity() {
  return state.googleSheetIdentity || null;
}

export function setSavedSheetLoader(loader) {
  loadSavedSheet = loader;
}

function renderAccountChrome() {
  const model = view();
  const headerButton = qs('accountHeaderButton');
  const signInPanel = qs('signInPanel');
  const signedInPanel = qs('accountSignedInPanel');
  const myDecksPanel = qs('myDecksPanel');
  const otpForm = qs('otpForm');
  const signInForm = qs('signInForm');
  const status = qs('accountStatus');
  const emailLabel = qs('accountEmailLabel');

  if (headerButton) {
    headerButton.hidden = false;
    headerButton.textContent = model.headerLabel;
  }
  if (signInPanel) signInPanel.hidden = model.showSignedIn;
  if (signedInPanel) signedInPanel.hidden = !model.showSignedIn;
  if (myDecksPanel) myDecksPanel.hidden = !model.showMyDecks;
  if (signInForm) signInForm.hidden = !model.showSignInForm;
  if (otpForm) otpForm.hidden = !model.showCodeForm;
  if (emailLabel) emailLabel.textContent = lastSnapshot.email || currentUser()?.email || '';
  setStatus(status, model.statusMessage, model.statusType);
  renderSaveAvailability();
}

function renderSaveAvailability() {
  const actions = qs('sheetReadyActions');
  const saveButton = qs('saveToAccountButton');
  const saveForm = qs('saveDeckForm');
  const saveStatus = qs('saveDeckStatus');
  const identity = currentGoogleSheetIdentity();
  const model = view();
  if (!actions || !identity) return;

  actions.hidden = false;
  if (saveButton) {
    saveButton.hidden = false;
    saveButton.textContent = model.canSaveToAccount ? 'Save to my account' : 'Sign in to use this deck on your other devices.';
  }
  if (!model.canSaveToAccount && saveForm) saveForm.hidden = true;
  if (saveStatus && !saveStatus.textContent) saveStatus.hidden = true;
}

function renderMyDecks() {
  const list = qs('myDecksList');
  const empty = qs('myDecksEmpty');
  if (!list) return;
  list.replaceChildren();

  if (!view().showMyDecks) {
    if (empty) empty.hidden = true;
    return;
  }

  if (!decks.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  decks.forEach((deck) => {
    const card = document.createElement('article');
    card.className = 'deck-card';
    card.dataset.sourceId = deck.id;
    const opened = formatLastOpened(deck.last_opened_at);
    card.innerHTML = `
      <div class="deck-card-copy">
        <h3>${escapeHtml(deck.display_name)}</h3>
        <p class="deck-source-type">${SOURCE_TYPE_LABEL}</p>
        ${opened ? `<p class="deck-opened">${escapeHtml(opened)}</p>` : ''}
      </div>
      <div class="deck-card-actions">
        <button class="button primary" type="button" data-deck-study>Study</button>
        <button class="button secondary" type="button" data-deck-rename>Rename</button>
        <button class="button ghost" type="button" data-deck-remove>Remove</button>
      </div>
      <form class="deck-rename-form" hidden>
        <label class="field">
          <span>Deck name</span>
          <input type="text" maxlength="120" value="${escapeAttribute(deck.display_name)}" />
        </label>
        <div class="deck-card-actions">
          <button class="button primary" type="submit">Save name</button>
          <button class="button secondary" type="button" data-deck-rename-cancel>Cancel</button>
        </div>
      </form>
    `;
    list.append(card);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

export async function refreshMyDecks() {
  const status = qs('myDecksStatus');
  if (!isSignedIn()) {
    decks = [];
    renderMyDecks();
    return;
  }
  const repo = await repository();
  if (!repo) return;
  setStatus(status, 'Loading your decks…', 'loading');
  try {
    decks = await repo.list();
    renderMyDecks();
    setStatus(status, decks.length ? '' : 'No saved Google Sheets yet.', decks.length ? 'neutral' : 'neutral');
    if (decks.length) status.hidden = true;
  } catch (error) {
    console.warn('Saved decks could not be loaded', error);
    setStatus(status, 'Saved decks could not be loaded. You can still study anything already open in this browser.', 'error');
  }
}

export function showSheetReadyActions(questionCount, identity) {
  state.googleSheetIdentity = identity;
  const actions = qs('sheetReadyActions');
  const count = qs('sheetReadyCount');
  if (count) {
    count.textContent = `${questionCount} question${questionCount === 1 ? '' : 's'} ready`;
  }
  if (actions) actions.hidden = false;
  const saveForm = qs('saveDeckForm');
  if (saveForm) saveForm.hidden = true;
  const nameInput = qs('saveDeckName');
  if (nameInput && !nameInput.value) nameInput.value = inferDeckDisplayName({ displayName: state.sourceName });
  renderSaveAvailability();
}

export function hideSheetReadyActions() {
  const actions = qs('sheetReadyActions');
  if (actions) actions.hidden = true;
  state.googleSheetIdentity = null;
  state.savedSourceId = null;
}

async function saveCurrentSheet(displayName) {
  const identity = currentGoogleSheetIdentity();
  const status = qs('saveDeckStatus');
  if (!identity) {
    setStatus(status, 'Load a Google Sheet before saving it to your account.', 'error');
    return;
  }
  if (!view().canSaveToAccount) {
    setStatus(status, SIGN_IN_PROMPT, 'warning');
    qs('signInPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    qs('accountEmail')?.focus();
    return;
  }

  const repo = await repository();
  if (!repo) {
    setStatus(status, 'Account sync is unavailable. Your current study session is unchanged.', 'warning');
    return;
  }

  setStatus(status, 'Saving this Google Sheet to your account…', 'loading');
  try {
    const result = await repo.upsert({
      ...identity,
      spreadsheet_id: identity.spreadsheetId,
      sheet_gid: identity.sheetGid,
      display_name: inferDeckDisplayName({ displayName: displayName || state.sourceName }),
      last_source_row: state.questions[state.currentIndex]?.sourceRow ?? null,
      last_opened_at: new Date().toISOString()
    });
    state.savedSourceId = result.record.id;
    state.sourceName = result.record.display_name;
    setStatus(status, result.action === 'update'
      ? `"${result.record.display_name}" was updated in My decks.`
      : `"${result.record.display_name}" was saved to My decks.`, 'success');
    await refreshMyDecks();
    qs('myDecksPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.warn('Save to account failed', error);
    setStatus(status, SAVE_FAILURE, 'error');
  }
}

export async function syncCloudProgress() {
  if (!isSignedIn() || !state.savedSourceId) return;
  const repo = await repository();
  if (!repo) return;
  try {
    await repo.touchProgress(state.savedSourceId, {
      last_source_row: state.questions[state.currentIndex]?.sourceRow ?? null,
      last_opened_at: new Date().toISOString()
    });
  } catch (error) {
    console.warn('Cloud progress was not saved', error);
  }
}

function scheduleProgressSync() {
  window.clearTimeout(progressSyncTimer);
  progressSyncTimer = window.setTimeout(() => {
    syncCloudProgress();
  }, 400);
}

async function studyDeck(deck) {
  const status = qs('myDecksStatus');
  setStatus(status, `Opening ${deck.display_name}…`, 'loading');
  try {
    await loadSavedSheet(deck);
    await syncCloudProgress();
    setStatus(status, '', 'neutral');
    qs('session-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.warn('Saved sheet failed to load', error);
    const message = /html|anyone with the link|http 4/i.test(String(error?.message || ''))
      ? 'This Google Sheet is no longer publicly readable. Set access to “Anyone with the link — Viewer,” or keep studying any deck already loaded.'
      : LOAD_FAILURE;
    setStatus(status, message, 'error');
  }
}

async function renameDeck(deck, displayName) {
  const repo = await repository();
  const status = qs('myDecksStatus');
  if (!repo) return;
  try {
    await repo.rename(deck.id, displayName);
    await refreshMyDecks();
  } catch (error) {
    console.warn('Rename failed', error);
    setStatus(status, 'The deck could not be renamed. Your study session is unchanged.', 'error');
  }
}

async function removeDeck(deck) {
  const repo = await repository();
  const status = qs('myDecksStatus');
  if (!repo) return;
  try {
    await repo.remove(deck.id);
    if (state.savedSourceId === deck.id) state.savedSourceId = null;
    await refreshMyDecks();
  } catch (error) {
    console.warn('Remove failed', error);
    setStatus(status, 'The deck could not be removed. Your study session is unchanged.', 'error');
  }
}

function collectSignInInput() {
  return {
    email: qs('accountEmail')?.value,
    legalAccepted: Boolean(qs('legalAccepted')?.checked),
    age18Confirmed: Boolean(qs('age18Confirmed')?.checked),
    usAccessConfirmed: Boolean(qs('usAccessConfirmed')?.checked),
    marketingConsent: Boolean(qs('marketingConsent')?.checked)
  };
}

function setupEvents() {
  qs('accountHeaderButton')?.addEventListener('click', () => {
    const target = view().showSignedIn ? qs('myDecksPanel') : qs('signInPanel');
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!view().showSignedIn) qs('accountEmail')?.focus();
  });

  qs('signInForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = qs('accountStatus');
    try {
      const otpEmail = qs('otpEmail');
      if (otpEmail) otpEmail.value = collectSignInInput().email || '';
      await requestEmailSignIn(collectSignInInput());
      qs('otpCode')?.focus();
    } catch (error) {
      setStatus(status, error.message, 'error');
    }
  });

  qs('otpForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = qs('accountStatus');
    try {
      await verifyEmailCode(qs('otpEmail')?.value || qs('accountEmail')?.value, qs('otpCode')?.value);
    } catch (error) {
      setStatus(status, error.message, 'error');
    }
  });

  qs('resendOtpButton')?.addEventListener('click', async () => {
    const status = qs('accountStatus');
    try {
      await requestEmailSignIn({
        ...collectSignInInput(),
        email: qs('otpEmail')?.value || collectSignInInput().email
      });
    } catch (error) {
      setStatus(status, error.message, 'error');
    }
  });

  qs('signOutButton')?.addEventListener('click', async () => {
    await signOutAccount();
    decks = [];
    renderMyDecks();
  });

  qs('startStudyingButton')?.addEventListener('click', () => {
    qs('session-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    elements.startButton?.focus();
  });

  qs('saveToAccountButton')?.addEventListener('click', () => {
    if (!view().canSaveToAccount) {
      setStatus(qs('saveDeckStatus'), SIGN_IN_PROMPT, 'warning');
      qs('signInPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      qs('accountEmail')?.focus();
      return;
    }
    const form = qs('saveDeckForm');
    const nameInput = qs('saveDeckName');
    if (nameInput && !nameInput.value) nameInput.value = inferDeckDisplayName({ displayName: state.sourceName });
    if (form) form.hidden = false;
    nameInput?.focus();
  });

  qs('saveDeckForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveCurrentSheet(qs('saveDeckName')?.value);
  });

  qs('cancelSaveDeck')?.addEventListener('click', () => {
    const form = qs('saveDeckForm');
    if (form) form.hidden = true;
  });

  qs('myDecksList')?.addEventListener('click', async (event) => {
    const card = event.target.closest('.deck-card');
    if (!card) return;
    const deck = decks.find((item) => item.id === card.dataset.sourceId);
    if (!deck) return;
    if (event.target.closest('[data-deck-study]')) {
      await studyDeck(deck);
    } else if (event.target.closest('[data-deck-rename]')) {
      const form = card.querySelector('.deck-rename-form');
      if (form) form.hidden = false;
      form?.querySelector('input')?.focus();
    } else if (event.target.closest('[data-deck-rename-cancel]')) {
      const form = card.querySelector('.deck-rename-form');
      if (form) form.hidden = true;
    } else if (event.target.closest('[data-deck-remove]')) {
      const confirmed = window.confirm(`Remove “${deck.display_name}” from your account? This does not delete the Google Sheet.`);
      if (confirmed) await removeDeck(deck);
    }
  });

  qs('myDecksList')?.addEventListener('submit', async (event) => {
    const form = event.target.closest('.deck-rename-form');
    if (!form) return;
    event.preventDefault();
    const card = form.closest('.deck-card');
    const deck = decks.find((item) => item.id === card?.dataset.sourceId);
    if (!deck) return;
    await renameDeck(deck, form.querySelector('input')?.value);
  });
}

export async function setupAccountUI() {
  setupEvents();
  onProgressSaved(noteLocalProgressChanged);
  onAuthChange(async (snapshot) => {
    lastSnapshot = snapshot;
    renderAccountChrome();
    if (snapshot.status === AUTH_STATUS.signedIn) await refreshMyDecks();
    else {
      decks = [];
      renderMyDecks();
    }
  });
  lastSnapshot = await initializeAuth();
  renderAccountChrome();
  if (isSignedIn()) await refreshMyDecks();
}

export function noteLocalProgressChanged() {
  scheduleProgressSync();
}
