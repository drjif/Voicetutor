import { state } from './dom.js';

const SOURCE_LABELS = {
  'google-sheet': 'Google Sheet',
  paste: 'Pasted questions',
  xlsx: 'Excel file',
  anki: 'Anki deck',
  'anki-text': 'Anki text file',
  csv: 'CSV file',
  'local-csv': 'CSV file',
  'local-tsv': 'TSV file',
  'local-txt': 'Text file',
  'local-text': 'Text file',
  demo: 'same3le demo'
};

export function sourceFocusPresentation(sourceKind, savedSourceId, questionCount) {
  const count = Number(questionCount) || 0;
  if (!sourceKind || sourceKind === 'none' || count <= 0) {
    return { active: false, kind: 'none', stage: 'source' };
  }

  return {
    active: true,
    kind: sourceKind,
    stage: sourceKind === 'google-sheet' && !savedSourceId ? 'source' : 'study'
  };
}

export function sourceDisplayLabel(sourceKind) {
  return SOURCE_LABELS[sourceKind] || 'Question bank';
}

function installStyles() {
  if (document.getElementById('same3le-source-focus-styles')) return;
  const style = document.createElement('style');
  style.id = 'same3le-source-focus-styles';
  style.textContent = `
    .active-source-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin: -4px 0 18px;
      padding: 14px 16px;
      border: 1px solid #ffc4aa;
      border-radius: 16px;
      background: var(--primary-soft);
    }

    .active-source-copy {
      min-width: 0;
      display: grid;
      gap: 3px;
    }

    .active-source-copy strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 1rem;
    }

    .active-source-meta {
      color: var(--muted);
      font-size: 0.86rem;
      line-height: 1.35;
    }

    #your-questions[data-source-options="collapsed"] .paste-panel,
    #your-questions[data-source-options="collapsed"] #local-file-import,
    #your-questions[data-source-options="collapsed"] #myDecksPanel,
    #your-questions[data-source-options="collapsed"] .advanced-import-heading,
    #your-questions[data-source-options="collapsed"] .signup-panel,
    #your-questions[data-source-options="collapsed"] .member-panel {
      display: none !important;
    }

    #your-questions[data-source-options="collapsed"][data-source-kind="google-sheet"][data-source-stage="source"] .onboarding-grid {
      grid-template-columns: 1fr;
    }

    #your-questions[data-source-options="collapsed"][data-source-kind="google-sheet"][data-source-stage="source"] .import-panel {
      grid-column: 1;
      grid-row: auto;
    }

    #your-questions[data-source-options="collapsed"][data-source-kind="google-sheet"][data-source-stage="source"] .import-panel .panel-copy,
    #your-questions[data-source-options="collapsed"][data-source-kind="google-sheet"][data-source-stage="source"] #personalBankControls > .field,
    #your-questions[data-source-options="collapsed"][data-source-kind="google-sheet"][data-source-stage="source"] #personalBankControls > .source-actions,
    #your-questions[data-source-options="collapsed"][data-source-kind="google-sheet"][data-source-stage="source"] #personalBankControls > .helper,
    #your-questions[data-source-options="collapsed"][data-source-kind="google-sheet"][data-source-stage="source"] #localMappingHost {
      display: none !important;
    }

    #your-questions[data-source-options="collapsed"][data-source-stage="study"] .onboarding-grid,
    #your-questions[data-source-options="collapsed"]:not([data-source-kind="google-sheet"]) .onboarding-grid,
    #your-questions[data-source-options="collapsed"]:not([data-source-kind="google-sheet"]) #localMappingHost {
      display: none !important;
    }

    @media (max-width: 640px) {
      .active-source-summary {
        align-items: stretch;
        flex-direction: column;
      }

      .active-source-summary .button {
        width: 100%;
      }
    }
  `;
  document.head.append(style);
}

function ensureSummary() {
  const section = document.querySelector('#your-questions');
  const heading = section?.querySelector('.section-heading');
  if (!section || !heading) return null;

  let summary = document.querySelector('#activeSourceSummary');
  if (summary) return summary;

  summary = document.createElement('div');
  summary.id = 'activeSourceSummary';
  summary.className = 'active-source-summary';
  summary.hidden = true;
  summary.innerHTML = `
    <div class="active-source-copy">
      <span class="option-kicker">Active questions</span>
      <strong id="activeSourceName">Question bank</strong>
      <span id="activeSourceMeta" class="active-source-meta"></span>
    </div>
    <button id="changeSourceButton" class="button secondary compact-button" type="button" aria-expanded="false">Change source</button>
  `;
  heading.insertAdjacentElement('afterend', summary);
  return summary;
}

function updateSummary() {
  const summary = ensureSummary();
  if (!summary) return;
  const presentation = sourceFocusPresentation(state.sourceKind, state.savedSourceId, state.questions.length);
  if (!presentation.active) {
    summary.hidden = true;
    return;
  }

  const name = document.querySelector('#activeSourceName');
  const meta = document.querySelector('#activeSourceMeta');
  if (name) name.textContent = state.sourceName || sourceDisplayLabel(state.sourceKind);
  if (meta) {
    const count = state.questions.length;
    meta.textContent = `${sourceDisplayLabel(state.sourceKind)} · ${count} question${count === 1 ? '' : 's'} ready`;
  }
  summary.hidden = false;
}

function syncChangeSourceButton() {
  const section = document.querySelector('#your-questions');
  const button = document.querySelector('#changeSourceButton');
  if (!section || !button) return;
  const expanded = section.dataset.sourceOptions === 'expanded';
  button.textContent = expanded ? 'Hide source options' : 'Change source';
  button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function applyFocus({ preserveExpansion = false, preserveStage = false } = {}) {
  const section = document.querySelector('#your-questions');
  if (!section) return;

  const presentation = sourceFocusPresentation(state.sourceKind, state.savedSourceId, state.questions.length);
  updateSummary();
  if (!presentation.active) {
    delete section.dataset.sourceKind;
    delete section.dataset.sourceStage;
    delete section.dataset.sourceOptions;
    syncChangeSourceButton();
    return;
  }

  section.dataset.sourceKind = presentation.kind;
  if (!preserveStage || !section.dataset.sourceStage) section.dataset.sourceStage = presentation.stage;
  if (!preserveExpansion || !section.dataset.sourceOptions) section.dataset.sourceOptions = 'collapsed';
  syncChangeSourceButton();
}

function toggleSourceOptions() {
  const section = document.querySelector('#your-questions');
  if (!section || !state.questions.length) return;
  section.dataset.sourceOptions = section.dataset.sourceOptions === 'expanded' ? 'collapsed' : 'expanded';
  applyFocus({ preserveExpansion: true, preserveStage: true });
}

function enterStudyFocus() {
  const section = document.querySelector('#your-questions');
  if (!section || !state.questions.length) return;
  section.dataset.sourceStage = 'study';
  section.dataset.sourceOptions = 'collapsed';
  applyFocus({ preserveExpansion: true, preserveStage: true });
}

function observeLoadedQuestions() {
  const startRow = document.querySelector('#startRow');
  if (!startRow) return;
  const observer = new MutationObserver(() => {
    // Importers keep their existing DOM and handlers. We only react after
    // they populate the shared question selector successfully.
    applyFocus({ preserveExpansion: true });
  });
  observer.observe(startRow, { childList: true });
}

export function setupSourceFocusUI() {
  installStyles();
  const summary = ensureSummary();
  if (!summary) return;

  document.querySelector('#changeSourceButton')?.addEventListener('click', toggleSourceOptions);
  document.querySelector('#startStudyingButton')?.addEventListener('click', enterStudyFocus);
  document.querySelector('#startButton')?.addEventListener('click', enterStudyFocus, { capture: true });

  window.addEventListener('same3le:source-ready', () => applyFocus());
  window.addEventListener('same3le:source-saved', () => enterStudyFocus());

  observeLoadedQuestions();
  applyFocus({ preserveExpansion: true });
}
