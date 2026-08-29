import { loadDeck } from './deck.js';
import { parseStudyFile } from './file-import.js';
import { parsePastedQuestions } from './paste-data.js';
import { buildQuestionBank, columnName, detectColumns, extractGoogleSheetIdentity, parseDelimited, parseGoogleSheetUrl, reconstructGoogleSheetUrls } from './sheet-data.js';
import {
  PROGRESS_KEY,
  elements,
  safeJson,
  saveSettings,
  setPasteStatus,
  setSheetStatus,
  state,
  updateControls
} from './dom.js';
import { noteSourceLoaded } from './beta.js';

let currentHeaderRowIndex = 0;
let sheetReadyHandler = {
  show() {},
  hide() {}
};

export function setSheetReadyHandler(handler) {
  sheetReadyHandler = handler || { show() {}, hide() {} };
}

function populateColumnSelect(select, headers, includeNone = false) {
  select.innerHTML = '';
  if (includeNone) {
    const option = document.createElement('option');
    option.value = '-1';
    option.textContent = 'None';
    select.append(option);
  }
  headers.forEach((header, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `Column ${columnName(index)} — ${truncate(header, 80)}`;
    select.append(option);
  });
}

function truncate(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function localFileElements() {
  return {
    input: document.querySelector('#studyFileUpload'),
    status: document.querySelector('#localFileStatus'),
    fileName: document.querySelector('#selectedFileName'),
    mappingHost: document.querySelector('#localMappingHost')
  };
}

function setLocalFileStatus(message, type = 'neutral') {
  const status = localFileElements().status;
  if (!status) return;
  status.textContent = message;
  status.dataset.type = type;
}

function isLocalSource() {
  return ['xlsx', 'anki', 'anki-text', 'local-csv', 'local-tsv', 'local-txt', 'local-text'].includes(state.sourceKind);
}

function currentDeckTitle() {
  if (state.sourceKind === 'demo') return 'samme3le demo';
  if (state.sourceKind === 'paste') return 'Pasted questions';
  if (isLocalSource() && state.sourceName) return state.sourceName;
  if (state.sourceKind === 'google-sheet') return 'Google Sheet questions';
  if (state.sourceKind === 'csv') {
    const uploadedName = String(elements.sheetUrl.value ?? '').replace(/^Uploaded:\s*/i, '').trim();
    return uploadedName || 'Uploaded CSV';
  }
  return 'Imported questions';
}

function applyRecordsToDeck(records) {
  if (!records.length) {
    state.currentDeck = null;
    state.questions = [];
    return;
  }

  const deck = loadDeck({
    title: currentDeckTitle(),
    source: { type: state.sourceKind || 'unknown' },
    cards: records
  });

  state.currentDeck = deck;
  state.questions = deck.cards;
  state.currentIndex = 0;
}

function startRowLabel(item, index) {
  if (state.sourceKind === 'demo') return `Demo question ${index + 1} — ${truncate(item.question, 90)}`;
  if (state.sourceKind === 'paste') return `Pasted question ${index + 1} — ${truncate(item.question, 90)}`;
  if (state.sourceKind === 'anki') return `Anki card ${index + 1} — ${truncate(item.question, 90)}`;
  if (state.sourceKind === 'xlsx') return `Excel row ${item.sourceRow ?? index + 1} — ${truncate(item.question, 90)}`;
  if (state.sourceKind === 'anki-text') return `Anki text row ${item.sourceRow ?? index + 1} — ${truncate(item.question, 90)}`;
  if (state.sourceKind.startsWith('local-')) return `File row ${item.sourceRow ?? index + 1} — ${truncate(item.question, 90)}`;
  if (state.sourceKind === 'csv') return `CSV row ${item.sourceRow} — ${truncate(item.question, 90)}`;
  return `Sheet row ${item.sourceRow} — ${truncate(item.question, 90)}`;
}

function populateStartRows() {
  elements.startRow.innerHTML = '';
  elements.startRow.disabled = state.questions.length === 0;
  state.questions.forEach((item, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = startRowLabel(item, index);
    elements.startRow.append(option);
  });
}

function sessionIsActive() {
  return ['running', 'listening', 'waiting', 'paused'].includes(state.status);
}

function setMappingHostVisible(visible) {
  const host = localFileElements().mappingHost;
  if (host) host.hidden = !visible;
}

export function prepareRows(rows, options = {}) {
  state.rawRows = rows;
  if (typeof options.hasHeaders === 'boolean') elements.hasHeaders.checked = options.hasHeaders;
  const detection = detectColumns(rows, elements.hasHeaders.checked);
  currentHeaderRowIndex = detection.headerRowIndex;

  populateColumnSelect(elements.questionColumn, detection.headers);
  populateColumnSelect(elements.answerColumn, detection.headers);
  populateColumnSelect(elements.acceptedColumn, detection.headers, true);
  elements.questionColumn.value = String(detection.questionIndex);
  elements.answerColumn.value = String(detection.answerIndex);
  elements.acceptedColumn.value = String(detection.acceptedIndex);
  setMappingHostVisible(true);
  elements.mappingPanel.hidden = false;
  applyColumnMapping();
}

export function applyColumnMapping() {
  const questionIndex = Number(elements.questionColumn.value);
  const answerIndex = Number(elements.answerColumn.value);
  const acceptedIndex = Number(elements.acceptedColumn.value);

  if (questionIndex === answerIndex) {
    const message = 'Question and answer must use different columns.';
    if (isLocalSource()) setLocalFileStatus(message, 'error');
    else setSheetStatus(message, 'error');
    return;
  }

  const records = buildQuestionBank(state.rawRows, {
    hasHeaders: elements.hasHeaders.checked,
    headerRowIndex: currentHeaderRowIndex,
    questionIndex,
    answerIndex,
    acceptedIndex
  });
  applyRecordsToDeck(records);
  populateStartRows();

  const saved = safeJson(localStorage.getItem(PROGRESS_KEY));
  const canResumeRows = state.sourceKind === 'google-sheet' || state.sourceKind === 'csv';
  const resumeRow = state.resumeSourceRow
    || (canResumeRows && state.sourceType === 'personal' && saved?.sheetUrl === elements.sheetUrl.value ? saved.sourceRow : null);
  if (canResumeRows && resumeRow) {
    const resumeIndex = state.questions.findIndex((item) => item.sourceRow === resumeRow);
    if (resumeIndex >= 0) {
      elements.startRow.value = String(resumeIndex);
      state.currentIndex = resumeIndex;
    }
  }
  state.resumeSourceRow = null;

  elements.bankSummary.textContent = state.questions.length
    ? `${state.questions.length} usable question${state.questions.length === 1 ? '' : 's'} loaded from ${state.rawRows.length} rows.`
    : 'No usable question-answer rows were found.';

  const success = state.questions.length > 0;
  if (isLocalSource()) {
    const detail = state.sourceDetail ? `${state.sourceDetail} ` : '';
    setLocalFileStatus(
      success
        ? `${detail}${state.questions.length} question${state.questions.length === 1 ? '' : 's'} ready. Check the detected columns below only if something looks wrong.`
        : 'No usable question-answer rows were found. Check “First row has column names” and the selected question/answer fields.',
      success ? 'success' : 'error'
    );
  } else if (state.sourceKind === 'google-sheet') {
    setSheetStatus(
      success
        ? `${state.questions.length} question${state.questions.length === 1 ? '' : 's'} ready`
        : 'Check the selected columns and row contents.',
      success ? 'success' : 'error'
    );
  } else {
    setSheetStatus(
      success
        ? `${state.sourceType === 'demo' ? 'Demo' : 'Question bank'} loaded. Using ${elements.questionColumn.options[elements.questionColumn.selectedIndex]?.textContent} as the question and ${elements.answerColumn.options[elements.answerColumn.selectedIndex]?.textContent} as the answer.`
        : 'Check the selected columns and row contents.',
      success ? 'success' : 'error'
    );
  }
  updateControls();
}

export function loadPastedQuestions() {
  if (sessionIsActive()) {
    setPasteStatus('Stop the current study session before replacing its questions.', 'warning');
    return;
  }

  const parsed = parsePastedQuestions(elements.pasteQuestions.value);
  if (!parsed.cards.length) {
    setPasteStatus(parsed.message, 'error');
    elements.pasteQuestions.focus();
    return;
  }

  try {
    state.sourceType = 'personal';
    state.sourceKind = 'paste';
    state.sourceName = 'Pasted questions';
    state.sourceDetail = '';
    state.rawRows = [];
    elements.mappingPanel.hidden = true;
    setMappingHostVisible(false);
    applyRecordsToDeck(parsed.cards);
    populateStartRows();
    noteSourceLoaded('personal', state.questions.length);
    sheetReadyHandler.hide();
    setPasteStatus(`${parsed.message} Ready to study — no account or upload needed.`, 'success');
    updateControls();
    document.querySelector('#session-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error(error);
    setPasteStatus(error.message || 'Those questions could not be loaded.', 'error');
  }
}

export async function handleStudyFileUpload(event) {
  const input = event.target;
  const [file] = input.files ?? [];
  if (!file) return;

  const ui = localFileElements();
  if (sessionIsActive()) {
    setLocalFileStatus('Stop the current study session before replacing its questions.', 'warning');
    input.value = '';
    return;
  }

  if (ui.fileName) ui.fileName.textContent = file.name;
  setLocalFileStatus(`Reading ${file.name} locally…`, 'loading');
  input.disabled = true;

  try {
    const parsed = await parseStudyFile(file);
    state.sourceType = 'personal';
    state.sourceKind = parsed.sourceKind;
    state.sourceName = parsed.title || file.name;
    state.sourceDetail = parsed.detail || '';
    state.rawRows = [];

    if (parsed.mode === 'cards') {
      elements.mappingPanel.hidden = true;
      setMappingHostVisible(false);
      applyRecordsToDeck(parsed.cards);
      populateStartRows();
      setLocalFileStatus(`${parsed.detail} Ready to study — no account or server upload required.`, 'success');
      updateControls();
    } else {
      prepareRows(parsed.rows, { hasHeaders: parsed.hasHeaders });
    }

    noteSourceLoaded('personal', state.questions.length);
    sheetReadyHandler.hide();
    document.querySelector('#session-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error(error);
    state.currentDeck = null;
    state.questions = [];
    updateControls();
    setLocalFileStatus(error.message || 'That file could not be read locally.', 'error');
  } finally {
    input.disabled = false;
  }
}

async function fetchSheetText(urlString) {
  const url = new URL(urlString);
  url.searchParams.set('_', String(Date.now()));
  const response = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  if (!response.ok) throw new Error(`Google returned HTTP ${response.status}`);
  const text = await response.text();
  if (/<!doctype html|<html/i.test(text)) throw new Error('The sheet returned an HTML page instead of CSV data');
  const rows = parseDelimited(text);
  if (rows.length < 2) throw new Error('The sheet did not contain enough rows');
  return rows;
}

export async function loadGoogleSheetFromParsed(parsed, options = {}) {
  const identity = extractGoogleSheetIdentity(parsed);
  const displayName = options.displayName || (identity ? 'Google Sheet questions' : 'Imported questions');
  saveSettings();
  setSheetStatus('Loading sheet…', 'loading');
  elements.loadSheet.disabled = true;

  try {
    const candidates = [...new Set([parsed.exportCsvUrl, parsed.csvUrl].filter(Boolean))];
    let rows = null;
    let lastError = null;

    for (const candidate of candidates) {
      try {
        rows = await fetchSheetText(candidate);
        break;
      } catch (error) {
        lastError = error;
        console.warn(`Sheet endpoint failed: ${candidate}`, error);
      }
    }

    if (!rows) throw lastError ?? new Error('No readable sheet endpoint was available');
    state.sourceType = 'personal';
    state.sourceKind = identity ? 'google-sheet' : 'csv';
    state.sourceName = displayName;
    state.sourceDetail = '';
    state.savedSourceId = options.savedSourceId ?? null;
    state.googleSheetIdentity = identity;
    if (options.lastSourceRow) state.resumeSourceRow = options.lastSourceRow;
    prepareRows(rows);
    noteSourceLoaded('personal', state.questions.length);
    if (identity && state.questions.length) {
      setSheetStatus(`${state.questions.length} question${state.questions.length === 1 ? '' : 's'} ready`, 'success');
      sheetReadyHandler.show(state.questions.length, identity);
    } else {
      sheetReadyHandler.hide();
    }
    return { identity, questionCount: state.questions.length };
  } catch (error) {
    console.error(error);
    const publicAccessHint = /html|http 4/i.test(String(error.message || ''));
    setSheetStatus(
      publicAccessHint
        ? 'This Google Sheet is no longer publicly readable. Set General access to “Anyone with the link — Viewer,” or keep studying any deck already loaded.'
        : 'Could not read the sheet. Set General access to “Anyone with the link — Viewer,” or use the zero-signup local file importer above.',
      'error'
    );
    throw error;
  } finally {
    elements.loadSheet.disabled = false;
  }
}

export async function loadGoogleSheet() {
  if (sessionIsActive()) {
    setSheetStatus('Stop the current study session before replacing its questions.', 'warning');
    return;
  }
  const parsed = parseGoogleSheetUrl(elements.sheetUrl.value);
  if (!parsed) {
    setSheetStatus('Paste a valid Google Sheets URL or direct CSV URL.', 'error');
    return;
  }
  try {
    await loadGoogleSheetFromParsed(parsed);
  } catch {
    // Status is already shown. Keep the local session intact.
  }
}

export async function loadSavedGoogleSheet(source) {
  if (sessionIsActive()) {
    throw new Error('Stop the current study session before replacing its questions.');
  }
  const urls = reconstructGoogleSheetUrls(source.spreadsheet_id || source.spreadsheetId, source.sheet_gid || source.sheetGid);
  if (!urls) throw new Error('That saved sheet reference is incomplete.');
  elements.sheetUrl.value = `https://docs.google.com/spreadsheets/d/${urls.spreadsheetId}/edit?gid=${urls.gid}`;
  await loadGoogleSheetFromParsed(urls, {
    displayName: source.display_name || source.displayName || 'Google Sheet',
    savedSourceId: source.id ?? null,
    lastSourceRow: source.last_source_row ?? source.lastSourceRow ?? null
  });
}

export async function loadDemo() {
  setSheetStatus('Loading five demo questions…', 'loading');
  const response = await fetch('./data/sample-questions.csv');
  const text = await response.text();
  state.sourceType = 'demo';
  state.sourceKind = 'demo';
  state.sourceName = 'samme3le demo';
  state.sourceDetail = '';
  state.savedSourceId = null;
  elements.sheetUrl.value = 'Built-in demo';
  prepareRows(parseDelimited(text));
  noteSourceLoaded('demo', state.questions.length);
  sheetReadyHandler.hide();
  document.querySelector('#session-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function handleCsvUpload(event) {
  const [file] = event.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.sourceType = 'personal';
    state.sourceKind = 'csv';
    state.sourceName = file.name;
    state.sourceDetail = '';
    state.savedSourceId = null;
    elements.sheetUrl.value = `Uploaded: ${file.name}`;
    prepareRows(parseDelimited(String(reader.result ?? '')));
    noteSourceLoaded('personal', state.questions.length);
    sheetReadyHandler.hide();
  };
  reader.onerror = () => setSheetStatus('Unable to read that CSV file.', 'error');
  reader.readAsText(file);
}

export function setupSheetEvents() {
  elements.loadPaste.addEventListener('click', loadPastedQuestions);
  elements.loadSheet.addEventListener('click', loadGoogleSheet);
  elements.loadDemo.addEventListener('click', loadDemo);
  elements.csvUpload.addEventListener('change', handleCsvUpload);
  document.querySelector('#studyFileUpload')?.addEventListener('change', handleStudyFileUpload);
  elements.applyMapping.addEventListener('click', applyColumnMapping);
  elements.hasHeaders.addEventListener('change', () => state.rawRows.length && prepareRows(state.rawRows));
}
