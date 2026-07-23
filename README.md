# VoiceTutor

VoiceTutor turns a Google Sheet question bank into a hands-free spoken review session. It is deliberately built as a static, client-only web app: no database, OAuth flow, server, API key, or paid voice service is required for the prototype.

## Live behavior

### Passive Review

1. Reads the current question aloud.
2. Waits for a configurable interval (3 seconds by default).
3. Reads the stored answer.
4. Advances to the next sheet row.

### Active Recall

1. Reads the question aloud.
2. Listens through Chrome/Edge speech recognition.
3. Performs a basic local text match against the stored answer and any accepted alternatives.
4. Says “Correct,” or reads the correct answer.
5. Advances automatically.

Active Recall is a prototype heuristic, not a validated grading system. Put common paraphrases in an `Accepted alternatives` column separated by `|`, `;`, or line breaks.

## Required Google Sheet format

The simplest layout is:

| Question | Answer | Accepted alternatives |
| --- | --- | --- |
| What is the mechanism of infliximab? | It inhibits TNF-alpha. | anti-TNF monoclonal antibody\|TNF inhibitor |

The app automatically detects common header names and lets the user remap columns.

## Use a Google Sheet

1. Open the sheet.
2. Choose **Share**.
3. Under **General access**, choose **Anyone with the link** and **Viewer**.
4. Copy the URL from the browser address bar.
5. Paste it into VoiceTutor and select **Load sheet**.

The URL should include the correct tab `gid`. Only the chosen tab is loaded.

For private or sensitive question banks, export the tab as CSV and use **Upload CSV**. The CSV remains in the browser.

## Controls

- Choose any loaded source row from the **Starting row** dropdown, then select **Start session**.
- **Pause** freezes speech and countdown timers.
- **Resume** continues from the paused point. If Active Recall was listening when paused, the current question is restarted.
- **Repeat**, **Previous**, **Next**, and **Stop** are available during the session.
- Keyboard controls: Space pause/resume, Left/Right move, R repeat, Escape stop.
- The current source row is saved in `localStorage` so a later session can resume from that position.

## Run locally

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173` in current Chrome or Edge.

Run the unit tests:

```bash
npm test
```

## Deploy

The included GitHub Actions workflow runs the unit tests and deploys the static app to GitHub Pages whenever `main` changes.

In the GitHub repository, open **Settings → Pages** and set **Source** to **GitHub Actions** if it is not already selected.

## Architecture

```text
Google Sheet / uploaded CSV
          ↓
Browser CSV parser
          ↓
Question-bank state machine
          ↓
Web Speech synthesis + recognition
          ↓
Local answer matcher
```

There is intentionally no backend in this version. A future semantic-grading service can replace the local matcher without changing the sheet-loading or playback state machine.

## Privacy and limitations

- VoiceTutor does not send sheet data to an application server because there is no application server.
- Browser speech recognition may use the browser vendor's speech service; behavior varies by browser and operating system.
- Google Sheet direct loading requires link-accessible data. Do not use this method for confidential information.
- Use current Chrome or Edge for the best Active Recall support.

## License

No open-source license has been granted at this stage. Standard copyright applies.
