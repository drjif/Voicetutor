import { expandSourceChooser } from './source-focus.js';

let runtimeState = null;
let workspace = null;
let libraryMain = null;
let myDecksPanel = null;
let createDeckButton = null;
let creatorOpen = false;
let authenticated = false;
let initialized = false;
let lastDeckRef = null;
let syncQueued = false;

export function libraryWorkspaceModel({ authenticated: isAuthenticated = false, hasQuestions = false, creatorOpen: isCreatorOpen = false } = {}) {
  return {
    showLibrary: Boolean(isAuthenticated),
    showMarketing: !isAuthenticated,
    showCreator: !isAuthenticated || Boolean(isCreatorOpen),
    showStudySetup: !isAuthenticated || Boolean(hasQuestions)
  };
}

function installStyles() {
  if (document.getElementById('same3le-library-workspace-styles')) return;
  const style = document.createElement('style');
  style.id = 'same3le-library-workspace-styles';
  style.textContent = `
    .library-workspace[hidden] { display: none !important; }

    .library-workspace {
      display: grid;
      grid-template-columns: minmax(190px, 240px) minmax(0, 1fr);
      gap: 24px;
      align-items: start;
      margin-bottom: 24px;
    }

    .library-sidebar {
      position: sticky;
      top: 18px;
      display: grid;
      gap: 16px;
      padding: 20px;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--surface);
      box-shadow: var(--shadow-sm, 0 10px 30px rgba(17, 17, 17, 0.06));
    }

    .library-sidebar-copy { display: grid; gap: 4px; }
    .library-sidebar-copy .eyebrow { margin: 0; }
    .library-sidebar-copy h1 { margin: 0; font-size: 1.45rem; }
    .library-sidebar-copy p:last-child { margin: 2px 0 0; color: var(--muted); font-size: 0.86rem; line-height: 1.45; }

    #createDeckButton {
      width: 100%;
      min-height: 58px;
      justify-content: center;
      font-size: 1rem;
    }

    .library-main {
      min-width: 0;
      display: grid;
      gap: 16px;
    }

    .library-main > #myDecksPanel {
      margin: 0;
      padding: 22px;
    }

    .library-main > #myDecksPanel .my-decks-heading { margin-bottom: 16px; }
    .library-main > #myDecksPanel .my-decks-heading .option-kicker { display: none; }
    .library-main > #myDecksPanel .my-decks-heading .panel-copy { margin-bottom: 0; }
    .library-main > #myDecksPanel #my-decks-heading { font-size: clamp(1.35rem, 2vw, 1.8rem); }

    body.same3le-library-authenticated .hero,
    body.same3le-library-authenticated .how-card,
    body.same3le-library-authenticated .site-discover-nav,
    body.same3le-library-authenticated .prototype-badge {
      display: none !important;
    }

    body.same3le-library-authenticated:not(.same3le-create-deck-open) #your-questions {
      display: none !important;
    }

    body.same3le-library-authenticated:not(.same3le-has-study-deck) #study-setup {
      display: none !important;
    }

    body.same3le-library-authenticated.same3le-create-deck-open #your-questions {
      display: block !important;
    }

    @media (max-width: 760px) {
      .library-workspace { grid-template-columns: 1fr; gap: 14px; }
      .library-sidebar { position: static; padding: 16px; }
      .library-sidebar-copy p:last-child { display: none; }
      .library-main > #myDecksPanel { padding: 16px; }
    }
  `;
  document.head.append(style);
}

function ensureWorkspace() {
  if (workspace) return workspace;
  const main = document.querySelector('#main-content');
  myDecksPanel = document.querySelector('#myDecksPanel');
  if (!main || !myDecksPanel) return null;

  workspace = document.createElement('section');
  workspace.id = 'libraryWorkspace';
  workspace.className = 'library-workspace';
  workspace.hidden = true;
  workspace.setAttribute('aria-labelledby', 'libraryWorkspaceHeading');
  workspace.innerHTML = `
    <aside class="library-sidebar" aria-label="Library actions">
      <div class="library-sidebar-copy">
        <p class="eyebrow">Study</p>
        <h1 id="libraryWorkspaceHeading">Library</h1>
        <p>Open a saved deck and get straight back to studying.</p>
      </div>
      <button id="createDeckButton" class="button primary large-button" type="button">+ Create deck</button>
    </aside>
    <div id="libraryMain" class="library-main"></div>
  `;
  main.prepend(workspace);
  libraryMain = workspace.querySelector('#libraryMain');
  createDeckButton = workspace.querySelector('#createDeckButton');
  libraryMain.append(myDecksPanel);

  const empty = document.querySelector('#myDecksEmpty');
  if (empty) empty.textContent = 'No saved decks yet. Use + Create deck to add your first deck.';

  return workspace;
}

function render() {
  if (!runtimeState || !ensureWorkspace()) return;
  const hasQuestions = Array.isArray(runtimeState.questions) && runtimeState.questions.length > 0;
  const model = libraryWorkspaceModel({ authenticated, hasQuestions, creatorOpen });

  workspace.hidden = !model.showLibrary;
  document.body.classList.toggle('same3le-library-authenticated', authenticated);
  document.body.classList.toggle('same3le-create-deck-open', authenticated && creatorOpen);
  document.body.classList.toggle('same3le-has-study-deck', authenticated && hasQuestions);
}

function focusLibrary() {
  window.requestAnimationFrame(() => {
    workspace?.scrollIntoView({ behavior: 'auto', block: 'start' });
  });
}

function setAuthenticated(nextAuthenticated, { focus = false } = {}) {
  const changed = authenticated !== Boolean(nextAuthenticated);
  authenticated = Boolean(nextAuthenticated);
  if (!authenticated) creatorOpen = false;
  render();
  if (authenticated && (focus || changed)) focusLibrary();
}

function syncFromStudyState() {
  syncQueued = false;
  if (!runtimeState) return;
  const hasQuestions = Array.isArray(runtimeState.questions) && runtimeState.questions.length > 0;
  const currentDeckRef = runtimeState.currentDeck ?? null;
  const loadedNewDeck = hasQuestions && currentDeckRef && currentDeckRef !== lastDeckRef;
  lastDeckRef = currentDeckRef;
  if (loadedNewDeck) creatorOpen = false;
  render();
}

function scheduleStudySync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(syncFromStudyState);
}

function openCreator() {
  creatorOpen = true;
  expandSourceChooser({ scroll: false });
  render();
  window.requestAnimationFrame(() => {
    document.querySelector('#your-questions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

export function setupLibraryWorkspace(state) {
  runtimeState = state;
  if (initialized) {
    render();
    return;
  }

  installStyles();
  if (!ensureWorkspace()) return;
  initialized = true;
  lastDeckRef = state?.currentDeck ?? null;

  createDeckButton.addEventListener('click', openCreator);

  const authObserver = new MutationObserver(() => {
    setAuthenticated(!myDecksPanel.hidden, { focus: !myDecksPanel.hidden });
  });
  authObserver.observe(myDecksPanel, { attributes: true, attributeFilter: ['hidden'] });

  const startRow = document.querySelector('#startRow');
  if (startRow) {
    const studyObserver = new MutationObserver(scheduleStudySync);
    studyObserver.observe(startRow, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  }

  setAuthenticated(!myDecksPanel.hidden);
  render();
}
