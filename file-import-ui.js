function setText(selector, text) {
  const element = document.querySelector(selector);
  if (element) element.textContent = text;
}

function updateExistingCopy() {
  const pathButton = document.querySelector('[data-study-path-import]');
  const pathCard = pathButton?.closest('.study-path-card');
  const pathText = pathCard?.querySelector('p');
  if (pathText) {
    pathText.textContent = 'Bring Excel, Anki, CSV, TSV, or TXT files directly from your device. Google Sheets still work without an account.';
  }
  if (pathButton) {
    pathButton.textContent = 'Import a deck or file';
    pathButton.setAttribute('href', '#local-file-import');
  }

  setText('.import-panel .option-kicker', 'Optional link import');
  setText('.import-panel h3', 'Google Sheet or CSV');
}

function moveMappingOutsideGate(panel) {
  const mapping = document.querySelector('#mappingPanel');
  const hasHeaders = document.querySelector('#hasHeaders')?.closest('.checkbox-row');
  if ((!mapping && !hasHeaders) || document.querySelector('#localMappingHost')) return;

  const host = document.createElement('div');
  host.id = 'localMappingHost';
  host.className = 'local-mapping-host';
  host.hidden = true;
  host.innerHTML = '<div class="mapping-helper"><strong>Check the import</strong><span>samme3le guesses the question and answer fields. Change them only if needed.</span></div>';

  if (hasHeaders) host.append(hasHeaders);
  if (mapping) host.append(mapping);
  panel.insertAdjacentElement('afterend', host);
}

function updateFooter() {
  const footerParagraphs = document.querySelectorAll('footer > p');
  const privacyLine = footerParagraphs[1];
  if (privacyLine) {
    privacyLine.textContent = 'Pasted questions and local Excel, Anki, CSV, TSV, and TXT files are processed in your browser. If you sign in, Supabase stores authentication information and saved Google Sheet identifiers. samme3le does not intentionally store spoken answers, audio, or transcripts. This version has no payment system.';
  }
}

export function setupFileImportUI() {
  if (document.querySelector('#local-file-import')) return;
  const advancedHeading = document.querySelector('.advanced-import-heading');
  if (!advancedHeading) return;

  const panel = document.createElement('article');
  panel.id = 'local-file-import';
  panel.className = 'setup-panel local-file-panel';
  panel.setAttribute('aria-labelledby', 'local-file-heading');
  panel.innerHTML = `
    <div class="local-file-heading">
      <div>
        <span class="option-kicker">No signup · processed locally</span>
        <h3 id="local-file-heading">Import a deck or file</h3>
        <p class="panel-copy">Choose the file you already study from. samme3le reads it in your browser and sends the questions into the same oral study engine.</p>
      </div>
      <span class="free-pill">Free</span>
    </div>

    <div class="file-format-list" aria-label="Supported file types">
      <span>Excel .xlsx</span>
      <span>Anki .apkg</span>
      <span>CSV</span>
      <span>TSV</span>
      <span>TXT</span>
    </div>

    <div class="local-file-actions">
      <label class="button primary large-button file-button">
        Choose a file
        <input id="studyFileUpload" type="file" accept=".xlsx,.apkg,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values,text/plain" hidden />
      </label>
      <span id="selectedFileName" class="selected-file-name">No file selected.</span>
    </div>

    <div id="localFileStatus" class="inline-status" data-type="neutral" aria-live="polite">Your local file is not intentionally uploaded to a samme3le server.</div>
    <p class="helper"><strong>Anki:</strong> basic front/back notes and cloze notes are converted to oral-study cards. Anki scheduling, review history, card templates, images, and audio are not reproduced.</p>
    <p class="helper safety-note"><strong>Do not import patient information, private records, or paid question-bank content you do not have permission to use.</strong></p>
  `;

  advancedHeading.insertAdjacentElement('beforebegin', panel);
  advancedHeading.id = 'google-sheet-import';
  advancedHeading.querySelector('span').textContent = 'Or connect a Google Sheet';
  advancedHeading.querySelector('p').textContent = 'Google Sheets work without an account. Sign in only if you want the same sheet waiting under My decks on another device.';

  moveMappingOutsideGate(panel);
  updateExistingCopy();
  updateFooter();
}
