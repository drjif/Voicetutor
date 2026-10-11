import { parseQuizletExport, toAnkiText, toCsv, toSame3lePaste, fileSlug } from './convert.js';
import { storeHandoff } from '../handoff.js';
import { trackToolEvent, trackThenNavigate, trackToolView } from '../tool-analytics.js';

const TOOL = 'quizlet-to-anki';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const TEXT_FILE = /\.(txt|tsv|csv|text)$/i;

const $ = (selector) => document.querySelector(selector);

const converter = $('.converter');
const input = $('#quizletInput');
const fileInput = $('#quizletFile');
const exampleButton = $('#loadExample');
const clearButton = $('#clearInput');
const termSelect = $('#termSeparator');
const rowSelect = $('#rowSeparator');
const customTerm = $('#customTerm');
const customRow = $('#customRow');
const swapBox = $('#swapSides');
const deckInput = $('#deckName');
const status = $('#convertStatus');
const result = $('#convertResult');
const preview = $('#previewBody');
const previewMore = $('#previewMore');
const skippedBox = $('#skippedBox');
const skippedList = $('#skippedList');
const detected = $('#detectedFormat');
const downloadAnki = $('#downloadAnki');
const downloadCsv = $('#downloadCsv');
const copyAnki = $('#copyAnki');
const studyLink = $('#studyOutLoud');

const EXAMPLE = [
  'mitochondria\tpowerhouse of the cell; makes ATP',
  'ribosome\tbuilds proteins from mRNA',
  'osmosis\tmovement of water across a membrane',
  'photosynthesis\tlight + water + CO2 → glucose + oxygen',
  'enzyme\ta protein that speeds up a reaction'
].join('\n');

const LABELS = { tab: 'Tab', comma: 'Comma', dash: 'Dash ( - )', semicolon: 'Semicolon', newline: 'New line', custom: 'Custom' };

let cards = [];
let convertedTracked = false;

function track(name, params = {}) {
  trackToolEvent(name, TOOL, params);
}

function setStatus(type, message) {
  status.dataset.type = type;
  status.textContent = message;
}

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function render() {
  customTerm.hidden = termSelect.value !== 'custom';
  customRow.hidden = rowSelect.value !== 'custom';

  const text = input.value;
  if (!text.trim()) {
    cards = [];
    result.hidden = true;
    skippedBox.hidden = true;
    setStatus('neutral', 'Paste your Quizlet export above. The result appears here instantly.');
    return;
  }

  const parsed = parseQuizletExport(text, {
    termSeparator: termSelect.value,
    rowSeparator: rowSelect.value,
    customTerm: customTerm.value,
    customRow: customRow.value,
    swap: swapBox.checked
  });
  cards = parsed.cards;

  detected.textContent = `Reading as: ${LABELS[parsed.termSeparator] ?? parsed.termSeparator} between term and definition, ${LABELS[parsed.rowSeparator] ?? parsed.rowSeparator} between cards.`;

  skippedList.replaceChildren();
  parsed.skipped.slice(0, 5).forEach((item) => {
    const li = document.createElement('li');
    li.textContent = `Line ${item.row}: ${item.text.length > 80 ? `${item.text.slice(0, 80)}…` : item.text}`;
    skippedList.append(li);
  });
  skippedBox.hidden = parsed.skipped.length === 0;
  $('#skippedCount').textContent = String(parsed.skipped.length);

  if (!cards.length) {
    result.hidden = true;
    setStatus('warning', 'No cards found yet. Open “Separator settings” and pick the separators you chose in Quizlet’s Export window.');
    return;
  }

  setStatus('success', `${cards.length} card${cards.length === 1 ? '' : 's'} ready for Anki.`);
  result.hidden = false;

  preview.replaceChildren();
  cards.slice(0, 5).forEach((card) => {
    const tr = document.createElement('tr');
    tr.append(cell(card.term), cell(card.definition));
    preview.append(tr);
  });
  previewMore.textContent = cards.length > 5 ? `+ ${cards.length - 5} more card${cards.length - 5 === 1 ? '' : 's'}` : '';

  if (!convertedTracked) {
    convertedTracked = true;
    track('tool_converted', { question_count: cards.length });
  }
}

let timer = 0;
function scheduleRender() {
  window.clearTimeout(timer);
  timer = window.setTimeout(render, 120);
}

function download(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
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

/** One loader for both the "Open file" button and drag-and-drop. */
async function openFile(file, method) {
  if (!file) return;
  if (!TEXT_FILE.test(file.name) && !/^text\//.test(file.type)) {
    const ext = file.name.includes('.') ? file.name.split('.').pop().toUpperCase() : 'That';
    setStatus('warning', `${ext} files can’t be converted. Use the .txt file Quizlet exports, or paste the text.`);
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setStatus('warning', 'That file is larger than 20 MB. Export a smaller set from Quizlet.');
    return;
  }
  try {
    input.value = await file.text();
  } catch {
    setStatus('warning', 'That file couldn’t be read. Try opening it again, or paste the text.');
    return;
  }
  if (!deckInput.value) deckInput.value = file.name.replace(/\.[^.]+$/, '');
  track('tool_file_opened', { method });
  render();
}

// Drag and drop: the whole page accepts a dropped file, so there's nothing to aim for.
// Only file drags are intercepted; dragging text into the box keeps the browser's behaviour.
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
  const files = event.dataTransfer.files;
  openFile(files[0], 'drop');
});
window.addEventListener('blur', endDrag);

input.addEventListener('input', scheduleRender);
[termSelect, rowSelect, swapBox].forEach((el) => el.addEventListener('change', render));
[customTerm, customRow].forEach((el) => el.addEventListener('input', scheduleRender));

exampleButton.addEventListener('click', () => {
  input.value = EXAMPLE;
  termSelect.value = 'auto';
  rowSelect.value = 'auto';
  render();
  track('tool_example_used');
});

clearButton.addEventListener('click', () => {
  input.value = '';
  render();
  input.focus();
});

fileInput.addEventListener('change', async () => {
  await openFile(fileInput.files?.[0], 'picker');
  fileInput.value = '';
});

downloadAnki.addEventListener('click', () => {
  if (!cards.length) return;
  download(toAnkiText(cards, { deck: deckInput.value }), `${fileSlug(deckInput.value)}-anki.txt`, 'text/plain;charset=utf-8');
  track('tool_downloaded', { format: 'anki_txt', question_count: cards.length });
});

downloadCsv.addEventListener('click', () => {
  if (!cards.length) return;
  download(`﻿${toCsv(cards)}`, `${fileSlug(deckInput.value)}.csv`, 'text/csv;charset=utf-8');
  track('tool_downloaded', { format: 'csv', question_count: cards.length });
});

copyAnki.addEventListener('click', async () => {
  if (!cards.length) return;
  const ok = await copyText(toAnkiText(cards, { deck: deckInput.value }));
  flash(copyAnki, ok ? 'Copied' : 'Copy failed');
  track('tool_downloaded', { format: 'copy', question_count: cards.length });
});

studyLink.addEventListener('click', async (event) => {
  if (!cards.length) return;
  event.preventDefault();
  const paste = toSame3lePaste(cards);
  // Preferred: hand the cards straight to the app in this tab. Fallback: clipboard.
  const handedOff = storeHandoff(paste, TOOL);
  if (!handedOff) await copyText(paste);
  // Wait for GA to take the event (max 350 ms) so this funnel step isn't lost on navigation.
  trackThenNavigate('tool_study_clicked', TOOL, { method: handedOff ? 'handoff' : 'clipboard', question_count: cards.length }, studyLink.href);
});

document.documentElement.classList.add('js');
trackToolView(TOOL);
render();
