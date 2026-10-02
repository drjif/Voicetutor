const SOURCE_LABELS = Object.freeze({
  'google-sheet': 'Google Sheet',
  csv: 'CSV',
  paste: 'Pasted questions',
  xlsx: 'Excel file',
  anki: 'Anki deck',
  'anki-text': 'Anki text deck',
  'local-csv': 'CSV file',
  'local-tsv': 'TSV file',
  'local-txt': 'Text file',
  'local-text': 'Text file',
  demo: 'Demo'
});

const ACTIVE_WORKSPACE_STATUSES = new Set(['running', 'listening', 'waiting', 'paused', 'complete']);

let runtimeState = null;
let sourceSection = null;
let studySetup = null;
let sourceBar = null;
let sourceLabel = null;
let sourceName = null;
let sourceCount = null;
let changeSourceButton = null;
let chooserExpanded = true;
let lastDeckRef = null;
let syncQueued = false;
let initialized = false;

function cleanLabel(value, fallback) {
  const cleaned = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (cleaned || fallback).slice(0, 120);
}

export function buildSourceFocusModel(state = {}) {
  const questions = Array.isArray(state.questions) ? state.questions : [];
  const kind = String(state.sourceKind ?? 'none');
  const ready = kind !== 'none' && questions.length > 0;
  const label = SOURCE_LABELS[kind] || 'Question bank';
  const name = cleanLabel(state.sourceName, label);
  const saved = kind === 'google-sheet' && Boolean(state.savedSourceId);

  return {
    ready,
    kind,
    label,
    name,
    questionCount: questions.length,
    saved,
    countText: `${questions.length} question${questions.length === 1 ? '' : 's'}${saved ? ' · Saved' : ''}`
  };
}

export function buildWorkspacePresentation(state = {}) {
  const source = buildSourceFocusModel(state);
  if (!source.ready) return { state: 'landing', sessionActive: false };

  const status = String(state.status ?? 'idle');
  const sessionActive = ACTIVE_WORKSPACE_STATUSES.has(status);
  return {
    state: sessionActive ? 'session' : 'ready',
    sessionActive
  };
}

function installStyles() {
  if (document.getElementById('same3le-source-focus-styles')) return;
  const style = document.createElement('style');
  style.id = 'same3le-source-focus-styles';
  style.textContent = `
    #your-questions.source-workspace-collapsed {
      display: none !important;
    }

    .source-focus-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin: -4px 0 24px;
      padding: 14px 16px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--surface-alt);
    }

    .source-focus-copy {
      min-width: 0;
      display: grid;
      gap: 3px;
    }

    .source-focus-kicker {
      color: var(--primary-dark);
      font-size: 0.7rem;
      font-weight: 900;
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }

    .source-focus-title {
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 6px 10px;
    }

    .source-focus-title strong {
      max-width: min(58vw, 540px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 1rem;
    }

    .source-focus-count {
      color: var(--muted);
      font-size: 0.84rem;
      font-weight: 700;
      white-space: nowrap;
    }

    /*
     * Once a usable deck exists, same3le becomes an application workspace.
     * These sections remain mounted; presentation alone removes onboarding
     * and marketing surfaces from the active study path.
     */
    body[data-same3le-workspace="ready"] .hero,
    body[data-same3le-workspace="session"] .hero,
    body[data-same3le-workspace="ready"] #start-studying,
    body[data-same3le-workspace="session"] #start-studying,
    body[data-same3le-workspace="ready"] .free-product-strip,
    body[data-same3le-workspace="session"] .free-product-strip,
    body[data-same3le-workspace="ready"] .how-card,
    body[data-same3le-workspace="session"] .how-card,
    body[data-same3le-workspace="ready"] .site-discover-nav,
    body[data-same3le-workspace="session"] .site-discover-nav,
    body[data-same3le-workspace="ready"] .marketing-nav,
    body[data-same3le-workspace="session"] .marketing-nav,
    body[data-same3le-workspace="ready"] .prototype-badge,
    body[data-same3le-workspace="session"] .prototype-badge {
      display: none !important;
    }

    body[data-same3le-workspace="ready"] .layout,
    body[data-same3le-workspace="session"] .layout {
      gap: 14px;
    }

    body[data-same3le-workspace="ready"] #study-setup,
    body[data-same3le-workspace="session"] #study-setup {
      padding: clamp(16px, 2vw, 22px);
    }

    body[data-same3le-workspace="ready"] #study-setup > .section-heading,
    body[data-same3le-workspace="session"] #study-setup > .section-heading {
      margin-bottom: 14px;
    }

    body[data-same3le-workspace="ready"] #study-setup > .section-heading .step,
    body[data-same3le-workspace="session"] #study-setup > .section-heading .step,
    body[data-same3le-workspace="ready"] #study-setup > .section-heading p,
    body[data-same3le-workspace="session"] #study-setup > .section-heading p {
      display: none !important;
    }

    body[data-same3le-workspace="ready"] #study-setup > .section-heading h2,
    body[data-same3le-workspace="session"] #study-setup > .section-heading h2 {
      margin: 0;
      font-size: clamp(1.2rem, 2.4vw, 1.6rem);
      letter-spacing: -0.025em;
    }

    body[data-same3le-workspace="ready"] #study-setup .three-mode-picker {
      gap: 10px;
      margin-bottom: 12px;
    }

    body[data-same3le-workspace="ready"] #study-setup .mode-card {
      min-height: 0;
      padding: 12px 14px;
    }

    body[data-same3le-workspace="ready"] #study-setup .mode-copy small {
      display: none !important;
    }

    body[data-same3le-workspace="ready"] #wakeLockControl {
      margin: 10px 0;
      padding: 10px 12px;
    }

    body[data-same3le-workspace="ready"] #wakeLockStatus {
      display: none !important;
    }

    body[data-same3le-workspace="ready"] #study-setup .advanced-options {
      margin: 10px 0;
    }

    body[data-same3le-workspace="ready"] #study-setup .start-button {
      margin-top: 12px;
    }

    body[data-same3le-workspace="ready"] #study-setup .start-note {
      margin: 8px 0 0;
      font-size: 0.78rem;
      line-height: 1.45;
    }

    body[data-same3le-workspace="ready"] .source-focus-bar {
      margin-bottom: 14px;
    }

    /*
     * During an actual session the existing controls remain mounted, but the
     * question/player becomes the visual priority. Stopping the session returns
     * to the compact ready state automatically through state.status.
     */
    body[data-same3le-workspace="session"] #study-setup > .section-heading,
    body[data-same3le-workspace="session"] #study-setup .three-mode-picker,
    body[data-same3le-workspace="session"] #wakeLockControl,
    body[data-same3le-workspace="session"] #study-setup .advanced-options,
    body[data-same3le-workspace="session"] #startButton,
    body[data-same3le-workspace="session"] #startNote {
      display: none !important;
    }

    body[data-same3le-workspace="session"] #study-setup {
      padding: 12px 16px;
    }

    body[data-same3le-workspace="session"] .source-focus-bar {
      margin: 0;
      padding: 10px 12px;
    }

    body[data-same3le-workspace="session"] #sessionPanel {
      scroll-margin-top: 16px;
    }

    @media (max-width: 640px) {
      .source-focus-bar {
        align-items: stretch;
        flex-direction: column;
      }

      .source-focus-title strong {
        max-width: 78vw;
      }

      .source-focus-bar .button {
        width: 100%;
      }

      body[data-same3le-workspace="ready"] #study-setup,
      body[data-same3le-workspace="session"] #study-setup {
        padding: 14px;
      }
    }
  `;
  document.head.append(style);
}

function ensureBar() {
  sourceSection = document.querySelector('#your-questions');
  studySetup = document.querySelector('#study-setup');
  if (!sourceSection || !studySetup) return null;

  sourceBar = document.querySelector('#activeSourceBar');
  if (!sourceBar) {
    sourceBar = document.createElement('div');
    sourceBar.id = 'activeSourceBar';
    sourceBar.className = 'source-focus-bar';
    sourceBar.hidden = true;
    sourceBar.setAttribute('aria-live', 'polite');
    sourceBar.innerHTML = `
      <div class="source-focus-copy">
        <span id="activeSourceLabel" class="source-focus-kicker">Active source</span>
        <div class="source-focus-title">
          <strong id="activeSourceName">Question bank</strong>
          <span id="activeSourceCount" class="source-focus-count"></span>
        </div>
      </div>
      <button id="changeSourceButton" class="button secondary compact-button" type="button" aria-expanded="false" aria-controls="your-questions">Change source</button>
    `;
    const heading = studySetup.querySelector('.section-heading');
    if (heading) studySetup.insertBefore(sourceBar, heading);
    else studySetup.prepend(sourceBar);
  }

  sourceLabel = sourceBar.querySelector('#activeSourceLabel');
  sourceName = sourceBar.querySelector('#activeSourceName');
  sourceCount = sourceBar.querySelector('#activeSourceCount');
  changeSourceButton = sourceBar.querySelector('#changeSourceButton');
  return sourceBar;
}

function scrollToStudySetup() {
  window.requestAnimationFrame(() => {
    studySetup?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function scrollToSessionPanel() {
  window.requestAnimationFrame(() => {
    document.querySelector('#sessionPanel:not([hidden])')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function renderFromState() {
  if (!runtimeState || !ensureBar()) return;
  const model = buildSourceFocusModel(runtimeState);
  const workspace = buildWorkspacePresentation(runtimeState);
  const previousWorkspace = document.body.dataset.same3leWorkspace || 'landing';

  document.body.dataset.same3leWorkspace = workspace.state;
  sourceBar.hidden = !model.ready;
  sourceSection.classList.toggle('source-workspace-collapsed', model.ready && !chooserExpanded);
  sourceSection.dataset.activeSource = model.ready ? model.kind : 'none';

  if (!model.ready) return;
  sourceLabel.textContent = `Active source · ${model.label}`;
  sourceName.textContent = model.name;
  sourceCount.textContent = model.countText;
  changeSourceButton.textContent = chooserExpanded ? 'Use current source' : 'Change source';
  changeSourceButton.setAttribute('aria-expanded', chooserExpanded ? 'true' : 'false');

  if (workspace.state === 'session' && previousWorkspace !== 'session' && !chooserExpanded) {
    scrollToSessionPanel();
  }
}

function syncFromState() {
  syncQueued = false;
  if (!runtimeState) return;

  const model = buildSourceFocusModel(runtimeState);
  const currentDeckRef = runtimeState.currentDeck ?? null;
  const loadedNewDeck = model.ready && currentDeckRef && currentDeckRef !== lastDeckRef;
  lastDeckRef = currentDeckRef;

  if (!model.ready) {
    chooserExpanded = true;
    renderFromState();
    return;
  }

  if (loadedNewDeck) chooserExpanded = false;
  renderFromState();
  if (loadedNewDeck) scrollToStudySetup();
}

function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(syncFromState);
}

export function expandSourceChooser({ scroll = true } = {}) {
  chooserExpanded = true;
  renderFromState();
  if (scroll) {
    window.requestAnimationFrame(() => {
      sourceSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

export function collapseSourceChooser({ scroll = true } = {}) {
  if (!buildSourceFocusModel(runtimeState).ready) return;
  chooserExpanded = false;
  renderFromState();
  if (scroll) scrollToStudySetup();
}

function revealSourceTargetFromHash() {
  if (!window.location.hash || !sourceSection) return;
  const id = decodeURIComponent(window.location.hash.slice(1));
  const target = document.getElementById(id);
  if (target && (target === sourceSection || sourceSection.contains(target))) {
    expandSourceChooser({ scroll: false });
  }
}

function captureNavigationToSource(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !sourceSection?.classList.contains('source-workspace-collapsed')) return;

  if (target.closest('#accountHeaderButton')) {
    expandSourceChooser({ scroll: false });
    return;
  }

  if (target.closest('#starQuestionButton')) {
    const signInPanel = document.querySelector('#signInPanel');
    if (signInPanel && !signInPanel.hidden) expandSourceChooser({ scroll: false });
    return;
  }

  const anchor = target.closest('a[href*="#"]');
  if (!anchor) return;
  try {
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || !url.hash) return;
    const destination = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (destination && (destination === sourceSection || sourceSection.contains(destination))) {
      expandSourceChooser({ scroll: false });
    }
  } catch {
    // Leave malformed anchors to the browser.
  }
}

export function setupSourceFocusUI(state) {
  runtimeState = state;
  if (initialized) {
    renderFromState();
    return;
  }

  installStyles();
  if (!ensureBar()) return;
  initialized = true;
  lastDeckRef = state?.currentDeck ?? null;

  changeSourceButton.addEventListener('click', () => {
    if (chooserExpanded) collapseSourceChooser();
    else expandSourceChooser();
  });

  const startRow = document.querySelector('#startRow');
  if (startRow) {
    const observer = new MutationObserver(scheduleSync);
    observer.observe(startRow, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  }

  const statusBadge = document.querySelector('#statusBadge');
  if (statusBadge) {
    const observer = new MutationObserver(scheduleSync);
    observer.observe(statusBadge, { attributes: true, attributeFilter: ['data-status'] });
  }

  document.addEventListener('click', captureNavigationToSource, true);
  window.addEventListener('hashchange', revealSourceTargetFromHash);
  revealSourceTargetFromHash();
  renderFromState();
}
