import { loadDeck } from './deck.js';
import { buildQuestionBank, columnName, detectColumns, parseDelimited, parseGoogleSheetUrl } from './sheet-data.js';
import {
  PROGRESS_KEY,
  elements,
  safeJson,
  saveSettings,
  setSheetStatus,
  state,
  updateControls
} from './dom.js';
import { noteSourceLoaded, requireBetaAccess } from './beta.js';

let currentHeaderRowIndex = 0;

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

function currentDeckTitle() {
  if (state.sourceKind === 'demo') return 'samme3le demo';
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
}

export function prepareRows(rows) {
  state.rawRows = rows;
  const detection = detectColumns(rows, elements.hasHeaders.checked);
  currentHeaderRowIndex = detection.headerRowIndex;

  populateColumnSelect(elements.questionColumn, detection.headers);
  populateColumnSelect(elements.answerColumn, detection.headers);
  populateColumnSelect(elements.acceptedColumn, detection.headers, true);
  elements.questionColumn.value = String(detection.questionIndex);
  elements.answerColumn.value = String(detection.answerIndex);
  elements.acceptedColumn.value = String(detection.acceptedIndex);
  elements.mappingPanel.hidden = false;
  applyColumnMapping();
}

export function applyColumnMapping() {
  const questionIndex = Number(elements.questionColumn.value);
  const answerIndex = Number(elements.answerColumn.value);
  const acceptedIndex = Number(elements.acceptedColumn.value);

  if (questionIndex === answerIndex) {
    setSheetStatus('Question and answer must use different columns.', 'error');
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

  elements.startRow.innerHTML = '';
  elements.startRow.disabled = state.questions.length === 0;
  state.questions.forEach((item, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${state.sourceType === 'demo' ? 'Demo' : 'Sheet'} row ${item.sourceRow} — ${truncate(item.question, 90)}`;
    elements.startRow.append(option);
  });

  const saved = safeJson(localStorage.getItem(PROGRESS_KEY));
  if (state.sourceType === 'personal' && saved?.sheetUrl === elements.sheetUrl.value && saved.sourceRow) {
    const resumeIndex = state.questions.findIndex((item) => item.sourceRow === saved.sourceRow);
    if (resumeIndex >= 0) elements.startRow.value = String(resumeIndex);
  }

  elements.bankSummary.textContent = state.questions.length
    ? `${state.questions.length} usable question${state.questions.length === 1 ? '' : 's'} loaded from ${state.rawRows.length} rows.`
    : 'No usable question-answer rows were found.';
  setSheetStatus(
    state.questions.length
      ? `${state.sourceType === 'demo' ? 'Demo' : 'Question bank'} loaded. Using ${elements.questionColumn.options[elements.questionColumn.selectedIndex]?.textContent} as the question and ${elements.answerColumn.options[elements.answerColumn.selectedIndex]?.textContent} as the answer.`
      : 'Check the selected columns and row contents.',
    state.questions.length ? 'success' : 'error'
  );
  updateControls();
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

export async function loadGoogleSheet() {
  if (!requireBetaAccess()) return;
  const parsed = parseGoogleSheetUrl(elements.sheetUrl.value);
  if (!parsed) {
    setSheetStatus('Paste a valid Google Sheets URL or direct CSV URL.', 'error');
    return;
  }

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
    state.sourceKind = 'google-sheet';
    prepareRows(rows);
    noteSourceLoaded('personal', state.questions.length);
  } catch (error) {
    console.error(error);
    setSheetStatus(
      'Could not read the sheet. Set General access to “Anyone with the link — Viewer,” or export/upload a CSV file.',
      'error'
    );
  } finally {
    elements.loadSheet.disabled = false;
  }
}

export async function loadDemo() {
  setSheetStatus('Loading five demo questions…', 'loading');
  const response = await fetch('./data/sample-questions.csv');
  const text = await response.text();
  state.sourceType = 'demo';
  state.sourceKind = 'demo';
  elements.sheetUrl.value = 'Built-in demo';
  prepareRows(parseDelimited(text));
  noteSourceLoaded('demo', state.questions.length);
  document.querySelector('#session-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function handleCsvUpload(event) {
  if (!requireBetaAccess()) {
    event.target.value = '';
    return;
  }
  const [file] = event.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.sourceType = 'personal';
    state.sourceKind = 'csv';
    elements.sheetUrl.value = `Uploaded: ${file.name}`;
    prepareRows(parseDelimited(String(reader.result ?? '')));
    noteSourceLoaded('personal', state.questions.length);
  };
  reader.onerror = () => setSheetStatus('Unable to read that CSV file.', 'error');
  reader.readAsText(file);
}

export function setupSheetEvents() {
  elements.loadSheet.addEventListener('click', loadGoogleSheet);
  elements.loadDemo.addEventListener('click', loadDemo);
  elements.csvUpload.addEventListener('change', handleCsvUpload);
  elements.applyMapping.addEventListener('click', applyColumnMapping);
  elements.hasHeaders.addEventListener('change', () => state.rawRows.length && prepareRows(state.rawRows));
}
