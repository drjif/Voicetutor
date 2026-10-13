// One-tap "Study this deck out loud" for same3le's audience landing pages.
//
// Each page carries its free starter deck as plain Q:/A: text in <script type="text/plain"
// id="starterDeck">. A tap stores it with the same handoff the free tools use, then opens the
// app, which loads it through the normal paste path. If session storage is blocked, the deck
// is copied to the clipboard instead and the page says so.

import { storeHandoff } from './handoff.js';
import { trackThenNavigate, trackToolView } from './tool-analytics.js';

const deck = document.getElementById('starterDeck');
const tool = deck?.dataset.tool || 'starter-deck';
const text = (deck?.textContent || '').trim();
const count = (text.match(/^Q: /gm) || []).length;

async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

for (const link of document.querySelectorAll('[data-study-deck]')) {
  link.addEventListener('click', async (event) => {
    if (!text) return;
    event.preventDefault();
    const handedOff = storeHandoff(text, tool);
    if (!handedOff) {
      await copy(text);
      document.querySelectorAll('[data-deck-fallback]').forEach((note) => { note.hidden = false; });
    }
    // Give a blocked-storage visitor a moment to read the "copied" note before leaving.
    trackThenNavigate('tool_study_clicked', tool, { method: handedOff ? 'handoff' : 'clipboard', question_count: count }, link.getAttribute('href') || '/', handedOff ? 350 : 1800);
  });
}

if (text) trackToolView(tool);
