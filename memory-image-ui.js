import { loadSupabaseClient, onAuthChange } from './auth.js';
import { createSavedSourceRepository, reconstructSavedSourceRequest } from './saved-sources.js';
import { parseDelimited } from './sheet-data.js';
import {
  cardFingerprint,
  createMemoryImageRepository,
  prepareMemoryImage,
  resolveMemoryImageCardText,
  reviewImageModel
} from './memory-images.js';

let runtimeState = null;
let initialized = false;
let signedIn = false;
let repositoryPromise = null;
let studyPanel = null;
let studyImage = null;
let studyStatus = null;
let studyAddButton = null;
let studyRemoveButton = null;
let studyFileInput = null;
let studyRefreshToken = 0;
let studyRefreshQueued = false;
let uploadBusy = false;
const studyAssetCache = new Map();

let reviewButton = null;
let reviewSection = null;
let reviewDeckFilter = null;
let reviewAssets = [];
let reviewSources = [];
let reviewIndex = 0;
let reviewQuestionVisible = false;
let reviewAnswerVisible = false;
let reviewRenderToken = 0;
let reviewTextToken = 0;
let reviewOpen = false;
let reviewCurrentText = null;
const reviewRowsCache = new Map();
const reviewTextCache = new Map();

function installStyles() {
  if (document.getElementById('same3le-memory-image-styles')) return;
  const style = document.createElement('style');
  style.id = 'same3le-memory-image-styles';
  style.textContent = `
    .memory-image-panel[hidden], .memory-image-review[hidden],
    .memory-review-card[hidden], .memory-review-empty[hidden],
    .memory-review-copy[hidden] { display: none !important; }
    .memory-image-panel, .memory-image-review {
      display: grid; gap: 14px; border: 1px solid var(--border);
      border-radius: 18px; background: var(--surface);
    }
    .memory-image-panel { margin-top: 14px; padding: 16px; }
    .memory-image-review { gap: 18px; padding: 22px; box-shadow: var(--shadow-sm, 0 10px 30px rgba(17,17,17,.06)); }
    .memory-image-panel-heading, .memory-review-header, .memory-review-meta,
    .memory-image-actions, .memory-review-actions, .memory-review-navigation {
      display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap;
    }
    .memory-image-panel-heading h3, .memory-review-header h2, .memory-review-copy h3 { margin: 0; }
    .memory-image-panel-heading p, .memory-review-header p, .memory-image-status,
    .memory-review-meta, .memory-review-empty p, .memory-review-text-status {
      margin: 0; color: var(--muted);
    }
    .memory-image-safety { font-size: .88rem; }
    .memory-image-figure, .memory-review-figure {
      margin: 0; display: grid; justify-items: center; overflow: hidden;
      border-radius: 16px; border: 1px solid var(--border); background: var(--surface-soft, var(--surface));
    }
    .memory-image-figure[hidden] { display: none !important; }
    .memory-image-figure img, .memory-review-figure img {
      display: block; max-width: 100%; width: auto; height: auto; max-height: 680px;
      object-fit: contain; cursor: zoom-in;
    }
    .memory-image-figure img.is-expanded, .memory-review-figure img.is-expanded { max-height: none; cursor: zoom-out; }
    .memory-image-actions .button, .memory-review-actions .button, .memory-review-navigation .button { min-height: 44px; }
    #reviewImagesButton { width: 100%; justify-content: center; }
    body.same3le-review-images-open #myDecksPanel,
    body.same3le-review-images-open #your-questions { display: none !important; }
    .memory-review-header-copy { display: grid; gap: 4px; }
    .memory-review-filter { display: grid; gap: 6px; max-width: 360px; }
    .memory-review-filter label { font-weight: 650; }
    .memory-review-filter select { width: 100%; }
    .memory-review-card { display: grid; gap: 14px; }
    .memory-review-figure { min-height: 220px; padding: 10px; }
    .memory-review-image-status { margin: 0; color: var(--muted); text-align: center; }
    .memory-review-copy {
      display: grid; gap: 8px; padding: 14px 16px; border: 1px solid var(--border);
      border-radius: 14px; background: var(--surface-soft, var(--surface));
    }
    .memory-review-copy p { margin: 0; white-space: pre-wrap; line-height: 1.55; }
    .memory-review-navigation { display: grid; grid-template-columns: 1fr 1fr; }
    .memory-review-navigation .button { width: 100%; }
    @media (max-width: 640px) {
      .memory-image-panel, .memory-image-review { padding: 14px; }
      .memory-image-actions, .memory-review-actions { display: grid; grid-template-columns: 1fr; }
      .memory-image-actions .button, .memory-review-actions .button { width: 100%; }
      .memory-review-navigation { grid-template-columns: 1fr; }
      .memory-image-figure img, .memory-review-figure img { max-height: 560px; }
    }
  `;
  document.head.append(style);
}

function setStatus(element, message, type = 'neutral') {
  if (!element) return;
  element.textContent = message || '';
  element.dataset.type = type;
  element.hidden = !message;
}

async function repository() {
  if (!signedIn) return null;
  if (!repositoryPromise) {
    repositoryPromise = loadSupabaseClient().then((client) => client ? createMemoryImageRepository(client) : null);
  }
  return repositoryPromise;
}

async function savedSourceRepository() {
  const client = await loadSupabaseClient();
  return client ? createSavedSourceRepository(client) : null;
}

function currentStudyTarget() {
  const savedSourceId = String(runtimeState?.savedSourceId ?? '').trim();
  const card = runtimeState?.questions?.[runtimeState.currentIndex] ?? null;
  const sourceRow = Number(card?.sourceRow);
  if (!savedSourceId || !card || !Number.isInteger(sourceRow) || sourceRow <= 0) return null;
  return {
    savedSourceId,
    sourceRow,
    card: { ...card, question: String(card.question ?? ''), answer: String(card.answer ?? '') }
  };
}

function currentColumnMapping() {
  const questionColumn = Number(document.querySelector('#questionColumn')?.value);
  const answerColumn = Number(document.querySelector('#answerColumn')?.value);
  if (!Number.isInteger(questionColumn) || questionColumn < 0 || !Number.isInteger(answerColumn) || answerColumn < 0 || questionColumn === answerColumn) {
    return null;
  }
  return { questionColumn, answerColumn };
}

function ensureStudyPanel() {
  if (studyPanel) return true;
  const answerCard = document.querySelector('#answerCard');
  if (!answerCard) return false;
  studyPanel = document.createElement('section');
  studyPanel.id = 'memoryImagePanel';
  studyPanel.className = 'memory-image-panel';
  studyPanel.hidden = true;
  studyPanel.setAttribute('aria-labelledby', 'memoryImageHeading');
  studyPanel.innerHTML = `
    <div class="memory-image-panel-heading"><div>
      <h3 id="memoryImageHeading">Memory image</h3>
      <p>Your private visual cue for this answer.</p>
    </div></div>
    <figure id="memoryImageFigure" class="memory-image-figure" hidden>
      <img id="memoryImagePreview" alt="" decoding="async" />
    </figure>
    <p id="memoryImageStatus" class="memory-image-status" aria-live="polite"></p>
    <div class="memory-image-actions">
      <button id="memoryImageAddButton" class="button secondary" type="button">Add memory image</button>
      <button id="memoryImageRemoveButton" class="button ghost" type="button" hidden>Remove image</button>
    </div>
    <p class="memory-image-status memory-image-safety">Images are stored privately after on-device optimization. Do not upload patient data, identifiable clinical images, or confidential material.</p>
    <input id="memoryImageFileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden />
  `;
  answerCard.insertAdjacentElement('afterend', studyPanel);
  studyImage = studyPanel.querySelector('#memoryImagePreview');
  studyStatus = studyPanel.querySelector('#memoryImageStatus');
  studyAddButton = studyPanel.querySelector('#memoryImageAddButton');
  studyRemoveButton = studyPanel.querySelector('#memoryImageRemoveButton');
  studyFileInput = studyPanel.querySelector('#memoryImageFileInput');
  studyAddButton.addEventListener('click', () => { if (!uploadBusy) studyFileInput.click(); });
  studyFileInput.addEventListener('change', handleStudyImageSelection);
  studyRemoveButton.addEventListener('click', removeCurrentStudyImage);
  studyImage.addEventListener('click', () => studyImage.classList.toggle('is-expanded'));
  return true;
}

function clearStudyPreview() {
  const figure = studyPanel?.querySelector('#memoryImageFigure');
  if (figure) figure.hidden = true;
  if (studyImage) {
    studyImage.removeAttribute('src');
    studyImage.alt = '';
    studyImage.classList.remove('is-expanded');
  }
  if (studyRemoveButton) studyRemoveButton.hidden = true;
  if (studyAddButton) studyAddButton.textContent = 'Add memory image';
}

function renderStudyPreview(asset, url, target) {
  const figure = studyPanel.querySelector('#memoryImageFigure');
  if (!asset || !url) return clearStudyPreview();
  studyImage.src = url;
  studyImage.alt = `Memory image for ${target.card.question.slice(0, 140)}`;
  studyImage.classList.remove('is-expanded');
  figure.hidden = false;
  studyRemoveButton.hidden = false;
  studyAddButton.textContent = 'Replace image';
}

async function studyCacheKey(target) {
  return `${target.savedSourceId}:${target.sourceRow}:${await cardFingerprint(target.card)}`;
}

async function refreshStudyPanel() {
  studyRefreshQueued = false;
  if (!ensureStudyPanel()) return;
  const answerCard = document.querySelector('#answerCard');
  const target = currentStudyTarget();
  const eligible = Boolean(signedIn && target && answerCard && !answerCard.hidden);
  studyPanel.hidden = !eligible;
  if (!eligible) {
    studyRefreshToken += 1;
    clearStudyPreview();
    setStatus(studyStatus, '');
    return;
  }
  const token = ++studyRefreshToken;
  setStatus(studyStatus, 'Checking for your memory image…', 'loading');
  clearStudyPreview();
  try {
    const key = await studyCacheKey(target);
    if (token !== studyRefreshToken) return;
    let cached = studyAssetCache.get(key);
    if (cached === undefined) {
      const repo = await repository();
      if (!repo) throw new Error('Memory images are temporarily unavailable.');
      cached = await repo.getForCard(target.savedSourceId, target.card);
      studyAssetCache.set(key, cached);
    }
    if (token !== studyRefreshToken) return;
    const asset = cached?.asset ?? null;
    if (!asset) {
      setStatus(studyStatus,
        cached?.stale ? 'This question changed since the prior image was attached. Add a new image for the current version.' : 'Attach a screenshot, diagram, or other visual cue.',
        cached?.stale ? 'warning' : 'neutral');
      return;
    }
    const repo = await repository();
    const url = await repo.signedUrl(asset);
    if (token !== studyRefreshToken) return;
    renderStudyPreview(asset, url, target);
    setStatus(studyStatus, '');
  } catch (error) {
    if (token !== studyRefreshToken) return;
    console.warn('Memory image could not be loaded', error);
    clearStudyPreview();
    setStatus(studyStatus, 'Memory images are unavailable right now. Your study session is unaffected.', 'warning');
  }
}

function scheduleStudyRefresh() {
  if (studyRefreshQueued) return;
  studyRefreshQueued = true;
  queueMicrotask(refreshStudyPanel);
}

function setUploadBusy(nextBusy) {
  uploadBusy = Boolean(nextBusy);
  if (studyAddButton) studyAddButton.disabled = uploadBusy;
  if (studyRemoveButton) studyRemoveButton.disabled = uploadBusy;
}

async function handleStudyImageSelection() {
  const [file] = studyFileInput.files ?? [];
  studyFileInput.value = '';
  if (!file) return;
  const target = currentStudyTarget();
  const mapping = currentColumnMapping();
  if (!target || !signedIn) {
    setStatus(studyStatus, 'Open a saved deck while signed in before adding a memory image.', 'warning');
    return;
  }
  if (!mapping) {
    setStatus(studyStatus, 'Question/answer column mapping is unavailable. Reopen the saved deck and try again.', 'warning');
    return;
  }
  setUploadBusy(true);
  setStatus(studyStatus, 'Optimizing the screenshot on this device…', 'loading');
  try {
    const prepared = await prepareMemoryImage(file);
    setStatus(studyStatus, 'Saving your private memory image…', 'loading');
    const repo = await repository();
    if (!repo) throw new Error('Memory images are temporarily unavailable.');
    const asset = await repo.attach(target.savedSourceId, target.card, prepared, mapping);
    const key = await studyCacheKey(target);
    studyAssetCache.set(key, { asset, stale: false });
    reviewTextCache.delete(asset.id);
    if (currentStudyTarget()?.savedSourceId === target.savedSourceId && currentStudyTarget()?.sourceRow === target.sourceRow) {
      renderStudyPreview(asset, await repo.signedUrl(asset), target);
      setStatus(studyStatus, `Memory image added (${Math.round(asset.byte_size / 1024)} KB).`, 'success');
    }
    await refreshReviewAssets({ preservePosition: true });
  } catch (error) {
    console.warn('Memory image upload failed', error);
    setStatus(studyStatus, error?.message || 'The memory image could not be saved.', 'error');
  } finally {
    setUploadBusy(false);
  }
}

async function removeCurrentStudyImage() {
  const target = currentStudyTarget();
  if (!target || uploadBusy || !window.confirm('Remove this memory image from the question?')) return;
  setUploadBusy(true);
  setStatus(studyStatus, 'Removing memory image…', 'loading');
  try {
    const repo = await repository();
    if (!repo) throw new Error('Memory images are temporarily unavailable.');
    await repo.remove(target.savedSourceId, target.sourceRow);
    studyAssetCache.set(await studyCacheKey(target), { asset: null, stale: false });
    clearStudyPreview();
    setStatus(studyStatus, 'Memory image removed.', 'success');
    await refreshReviewAssets({ preservePosition: true });
  } catch (error) {
    console.warn('Memory image removal failed', error);
    setStatus(studyStatus, 'The memory image could not be removed.', 'error');
  } finally {
    setUploadBusy(false);
  }
}

function ensureReviewUI() {
  if (reviewSection && reviewButton) return true;
  const sidebar = document.querySelector('.library-sidebar');
  const libraryMain = document.querySelector('#libraryMain');
  const createDeckButton = document.querySelector('#createDeckButton');
  if (!sidebar || !libraryMain || !createDeckButton) return false;
  reviewButton = document.createElement('button');
  reviewButton.id = 'reviewImagesButton';
  reviewButton.className = 'button secondary';
  reviewButton.type = 'button';
  reviewButton.textContent = 'Review images';
  reviewButton.hidden = !signedIn;
  sidebar.insertBefore(reviewButton, createDeckButton);
  reviewButton.addEventListener('click', openReviewImages);

  reviewSection = document.createElement('section');
  reviewSection.id = 'memoryImageReview';
  reviewSection.className = 'memory-image-review';
  reviewSection.hidden = true;
  reviewSection.setAttribute('aria-labelledby', 'memoryImageReviewHeading');
  reviewSection.innerHTML = `
    <div class="memory-review-header">
      <div class="memory-review-header-copy"><p class="eyebrow">Visual recall</p><h2 id="memoryImageReviewHeading">Review images</h2>
        <p>Start with the visual cue. The source question and answer are fetched only when you reveal them.</p></div>
      <button id="memoryReviewBackButton" class="button secondary" type="button">Back to My decks</button>
    </div>
    <div class="memory-review-filter"><label for="memoryReviewDeckFilter">Deck</label><select id="memoryReviewDeckFilter"><option value="">All decks</option></select></div>
    <div id="memoryReviewEmpty" class="memory-review-empty" hidden><h3>No memory images yet</h3><p>Open a saved deck, reveal an answer, and attach an image. It will automatically appear here.</p></div>
    <article id="memoryReviewCard" class="memory-review-card" hidden>
      <div class="memory-review-meta"><span id="memoryReviewCounter"></span><span id="memoryReviewDeckName"></span></div>
      <figure class="memory-review-figure"><img id="memoryReviewImage" alt="Memory image" decoding="async" /><p id="memoryReviewImageStatus" class="memory-review-image-status" aria-live="polite"></p></figure>
      <div class="memory-review-actions">
        <button id="memoryReviewQuestionButton" class="button secondary" type="button">Show question</button>
        <button id="memoryReviewAnswerButton" class="button secondary" type="button">Show answer</button>
        <button id="memoryReviewRemoveButton" class="button ghost" type="button">Remove image</button>
      </div>
      <p id="memoryReviewTextStatus" class="memory-review-text-status" aria-live="polite"></p>
      <section id="memoryReviewQuestion" class="memory-review-copy" hidden><h3>Question</h3><p></p></section>
      <section id="memoryReviewAnswer" class="memory-review-copy" hidden><h3>Answer</h3><p></p></section>
      <nav class="memory-review-navigation" aria-label="Memory image navigation">
        <button id="memoryReviewPreviousButton" class="button secondary" type="button">Previous</button>
        <button id="memoryReviewNextButton" class="button primary" type="button">Next</button>
      </nav>
    </article>
  `;
  libraryMain.prepend(reviewSection);
  reviewDeckFilter = reviewSection.querySelector('#memoryReviewDeckFilter');
  reviewSection.querySelector('#memoryReviewBackButton').addEventListener('click', closeReviewImages);
  reviewDeckFilter.addEventListener('change', () => { reviewIndex = 0; resetReviewReveal(); renderReviewCard(); });
  reviewSection.querySelector('#memoryReviewQuestionButton').addEventListener('click', () => toggleReviewText('question'));
  reviewSection.querySelector('#memoryReviewAnswerButton').addEventListener('click', () => toggleReviewText('answer'));
  reviewSection.querySelector('#memoryReviewPreviousButton').addEventListener('click', () => {
    if (reviewIndex <= 0) return;
    reviewIndex -= 1; resetReviewReveal(); renderReviewCard();
  });
  reviewSection.querySelector('#memoryReviewNextButton').addEventListener('click', () => {
    if (!currentReviewModel().canNext) return;
    reviewIndex += 1; resetReviewReveal(); renderReviewCard();
  });
  reviewSection.querySelector('#memoryReviewRemoveButton').addEventListener('click', removeCurrentReviewImage);
  reviewSection.querySelector('#memoryReviewImage').addEventListener('click', (event) => event.currentTarget.classList.toggle('is-expanded'));
  return true;
}

function deckName(savedSourceId) {
  return reviewSources.find((source) => source.id === savedSourceId)?.display_name || 'Saved deck';
}

function populateReviewDeckFilter() {
  if (!reviewDeckFilter) return;
  const previous = reviewDeckFilter.value;
  const sourceIds = [...new Set(reviewAssets.map((asset) => asset.saved_source_id))];
  const options = sourceIds.map((id) => ({ id, name: deckName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  reviewDeckFilter.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = `All decks (${reviewAssets.length})`;
  reviewDeckFilter.append(all);
  for (const item of options) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.name} (${reviewAssets.filter((asset) => asset.saved_source_id === item.id).length})`;
    reviewDeckFilter.append(option);
  }
  reviewDeckFilter.value = sourceIds.includes(previous) ? previous : '';
}

function currentReviewModel() {
  return reviewImageModel({
    assets: reviewAssets,
    savedSourceId: reviewDeckFilter?.value || '',
    index: reviewIndex,
    revealQuestion: reviewQuestionVisible,
    revealAnswer: reviewAnswerVisible
  });
}

function resetReviewReveal() {
  reviewQuestionVisible = false;
  reviewAnswerVisible = false;
  reviewCurrentText = null;
  reviewTextToken += 1;
  if (!reviewSection) return;
  reviewSection.querySelector('#memoryReviewQuestion').hidden = true;
  reviewSection.querySelector('#memoryReviewAnswer').hidden = true;
  reviewSection.querySelector('#memoryReviewQuestion p').textContent = '';
  reviewSection.querySelector('#memoryReviewAnswer p').textContent = '';
  reviewSection.querySelector('#memoryReviewQuestionButton').textContent = 'Show question';
  reviewSection.querySelector('#memoryReviewAnswerButton').textContent = 'Show answer';
  setStatus(reviewSection.querySelector('#memoryReviewTextStatus'), '');
}

async function fetchReviewSourceRows(savedSourceId) {
  const sourceId = String(savedSourceId ?? '').trim();
  if (!sourceId) throw new Error('The saved deck reference is missing.');
  if (reviewRowsCache.has(sourceId)) return reviewRowsCache.get(sourceId);
  const promise = (async () => {
    const source = reviewSources.find((item) => item.id === sourceId);
    if (!source) throw new Error('The saved deck is no longer available.');
    const request = reconstructSavedSourceRequest(source);
    const candidates = [...new Set([request.exportCsvUrl, request.csvUrl].filter(Boolean))];
    let lastError = null;
    for (const candidate of candidates) {
      try {
        const url = new URL(candidate);
        url.searchParams.set('_', String(Date.now()));
        const response = await fetch(url, { cache: 'no-store', redirect: 'follow' });
        if (!response.ok) throw new Error(`Google returned HTTP ${response.status}`);
        const text = await response.text();
        if (/<!doctype html|<html/i.test(text)) throw new Error('The sheet returned HTML instead of CSV data.');
        const rows = parseDelimited(text);
        if (!rows.length) throw new Error('The sheet is empty.');
        return rows;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('The source sheet could not be read.');
  })();
  reviewRowsCache.set(sourceId, promise);
  try {
    return await promise;
  } catch (error) {
    reviewRowsCache.delete(sourceId);
    throw error;
  }
}

async function loadReviewText(asset) {
  const key = `${asset.id}:${asset.question_hash}`;
  if (!reviewTextCache.has(key)) {
    reviewTextCache.set(key, (async () => {
      const rows = await fetchReviewSourceRows(asset.saved_source_id);
      return resolveMemoryImageCardText(asset, rows);
    })());
  }
  try {
    return await reviewTextCache.get(key);
  } catch (error) {
    reviewTextCache.delete(key);
    throw error;
  }
}

function renderReviewRevealState() {
  if (!reviewSection) return;
  const questionPanel = reviewSection.querySelector('#memoryReviewQuestion');
  const answerPanel = reviewSection.querySelector('#memoryReviewAnswer');
  const questionButton = reviewSection.querySelector('#memoryReviewQuestionButton');
  const answerButton = reviewSection.querySelector('#memoryReviewAnswerButton');
  questionPanel.hidden = !reviewQuestionVisible;
  answerPanel.hidden = !reviewAnswerVisible;
  questionButton.textContent = reviewQuestionVisible ? 'Hide question' : 'Show question';
  answerButton.textContent = reviewAnswerVisible ? 'Hide answer' : 'Show answer';
  if (reviewCurrentText?.matches) {
    questionPanel.querySelector('p').textContent = reviewCurrentText.question;
    answerPanel.querySelector('p').textContent = reviewCurrentText.answer;
  }
}

async function toggleReviewText(kind) {
  if (kind === 'question') reviewQuestionVisible = !reviewQuestionVisible;
  else reviewAnswerVisible = !reviewAnswerVisible;
  renderReviewRevealState();
  const needsText = reviewQuestionVisible || reviewAnswerVisible;
  if (!needsText || reviewCurrentText?.matches) return;
  const asset = currentReviewModel().current;
  if (!asset) return;
  const token = ++reviewTextToken;
  const status = reviewSection.querySelector('#memoryReviewTextStatus');
  setStatus(status, 'Loading the current source row…', 'loading');
  try {
    const resolved = await loadReviewText(asset);
    if (token !== reviewTextToken || currentReviewModel().current?.id !== asset.id) return;
    reviewCurrentText = resolved;
    if (!resolved.matches) {
      setStatus(status,
        resolved.missing ? 'That source row no longer contains the original question and answer.' : 'That source row changed since this image was attached. Reattach the image from the current question to relink it.',
        'warning');
      return;
    }
    setStatus(status, '');
    renderReviewRevealState();
  } catch (error) {
    if (token !== reviewTextToken) return;
    console.warn('Review source text could not be loaded', error);
    setStatus(status, 'The image is available, but the source Sheet could not be read right now.', 'warning');
  }
}

async function renderReviewCard() {
  if (!ensureReviewUI()) return;
  const token = ++reviewRenderToken;
  const model = currentReviewModel();
  reviewIndex = model.index;
  const empty = reviewSection.querySelector('#memoryReviewEmpty');
  const card = reviewSection.querySelector('#memoryReviewCard');
  empty.hidden = model.total > 0;
  card.hidden = model.total === 0;
  if (!model.current) return;
  const image = reviewSection.querySelector('#memoryReviewImage');
  const imageStatus = reviewSection.querySelector('#memoryReviewImageStatus');
  image.removeAttribute('src');
  image.classList.remove('is-expanded');
  image.alt = `Memory image ${model.index + 1}`;
  setStatus(imageStatus, 'Loading image…', 'loading');
  reviewSection.querySelector('#memoryReviewCounter').textContent = `${model.index + 1} of ${model.total}`;
  reviewSection.querySelector('#memoryReviewDeckName').textContent = deckName(model.current.saved_source_id);
  reviewSection.querySelector('#memoryReviewPreviousButton').disabled = !model.canPrevious;
  reviewSection.querySelector('#memoryReviewNextButton').disabled = !model.canNext;
  resetReviewReveal();
  try {
    const repo = await repository();
    if (!repo) throw new Error('Memory images are temporarily unavailable.');
    const url = await repo.signedUrl(model.current);
    if (token !== reviewRenderToken) return;
    image.src = url;
    setStatus(imageStatus, '');
  } catch (error) {
    if (token !== reviewRenderToken) return;
    console.warn('Review image could not be opened', error);
    setStatus(imageStatus, 'This image could not be loaded. Try reopening Review images.', 'warning');
  }
}

async function refreshReviewAssets({ preservePosition = false } = {}) {
  if (!signedIn || !ensureReviewUI()) {
    reviewAssets = []; reviewSources = [];
    if (reviewButton) reviewButton.hidden = true;
    return;
  }
  try {
    const [repo, sourceRepo] = await Promise.all([repository(), savedSourceRepository()]);
    if (!repo) throw new Error('Memory images are temporarily unavailable.');
    const [assets, sources] = await Promise.all([
      repo.listAll(),
      sourceRepo ? sourceRepo.list().catch(() => []) : Promise.resolve([])
    ]);
    reviewAssets = assets;
    reviewSources = sources;
    if (!preservePosition) reviewIndex = 0;
    reviewButton.hidden = false;
    reviewButton.textContent = assets.length ? `Review images (${assets.length})` : 'Review images';
    populateReviewDeckFilter();
    if (reviewOpen) await renderReviewCard();
  } catch (error) {
    console.warn('Memory-image library could not be refreshed', error);
    reviewAssets = []; reviewSources = [];
    reviewButton.hidden = false;
    reviewButton.textContent = 'Review images';
    if (reviewOpen) {
      const empty = reviewSection.querySelector('#memoryReviewEmpty');
      empty.hidden = false;
      empty.querySelector('h3').textContent = 'Review images unavailable';
      empty.querySelector('p').textContent = 'Your decks and normal study mode are unaffected. Try again later.';
      reviewSection.querySelector('#memoryReviewCard').hidden = true;
    }
  }
}

async function openReviewImages() {
  if (!signedIn || !ensureReviewUI()) return;
  if (['running', 'listening', 'waiting', 'paused'].includes(runtimeState?.status)) {
    window.alert('Stop the current study session before opening Review images.');
    return;
  }
  reviewOpen = true;
  reviewSection.hidden = false;
  document.body.classList.add('same3le-review-images-open');
  reviewIndex = 0;
  resetReviewReveal();
  await refreshReviewAssets();
  reviewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeReviewImages() {
  reviewOpen = false;
  reviewRenderToken += 1;
  reviewTextToken += 1;
  if (reviewSection) reviewSection.hidden = true;
  document.body.classList.remove('same3le-review-images-open');
  document.querySelector('#libraryWorkspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function removeCurrentReviewImage() {
  const model = currentReviewModel();
  if (!model.current || !window.confirm('Remove this memory image?')) return;
  const removeButton = reviewSection.querySelector('#memoryReviewRemoveButton');
  removeButton.disabled = true;
  try {
    const repo = await repository();
    if (!repo) throw new Error('Memory images are temporarily unavailable.');
    await repo.removeById(model.current.id);
    studyAssetCache.clear();
    reviewTextCache.clear();
    if (reviewIndex >= model.total - 1) reviewIndex = Math.max(0, reviewIndex - 1);
    resetReviewReveal();
    await refreshReviewAssets({ preservePosition: true });
    scheduleStudyRefresh();
  } catch (error) {
    console.warn('Memory image could not be removed from Review images', error);
    window.alert('The memory image could not be removed.');
  } finally {
    removeButton.disabled = false;
  }
}

function setupObservers() {
  const answerCard = document.querySelector('#answerCard');
  const currentQuestion = document.querySelector('#currentQuestion');
  if (answerCard) new MutationObserver(scheduleStudyRefresh).observe(answerCard, { attributes: true, attributeFilter: ['hidden'] });
  if (currentQuestion) new MutationObserver(scheduleStudyRefresh).observe(currentQuestion, { childList: true, characterData: true, subtree: true });
}

export function setupMemoryImageUI(state) {
  runtimeState = state;
  if (initialized) return scheduleStudyRefresh();
  initialized = true;
  installStyles();
  ensureStudyPanel();
  ensureReviewUI();
  setupObservers();
  onAuthChange((snapshot) => {
    const nextSignedIn = Boolean(snapshot?.user?.id);
    if (signedIn !== nextSignedIn) {
      repositoryPromise = null;
      studyAssetCache.clear();
      reviewRowsCache.clear();
      reviewTextCache.clear();
    }
    signedIn = nextSignedIn;
    if (reviewButton) reviewButton.hidden = !signedIn;
    if (!signedIn) {
      closeReviewImages();
      reviewAssets = [];
      reviewSources = [];
    } else {
      refreshReviewAssets().catch((error) => console.warn('Memory-image library refresh failed', error));
    }
    scheduleStudyRefresh();
  });
  scheduleStudyRefresh();
}
