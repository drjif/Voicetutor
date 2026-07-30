# samme3le

**samme3le** means “recite to me.” It turns a Google Sheet or CSV list of questions and answers into a spoken study session.

The prototype is a static, client-side web app. It does not require a database, OAuth flow, server, API key, or paid voice service.

## What the user does

1. Tries five built-in demo questions without signing up.
2. Unlocks prototype access on the current device.
3. Adds a Google Sheet or uploads a CSV containing questions and answers.
4. Chooses **Answer out loud** or **Listen and review**.
5. Starts the study session.

## Study modes

### Answer out loud

1. samme3le reads the question.
2. The browser listens to the spoken answer.
3. A local text matcher compares the transcript with the saved answer and accepted alternatives.
4. samme3le marks the answer correct, partial, or unmatched and allows the user to correct recognition mistakes.
5. The next question begins automatically.

### Listen and review

1. samme3le reads the question.
2. It waits for a configurable amount of time.
3. It reads the saved answer.
4. It advances to the next question.

The answer checker is a prototype heuristic, not a validated grading system. Put common paraphrases in an `Accepted alternatives` column separated by `|`, `;`, or line breaks.

## Question-list format

The simplest format is:

| Question | Answer | Accepted alternatives |
| --- | --- | --- |
| What is the mechanism of infliximab? | It inhibits TNF-alpha. | anti-TNF monoclonal antibody\|TNF inhibitor |

The app detects common header names and allows the user to remap columns.

## Use a Google Sheet

1. Open the sheet.
2. Choose **Share**.
3. Under **General access**, choose **Anyone with the link** and **Viewer**.
4. Copy the URL from the browser address bar.
5. Paste it into samme3le and select **Load sheet**.

The URL should include the correct tab `gid`. Only the selected tab is loaded.

For private or sensitive material, export the tab as CSV and use **Upload CSV**. CSV content remains in the browser.

## Controls

- Choose a loaded question from the **Start at** dropdown, then select **Start quizzing me**.
- **Pause** freezes speech and countdown timers.
- **Resume** continues from the paused point. If Answer out loud was listening when paused, the current question restarts.
- **Repeat**, **Previous**, **Next**, and **Stop** are available during a session.
- Keyboard controls: Space pause/resume, Left/Right move, Alt+R repeat, Alt+T retry, Alt+M mark correct, and Escape stop.
- The current source row is saved in `localStorage` so a later session can resume.

## Run locally

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173` in a current browser.

Run the unit tests:

```bash
npm test
```

## Deploy

The GitHub Actions workflow runs unit tests and deploys the static application to GitHub Pages whenever `main` changes.

In the GitHub repository, open **Settings → Pages** and set **Source** to **GitHub Actions** if it is not already selected.

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
```

There is intentionally no production backend in this version. A future account and analytics layer can be added without changing the core study flow.

## Privacy and limitations

- samme3le does not send uploaded CSV content to an application server because this prototype has no application server.
- Browser speech recognition may use the browser vendor’s speech service; behavior varies by browser and operating system.
- Google Sheet loading requires link-accessible data. Do not use it for confidential information.
- Do not enter protected health information, patient records, confidential examination content, or commercial question-bank content without authorization.
- The tool is educational and is not for patient care.

## License

No open-source license has been granted at this stage. Standard copyright applies.