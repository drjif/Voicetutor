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

  state.questions = buildQuestionBank(state.rawRows, {
    hasHeaders: elements.hasHeaders.checked,
    headerRowIndex: currentHeaderRowIndex,
    questionIndex,
    answerIndex,
    acceptedIndex
  });

  elements.startRow.innerHTML = '';
  elements.startRow.disabled = state.questions.length === 0;
  state.questions.forEach((item, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `Sheet row ${item.sourceRow} — ${truncate(item.question, 90)}`;
    elements.startRow.append(option);
  });

  const saved = safeJson(localStorage.getItem(PROGRESS_KEY));
  if (saved?.sheetUrl === elements.sheetUrl.value && saved.sourceRow) {
    const resumeIndex = state.questions.findIndex((item) => item.sourceRow === saved.sourceRow);
    if (resumeIndex >= 0) elements.startRow.value = String(resumeIndex);
  }

  elements.bankSummary.textContent = state.questions.length
    ? `${state.questions.length} usable question${state.questions.length === 1 ? '' : 's'} loaded from ${state.rawRows.length} sheet rows.`
    : 'No usable question-answer rows were found.';
  setSheetStatus(
    state.questions.length
      ? `Sheet loaded. Using ${elements.questionColumn.options[elements.questionColumn.selectedIndex]?.textContent} as the question and ${elements.answerColumn.options[elements.answerColumn.selectedIndex]?.textContent} as the answer.`
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
    prepareRows(rows);
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
  setSheetStatus('Loading demo questions…', 'loading');
  const response = await fetch('./data/sample-questions.csv');
  const text = await response.text();
  elements.sheetUrl.value = 'Built-in demo';
  prepareRows(parseDelimited(text));
}

export function handleCsvUpload(event) {
  const [file] = event.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    elements.sheetUrl.value = `Uploaded: ${file.name}`;
    prepareRows(parseDelimited(String(reader.result ?? '')));
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
