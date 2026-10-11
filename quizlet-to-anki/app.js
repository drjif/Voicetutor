import { parseQuizletExport, toAnkiText, toCsv, toSame3lePaste, fileSlug } from './convert.js';
import { storeHandoff } from '../handoff.js';

const $ = (selector) => document.querySelector(selector);

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
let tracked = false;

function track(name, params = {}) {
  try {
    if (typeof window.gtag === 'function') window.gtag('event', name, params);
  } catch { /* analytics must never break the tool */ }
}

function countBucket(n) {
  if (n < 25) return '1-24';
  if (n < 100) return '25-99';
  if (n < 500) return '100-499';
  return '500+';
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
    status.dataset.type = 'neutral';
    status.textContent = 'Paste your Quizlet export above. The result appears here instantly.';
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
    status.dataset.type = 'warning';
    status.textContent = 'No cards found yet. Open “Separator settings” and pick the separators you chose in Quizlet’s Export window.';
    return;
  }

  status.dataset.type = 'success';
  status.textContent = `${cards.length} card${cards.length === 1 ? '' : 's'} ready for Anki.`;
  result.hidden = false;

  preview.replaceChildren();
  cards.slice(0, 5).forEach((card) => {
    const tr = document.createElement('tr');
    tr.append(cell(card.term), cell(card.definition));
    preview.append(tr);
  });
  previewMore.textContent = cards.length > 5 ? `+ ${cards.length - 5} more card${cards.length - 5 === 1 ? '' : 's'}` : '';

  if (!tracked) {
    tracked = true;
    track('quizlet_tool_convert', { cards: countBucket(cards.length) });
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

input.addEventListener('input', scheduleRender);
[termSelect, rowSelect, swapBox].forEach((el) => el.addEventListener('change', render));
[customTerm, customRow].forEach((el) => el.addEventListener('input', scheduleRender));

exampleButton.addEventListener('click', () => {
  input.value = EXAMPLE;
  termSelect.value = 'auto';
  rowSelect.value = 'auto';
  render();
  track('quizlet_tool_example');
});

clearButton.addEventListener('click', () => {
  input.value = '';
  render();
  input.focus();
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    status.dataset.type = 'warning';
    status.textContent = 'That file is larger than 20 MB. Export a smaller set from Quizlet.';
    return;
  }
  input.value = await file.text();
  if (!deckInput.value) deckInput.value = file.name.replace(/\.[^.]+$/, '');
  render();
  fileInput.value = '';
});

downloadAnki.addEventListener('click', () => {
  if (!cards.length) return;
  download(toAnkiText(cards, { deck: deckInput.value }), `${fileSlug(deckInput.value)}-anki.txt`, 'text/plain;charset=utf-8');
  track('quizlet_tool_download', { format: 'anki_txt', cards: countBucket(cards.length) });
});

downloadCsv.addEventListener('click', () => {
  if (!cards.length) return;
  download(`﻿${toCsv(cards)}`, `${fileSlug(deckInput.value)}.csv`, 'text/csv;charset=utf-8');
  track('quizlet_tool_download', { format: 'csv', cards: countBucket(cards.length) });
});

copyAnki.addEventListener('click', async () => {
  if (!cards.length) return;
  const ok = await copyText(toAnkiText(cards, { deck: deckInput.value }));
  flash(copyAnki, ok ? 'Copied' : 'Copy failed');
  track('quizlet_tool_download', { format: 'copy', cards: countBucket(cards.length) });
});

studyLink.addEventListener('click', async (event) => {
  if (!cards.length) return;
  event.preventDefault();
  const paste = toSame3lePaste(cards);
  // Preferred: hand the cards straight to the app in this tab. Fallback: clipboard.
  const handedOff = storeHandoff(paste, 'quizlet-to-anki');
  if (!handedOff) await copyText(paste);
  track('quizlet_tool_cta', { cards: countBucket(cards.length), method: handedOff ? 'handoff' : 'clipboard' });
  window.location.href = studyLink.href;
});

document.documentElement.classList.add('js');
render();
