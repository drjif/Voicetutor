import {
  parseAiFlashcards,
  toAnkiBasic,
  toAnkiCloze,
  toCsvCards,
  toHandoffText,
  fileSlug
} from './convert.js';
import { storeHandoff } from '../handoff.js';
import { trackToolEvent, trackThenNavigate, trackToolView } from '../tool-analytics.js';

const TOOL = 'chatgpt-to-anki';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const TEXT_FILE = /\.(txt|md|markdown|csv|tsv|text)$/i;

const $ = (selector) => document.querySelector(selector);

const converter = $('.converter');
const input = $('#aiInput');
const fileInput = $('#aiFile');
const exampleButton = $('#loadExample');
const clearButton = $('#clearInput');
const swapBox = $('#swapSides');
const deckInput = $('#deckName');
const status = $('#convertStatus');
const result = $('#convertResult');
const preview = $('#previewBody');
const previewFront = $('#previewFront');
const previewBack = $('#previewBack');
const previewMore = $('#previewMore');
const skippedBox = $('#skippedBox');
const detected = $('#detectedFormat');
const downloadAnki = $('#downloadAnki');
const downloadCsv = $('#downloadCsv');
const copyAnki = $('#copyAnki');
const studyLink = $('#studyOutLoud');
const copyPrompt = $('#copyPrompt');
const promptText = $('#aiPrompt');

const EXAMPLE = [
  'Sure! Here are 5 flashcards on cell biology:',
  '',
  '**Card 1**',
  '**Front:** What organelle makes most of a cell’s ATP?',
  '**Back:** The mitochondrion',
  '',
  '**Card 2**',
  '**Front:** What do ribosomes build?',
  '**Back:** Proteins',
  '',
  '**Card 3**',
  '**Front:** What is osmosis?',
  '**Back:** The movement of water across a semipermeable membrane',
  '',
  '**Card 4**',
  '**Front:** Where is DNA stored in a eukaryotic cell?',
  '**Back:** The nucleus',
  '',
  '**Card 5**',
  '**Front:** What does an enzyme do?',
  '**Back:** Speeds up a chemical reaction without being used up',
  '',
  'Want me to make more cards on this topic?'
].join('\n');

let parsed = { mode: 'basic', cards: [], clozeNotes: [], skipped: 0 };
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

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function render() {
  const text = input.value;
  if (!text.trim()) {
    parsed = { mode: 'basic', cards: [], clozeNotes: [], skipped: 0 };
    result.hidden = true;
    skippedBox.hidden = true;
    setStatus('neutral', 'Paste your AI’s flashcards above. The result appears here instantly.');
    return;
  }

  parsed = parseAiFlashcards(text, { swap: swapBox.checked });
  const { cards, mode } = parsed;

  skippedBox.hidden = !(mode === 'cloze' && parsed.skipped);
  $('#skippedCount').textContent = String(parsed.skipped);

  if (!cards.length) {
    result.hidden = true;
    setStatus('warning', 'No cards found yet. Each card needs a question and an answer. Ask your AI for Q: and A: lines, or use the prompt below.');
    return;
  }

  if (mode === 'cloze') {
    setStatus('success', `${plural(parsed.clozeNotes.length, 'cloze note')} ready for Anki (${plural(cards.length, 'card')}).`);
    detected.textContent = 'Read as: cloze deletions. They import as Anki’s built-in Cloze note type.';
    previewFront.textContent = 'Card';
    previewBack.textContent = 'Hidden answer';
  } else {
    setStatus('success', `${plural(cards.length, 'card')} ready for Anki.`);
    detected.textContent = `Read as: ${parsed.format}.`;
    previewFront.textContent = 'Front';
    previewBack.textContent = 'Back';
  }
  result.hidden = false;

  preview.replaceChildren();
  cards.slice(0, 5).forEach((card) => {
    const tr = document.createElement('tr');
    tr.append(cell(card.question), cell(card.answer));
    preview.append(tr);
  });
  previewMore.textContent = cards.length > 5 ? `+ ${plural(cards.length - 5, 'more card')}` : '';

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

function ankiFile() {
  return parsed.mode === 'cloze'
    ? toAnkiCloze(parsed.clozeNotes, { deck: deckInput.value })
    : toAnkiBasic(parsed.cards, { deck: deckInput.value });
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
    setStatus('warning', `${ext} files can’t be converted. Use a .txt, .md or .csv file, or paste the text.`);
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setStatus('warning', 'That file is larger than 20 MB. Split it into smaller files.');
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
  openFile(event.dataTransfer.files[0], 'drop');
});
window.addEventListener('blur', endDrag);

input.addEventListener('input', scheduleRender);
swapBox.addEventListener('change', render);

exampleButton.addEventListener('click', () => {
  input.value = EXAMPLE;
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

copyPrompt.addEventListener('click', async () => {
  const ok = await copyText(promptText.textContent.trim());
  flash(copyPrompt, ok ? 'Copied' : 'Copy failed');
  if (ok) track('tool_prompt_copied');
});

downloadAnki.addEventListener('click', () => {
  if (!parsed.cards.length) return;
  const suffix = parsed.mode === 'cloze' ? '-anki-cloze.txt' : '-anki.txt';
  download(ankiFile(), `${fileSlug(deckInput.value || 'ai-flashcards')}${suffix}`, 'text/plain;charset=utf-8');
  track('tool_downloaded', { format: 'anki_txt', question_count: parsed.cards.length });
});

downloadCsv.addEventListener('click', () => {
  if (!parsed.cards.length) return;
  download(`﻿${toCsvCards(parsed.cards)}`, `${fileSlug(deckInput.value || 'ai-flashcards')}.csv`, 'text/csv;charset=utf-8');
  track('tool_downloaded', { format: 'csv', question_count: parsed.cards.length });
});

copyAnki.addEventListener('click', async () => {
  if (!parsed.cards.length) return;
  const ok = await copyText(ankiFile());
  flash(copyAnki, ok ? 'Copied' : 'Copy failed');
  track('tool_downloaded', { format: 'copy', question_count: parsed.cards.length });
});

studyLink.addEventListener('click', async (event) => {
  if (!parsed.cards.length) return;
  event.preventDefault();
  const paste = toHandoffText(parsed.cards);
  // Preferred: hand the cards straight to the app in this tab. Fallback: clipboard.
  const handedOff = storeHandoff(paste, TOOL);
  if (!handedOff) await copyText(paste);
  // Wait for GA to take the event (max 350 ms) so this funnel step isn't lost on navigation.
  trackThenNavigate('tool_study_clicked', TOOL, { method: handedOff ? 'handoff' : 'clipboard', question_count: parsed.cards.length }, studyLink.href);
});

document.documentElement.classList.add('js');
trackToolView(TOOL);
render();
