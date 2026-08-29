# samme3le

**samme3le** means “recite to me.” It turns structured questions and answers into a spoken study session.

The current prototype is a static, client-side web app. The core app is free and does not require payment information or a paid AI API. A future optional Pro subscription is planned for production account features.

## Fast paths

A new user can now:

1. Try the built-in sample deck.
2. Paste Q&A from ChatGPT, Claude, Gemini, a spreadsheet, or their own notes.
3. Import a local Excel, Anki, CSV, TSV, or TXT file without signing up.
4. Use the existing Google Sheet workflow when a remotely updated sheet is useful.
5. Choose **Answer out loud**, **Listen and review**, or **Lock-screen review**.

All of these sources terminate at Deck Contract v1 and use the same existing study engine.

## Paste questions

Direct paste is the fastest path for Q&A generated with a user's own AI subscription. It does not require a public Google Sheet, file upload, account, LLM call, or samme3le API key.

Supported examples include:

```text
Q: What hormone lowers blood sugar?
A: Insulin
ALT: insulin hormone | human insulin
```

```text
What is ATP? | Adenosine triphosphate
What is DNA? | Deoxyribonucleic acid
```

Two-column rows copied from a spreadsheet and common Markdown tables are also accepted. `paste-data.js` performs deterministic browser-local parsing and rejects ambiguous prose rather than inventing cards.

## Local file import

The zero-signup local importer accepts:

- Excel `.xlsx`
- Anki deck `.apkg`
- `.csv`
- `.tsv`
- `.txt`, including structured Q&A and Anki plain-text exports

The file is read by JavaScript in the browser and is not intentionally uploaded to a samme3le application server. Excel parsing uses the workbook ZIP/XML structure locally. CSV/TSV/TXT use the existing deterministic row and paste parsers.

### Anki compatibility

`.apkg` packages are opened locally. samme3le extracts the embedded collection, reads note fields, and converts basic front/back notes plus cloze notes into ordinary Deck Contract cards.

The importer intentionally does **not** reproduce Anki scheduling, review history, card-template rendering, reversed-card template logic, images, or audio. For basic notes, the first populated field is treated as the prompt and the next populated field as the answer. For cloze notes, the hidden term is used as the answer.

Legacy `.apkg` collections are read directly from SQLite. Modern Anki packages that contain a zstd-compressed collection first try the browser's native decompressor; when unavailable, samme3le may load the pinned MIT-licensed `fzstd@0.1.1` browser decoder and still performs the actual deck decompression locally. If that decoder is unavailable, the app instructs the user to re-export from Anki with **Support older Anki versions** enabled.

Whole-collection `.colpkg` import is not part of this version.

## Study modes

### Answer out loud

samme3le reads the question, the browser listens to the spoken answer, and a local matcher compares the transcript with the stored answer and accepted alternatives. The user can retry or override recognition errors. In supported browsers, Screen Wake Lock can keep the display awake during the session.

### Listen and review

samme3le reads the question, waits for a configurable interval, reads the saved answer, and advances.

### Lock-screen review

An experimental continuous spoken track reads the remaining questions and answers without using the microphone or grading. Background playback depends on the browser and operating system.

The answer checker is a prototype heuristic, not a validated grading system.

## Deck Contract v1

Every ingestion method terminates at the same canonical deck boundary:

```text
Built-in deck ──────────┐
Paste Q&A ──────────────┤
Excel .xlsx ────────────┤
Anki .apkg ─────────────┤
CSV / TSV / TXT ────────┼→ Deck Contract v1 → existing spoken study engine
Google Sheet ───────────┘
```

`deck.js` provides `normalizeDeck()`, `validateDeck()`, and the strict `loadDeck()` entry point. This keeps file parsing separate from speech synthesis, speech recognition, grading, session controls, wake lock, lock-screen review, and progress behavior.

See `docs/DECK_CONTRACT_V1.md` and regression tests under `test/`.

## Question-list format

The minimum deck needs only Question + Answer. Accepted alternatives are optional.

| Question | Answer | Accepted alternatives |
| --- | --- | --- |
| What is the mechanism of infliximab? | It inhibits TNF-alpha. | anti-TNF monoclonal antibody\|TNF inhibitor |

For row-based files, samme3le detects common headers and exposes the existing mapping controls only when the user needs to correct the guessed fields.

## SEO and use-case pages

The repository includes crawlable static pages for `/voice-flashcards/`, `/quiz-me-from-my-notes/`, `/google-sheets-flashcards/`, `/active-recall-out-loud/`, `/medical-students/`, and `/pricing/`, plus `sitemap.xml` and `robots.txt`.

The current canonicals use `https://tutor.gi-jad.com`. After the permanent domain is purchased, run:

```bash
npm run set-domain -- https://samme3le.com
```

Then configure DNS, HTTPS, URL-matched permanent redirects, Search Console, Bing Webmaster Tools, and submit the new sitemap.

## Legal and account preparation

Pre-launch legal drafts live under `/terms/`, `/privacy/`, `/acceptable-use/`, `/medical-disclaimer/`, `/billing-and-cancellation/`, `/accessibility/`, and `/contact/`. They remain `noindex` until unresolved operator, address, support, pricing, refund, and counsel-review fields are completed.

## Accounts and My decks

Studying does not require an account. Optional passwordless email sign-in is for persistence:

1. Load a public Google Sheet as before.
2. If you want it on another phone or computer, sign in and choose **Save to my account**.
3. Later, open **My decks**, choose the saved sheet, and continue into the same oral study engine.

Account Sync v1 stores only authentication information and Google Sheet identifiers in Supabase. Excel, Anki, CSV, TSV, TXT, and pasted decks remain browser-local.

The current production hostname is `https://tutor.gi-jad.com`. Authentication redirects must keep using that host until the permanent domain cutover.

The proposed account schema is in `supabase/migrations/202608010001_initial_accounts.sql`. Saved Google Sheet references are in `supabase/migrations/202608270001_saved_sources.sql`. The oral study engine and local-file parsing do not require an account.

## Use a Google Sheet

Google Sheets remain an optional advanced path:

1. Open the sheet and choose **Share**.
2. Under **General access**, choose **Anyone with the link** and **Viewer**.
3. Copy the URL.
4. Paste it into samme3le and select **Load sheet**.

For private material, prefer the local file importer. Do not enter protected health information, patient records, confidential examination content, or commercial question-bank content without authorization.

## Run and validate locally

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173` in a current browser.

Run the complete validation suite:

```bash
npm run check
```

A GitHub Actions workflow also runs the same check on pull requests and pushes to `main`.

## Privacy and limitations

- Pasted Q&A and local `.xlsx`, `.apkg`, `.csv`, `.tsv`, and `.txt` files are processed client-side in Account Sync v1.
- If you sign in, Supabase stores authentication information and saved Google Sheet identifiers. Raw Sheet URLs and question text are not stored.
- Browser speech recognition may use a browser, operating-system, or speech-service provider. samme3le does not intentionally store spoken answers, audio, or transcripts.
- Google Sheet loading requires link-accessible data.
- Modern Anki zstd fallback may download decoder code from a third-party CDN; the importer does not intentionally send the deck bytes to that CDN.
- The tool is educational and is not for patient care.
- No paid subscription is active today.

## License

No open-source license has been granted for samme3le at this stage. Standard copyright applies. Third-party components retain their own licenses.
