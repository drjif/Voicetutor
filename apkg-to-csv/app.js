import { readAnkiFile, ApkgError } from './apkg-read.js';
import { buildTable, describeDeck, fileSlug, studyHandoff, toCsv, toQuizletText, toTsv } from './convert.js';
import { HANDOFF_MAX_CHARS, storeHandoff } from '../handoff.js';
import { trackThenNavigate, trackToolEvent, trackToolView } from '../tool-analytics.js';

const TOOL = 'apkg-to-csv';
const PREVIEW_ROWS = 5;
const PREVIEW_CHARS = 240;

const $ = (selector) => document.querySelector(selector);

const converter = $('.converter');
const fileInput = $('#apkgFile');
const exampleButton = $('#loadExample');
const status = $('#convertStatus');
const result = $('#convertResult');
const summaryLine = $('#deckSummary');
const modeInputs = [...document.querySelectorAll('input[name="columns"]')];
const modeHint = $('#modeHint');
const deckField = $('#deckField');
const deckSelect = $('#deckSelect');
const typeField = $('#typeField');
const typeSelect = $('#typeSelect');
const tagsField = $('#tagsField');
const tagsBox = $('#includeTags');
const htmlBox = $('#keepHtml');
const previewHead = $('#previewHead');
const previewBody = $('#previewBody');
const previewMore = $('#previewMore');
const mediaNote = $('#mediaNote');
const downloadCsv = $('#downloadCsv');
const downloadTsv = $('#downloadTsv');
const copyQuizlet = $('#copyQuizlet');
const studyLink = $('#studyOutLoud');
const studyNote = $('#studyNote');

let deck = null;
let info = null;
let title = 'anki-deck';
let table = null;
let tableKey = '';
let study = null;
let studyKey = '';
let busy = false;
let convertedTracked = false;

const number = new Intl.NumberFormat('en-US');
const count = (n, word, plural = `${word}s`) => `${number.format(n)} ${n === 1 ? word : plural}`;

function track(name, params = {}) {
  trackToolEvent(name, TOOL, params);
}

function setStatus(type, message) {
  status.dataset.type = type;
  status.textContent = message;
}

function options() {
  return {
    mode: modeInputs.find((input) => input.checked)?.value ?? 'fields',
    html: htmlBox.checked,
    tags: tagsBox.checked,
    deckName: deckSelect.value,
    typeId: typeSelect.value
  };
}

/** The table for the current options (cached: big decks take a moment to build). */
function currentTable() {
  const opts = options();
  const key = JSON.stringify(opts);
  if (key !== tableKey) {
    table = buildTable(deck, opts);
    tableKey = key;
  }
  return table;
}

function currentStudy() {
  const { deckName, typeId } = options();
  const key = `${deckName}\u0000${typeId}`;
  if (key !== studyKey) {
    study = studyHandoff(deck, { deckName, typeId, maxChars: HANDOFF_MAX_CHARS });
    studyKey = key;
  }
  return study;
}

function titleFor(fileName) {
  const base = String(fileName ?? '').replace(/\.(apkg|colpkg|anki2|anki21)$/i, '').trim();
  return base || 'anki-deck';
}

function option(value, label) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}

function setupOptions() {
  modeInputs.forEach((input) => { input.checked = input.value === 'fields'; });
  htmlBox.checked = false;
  tagsBox.checked = true;
  tagsField.hidden = info.tagged === 0;

  deckSelect.replaceChildren(option('', `All decks (${count(info.noteCount, 'note')})`));
  for (const item of info.decks) {
    const name = item.name.split('::').pop();
    deckSelect.append(option(item.name, `${' '.repeat(item.depth)}${name} (${number.format(item.count)})`));
  }
  deckField.hidden = info.deckCount < 2;

  typeSelect.replaceChildren(option('', 'All note types'));
  for (const type of info.noteTypes) typeSelect.append(option(type.id, `${type.name} (${number.format(type.count)})`));
  typeField.hidden = info.noteTypes.length < 2;
}

function summaryText() {
  const decks = info.decks.filter((item) => item.depth === 0);
  const deckLabel = decks.length === 1 ? decks[0].name : count(info.deckCount, 'deck');
  const types = info.noteTypes.map((type) => type.name);
  const typeLabel = types.length <= 3 ? types.join(', ') : count(types.length, 'note type');
  return [deckLabel, count(info.noteCount, 'note'), typeLabel].filter(Boolean).join(' · ');
}

function cell(tag, text) {
  const element = document.createElement(tag);
  const value = String(text ?? '');
  element.textContent = value.length > PREVIEW_CHARS ? `${value.slice(0, PREVIEW_CHARS)}…` : value;
  if (!value) element.classList.add('empty');
  return element;
}

function render() {
  if (!deck) return;
  const opts = options();
  const current = currentTable();
  const rows = current.rows.length;
  const word = opts.mode === 'cards' ? 'card' : 'note';

  if (rows) {
    setStatus('success', `${count(rows, word)} ready to download.`);
  } else {
    setStatus('warning', opts.mode === 'cards'
      ? 'None of these notes has text on both sides, so there are no front & back cards. Try All fields.'
      : 'There are no notes in this selection.');
  }
  summaryLine.textContent = summaryText();
  modeHint.textContent = opts.mode === 'cards'
    ? 'One row per card: front and back. Cloze deletions become separate cards. Best for Quizlet and other flashcard apps.'
    : 'One row per note, with every field in its own column, like Anki’s own export.';

  previewHead.replaceChildren(...current.header.map((name) => {
    const th = cell('th', name);
    th.scope = 'col';
    return th;
  }));
  previewBody.replaceChildren(...current.rows.slice(0, PREVIEW_ROWS).map((row) => {
    const tr = document.createElement('tr');
    tr.append(...row.map((value) => cell('td', value)));
    return tr;
  }));
  const more = rows - Math.min(rows, PREVIEW_ROWS);
  previewMore.textContent = more ? `+ ${count(more, 'more row')}` : '';

  const notes = [];
  const media = [info.images && count(info.images, 'image'), info.sounds && count(info.sounds, 'audio file')].filter(Boolean);
  if (media.length) {
    notes.push(`This deck has ${media.join(' and ')}. CSV holds text only, so ${info.images + info.sounds === 1 ? 'it isn’t' : 'they aren’t'} included${opts.html ? ', but the file names stay in the HTML' : ''}.`);
  }
  if (opts.mode === 'cards' && current.skipped) {
    notes.push(`${count(current.skipped, 'note')} with no text on one side (such as picture-only cards) ${current.skipped === 1 ? 'is' : 'are'} left out.`);
  }
  mediaNote.hidden = !notes.length;
  mediaNote.textContent = notes.join(' ');

  const disabled = !rows;
  for (const button of [downloadCsv, downloadTsv, copyQuizlet]) button.disabled = disabled;

  const plan = currentStudy();
  studyLink.setAttribute('aria-disabled', String(!plan.count));
  studyLink.textContent = plan.count === 1 ? 'Study this card out loud — free' : 'Study these cards out loud — free';
  if (!plan.count) {
    studyNote.hidden = false;
    studyNote.textContent = 'None of these notes has text on both sides, so there’s nothing to quiz yet.';
  } else if (plan.count < plan.total) {
    studyNote.hidden = false;
    studyNote.textContent = `Big deck: same3le opens the first ${number.format(plan.count)} of ${number.format(plan.total)} cards at a time.${deckField.hidden ? '' : ' Pick a deck above to choose which ones.'}`;
  } else {
    studyNote.hidden = true;
  }

  result.hidden = false;
}

const nextFrame = () => new Promise((resolve) => { requestAnimationFrame(() => setTimeout(resolve, 0)); });

/** One loader for the picker, drag and drop, and the example deck. */
async function openFile(file, method) {
  if (!file || busy) return;
  busy = true;
  converter.classList.add('is-busy');
  setStatus('working', 'Reading your deck…');
  await nextFrame();
  try {
    const loaded = await readAnkiFile(file);
    if (!loaded.notes.length) throw new ApkgError('no-notes', 'That deck has no cards in it.');
    deck = loaded;
    info = describeDeck(deck);
    title = titleFor(file.name);
    tableKey = '';
    studyKey = '';
    if (method) track('tool_file_opened', { method, result: 'success' });
    setupOptions();
    render();
    if (!convertedTracked) {
      convertedTracked = true;
      track('tool_converted', { question_count: info.studyCards });
    }
  } catch (error) {
    console.warn('Could not read the Anki file.', error);
    if (method) track('tool_file_opened', { method, result: 'error' });
    deck = null;
    result.hidden = true;
    setStatus('warning', error instanceof ApkgError ? error.message : 'That file couldn’t be read. Export the deck from Anki again, then try once more.');
  } finally {
    busy = false;
    converter.classList.remove('is-busy');
  }
}

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function flash(button, message) {
  const original = button.dataset.label ?? button.textContent;
  button.dataset.label = original;
  button.textContent = message;
  window.setTimeout(() => { button.textContent = original; }, 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

function fileName(extension) {
  const { deckName, typeId } = options();
  const parts = [deckName ? deckName.split('::').pop() : title];
  if (typeId) parts.push(typeSelect.selectedOptions[0]?.textContent.replace(/\s*\([\d,]+\)$/, '') ?? '');
  return `${fileSlug(parts.join(' '))}.${extension}`;
}

// Drag and drop: the whole page accepts a dropped file. Only file drags are intercepted.
let dragDepth = 0;
const isFileDrag = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
function endDrag() {
  dragDepth = 0;
  converter.classList.remove('is-dragging');
}
document.addEventListener('dragenter', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth += 1;
  converter.classList.add('is-dragging');
});
document.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', (event) => {
  if (!isFileDrag(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) converter.classList.remove('is-dragging');
});
document.addEventListener('drop', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  endDrag();
  openFile(event.dataTransfer.files[0], 'drop');
});
window.addEventListener('blur', endDrag);

fileInput.addEventListener('change', async () => {
  await openFile(fileInput.files?.[0], 'picker');
  fileInput.value = '';
});

exampleButton.addEventListener('click', async () => {
  if (busy) return;
  setStatus('working', 'Opening the example deck…');
  try {
    const response = await fetch('/apkg-to-csv/example.apkg');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    track('tool_example_used');
    await openFile(new File([blob], 'Cell biology (example).apkg'), null);
  } catch (error) {
    console.warn(error);
    setStatus('warning', 'The example deck couldn’t be loaded. Check your connection, or choose your own .apkg file.');
  }
});

for (const input of [...modeInputs, htmlBox, tagsBox, deckSelect, typeSelect]) input.addEventListener('change', render);

downloadCsv.addEventListener('click', () => {
  if (!deck) return;
  const current = currentTable();
  // The byte-order mark lets Excel recognise UTF-8, so accents and symbols survive.
  download(`﻿${toCsv(current)}`, fileName('csv'), 'text/csv;charset=utf-8');
  track('tool_downloaded', { format: 'csv', question_count: current.rows.length });
});

downloadTsv.addEventListener('click', () => {
  if (!deck) return;
  const current = currentTable();
  download(`﻿${toTsv(current)}`, fileName('tsv'), 'text/tab-separated-values;charset=utf-8');
  track('tool_downloaded', { format: 'tsv', question_count: current.rows.length });
});

copyQuizlet.addEventListener('click', async () => {
  if (!deck) return;
  const { deckName, typeId } = options();
  const text = toQuizletText(deck, { deckName, typeId });
  if (!text) {
    flash(copyQuizlet, 'Nothing to copy');
    return;
  }
  const ok = await copyText(text);
  flash(copyQuizlet, ok ? 'Copied — paste in Quizlet' : 'Copy failed');
  track('tool_downloaded', { format: 'copy', question_count: text.split('\n').length });
});

studyLink.addEventListener('click', async (event) => {
  if (!deck) return;
  event.preventDefault();
  const plan = currentStudy();
  if (!plan.count) return;
  // Preferred: hand the cards straight to the app in this tab. Fallback: clipboard.
  const handedOff = storeHandoff(plan.text, TOOL);
  if (!handedOff) await copyText(plan.text);
  trackThenNavigate('tool_study_clicked', TOOL, { method: handedOff ? 'handoff' : 'clipboard', question_count: plan.count }, studyLink.href);
});

document.documentElement.classList.add('js');
trackToolView(TOOL);
