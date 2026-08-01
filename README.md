# samme3le

**samme3le** means “recite to me.” It turns a Google Sheet or CSV list of questions and answers into a spoken study session.

The current prototype is a static, client-side web app. The core app is free and does not require payment information. A future optional Pro subscription is planned for production account features.

## What the user does

1. Tries five built-in demo questions without signing up.
2. Unlocks prototype access on the current device.
3. Adds a Google Sheet or uploads a CSV containing questions and answers.
4. Chooses **Answer out loud**, **Listen and review**, or **Lock-screen review**.
5. Starts the study session.

## Study modes

### Answer out loud

samme3le reads the question, the browser listens to the spoken answer, and a local matcher compares the transcript with the stored answer and accepted alternatives. The user can retry or override recognition errors. In supported browsers, Screen Wake Lock can keep the display awake during the session.

### Listen and review

samme3le reads the question, waits for a configurable interval, reads the saved answer, and advances.

### Lock-screen review

An experimental continuous spoken track reads the remaining questions and answers without using the microphone or grading. Background playback depends on the browser and operating system.

The answer checker is a prototype heuristic, not a validated grading system. Put common paraphrases in an `Accepted alternatives` column separated by `|`, `;`, or line breaks.

## Question-list format

| Question | Answer | Accepted alternatives |
| --- | --- | --- |
| What is the mechanism of infliximab? | It inhibits TNF-alpha. | anti-TNF monoclonal antibody\|TNF inhibitor |

The app detects common header names and allows the user to remap columns.

## SEO and use-case pages

The repository includes crawlable static pages for:

- `/voice-flashcards/`
- `/quiz-me-from-my-notes/`
- `/google-sheets-flashcards/`
- `/active-recall-out-loud/`
- `/medical-students/`
- `/pricing/`

Technical discovery files:

- `sitemap.xml`
- `robots.txt`
- `marketing.css`
- `scripts/check-site.mjs`

The current canonicals use `https://tutor.gi-jad.com`. After the permanent domain is purchased, run:

```bash
npm run set-domain -- https://samme3le.com
```

Then configure DNS, HTTPS, URL-matched permanent redirects, Search Console, Bing Webmaster Tools, and submit the new sitemap.

## Legal pages

Pre-launch legal drafts are available at:

- `/terms/`
- `/privacy/`
- `/acceptable-use/`
- `/medical-disclaimer/`
- `/billing-and-cancellation/`
- `/accessibility/`
- `/contact/`

They remain `noindex` and explicitly identify unresolved launch fields. Paid checkout must remain disabled until the legal operator, address, governing law, dispute terms, support contacts, pricing, refund rules, and counsel review are complete.

See `docs/PAID_LAUNCH_CHECKLIST.md`.

## Planned Supabase backend

The proposed account schema is in:

`supabase/migrations/202608010001_initial_accounts.sql`

It is designed for Supabase Auth, versioned consent records, marketing preferences, Free/Pro entitlements, minimized usage events, and account-deletion requests. Row Level Security restricts users to their own records; subscription entitlements are server-managed.

Question text, answers, CSV contents, Google Sheet URLs, spoken audio, transcripts, patient information, precise location, and payment-card numbers are not intended for default Supabase storage.

See `docs/SUPABASE_SETUP.md`.

## Use a Google Sheet

1. Open the sheet.
2. Choose **Share**.
3. Under **General access**, choose **Anyone with the link** and **Viewer**.
4. Copy the URL from the browser address bar.
5. Paste it into samme3le and select **Load sheet**.

For private or sensitive material, export the tab as CSV and use **Upload CSV**. Do not enter protected health information, patient records, confidential examination content, or commercial question-bank content without authorization.

## Run locally

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173` in a current browser.

Run the full validation suite:

```bash
npm run check
```

## Architecture

```text
Google Sheet / uploaded CSV
          ↓
Browser CSV parser
          ↓
Question-list state machine
          ↓
Web Speech synthesis + recognition
          ↓
Local answer matcher

Future account layer:
Supabase Auth + Postgres RLS + server-managed subscription entitlement
```

## Privacy and limitations

- CSV content remains client-side in the current prototype.
- Browser speech recognition may use a browser or operating-system speech service.
- Google Sheet loading requires link-accessible data.
- The tool is educational and is not for patient care.
- No paid subscription or production account backend is active today.

## License

No open-source license has been granted at this stage. Standard copyright applies.
