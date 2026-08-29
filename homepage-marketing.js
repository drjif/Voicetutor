function ensureStylesheet() {
  if (document.querySelector('link[href="./homepage-marketing.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './homepage-marketing.css';
  document.head.append(link);
}

function setMetadata() {
  document.title = 'samme3le — Free Voice Flashcards That Quiz You Out Loud';
  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.content = 'Study out loud for free. Choose a ready-made deck, paste Q&A from ChatGPT, Claude, or Gemini, or import your existing questions into samme3le.';
  }

  if (!document.querySelector('link[rel="canonical"]')) {
    const canonical = document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href = 'https://tutor.gi-jad.com/';
    document.head.append(canonical);
  }

  if (!document.querySelector('#samme3leSoftwareSchema')) {
    const schema = document.createElement('script');
    schema.id = 'samme3leSoftwareSchema';
    schema.type = 'application/ld+json';
    schema.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'samme3le',
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'Web browser',
      description: 'A free voice flashcard app that reads questions aloud and can listen to spoken answers.',
      url: 'https://tutor.gi-jad.com/',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
    });
    document.head.append(schema);
  }
}

function addNavigation() {
  const topbar = document.querySelector('.topbar');
  const actions = document.querySelector('.header-actions');
  if (!topbar || !actions || document.querySelector('.marketing-nav')) return;

  const nav = document.createElement('nav');
  nav.className = 'marketing-nav';
  nav.setAttribute('aria-label', 'Learn about samme3le');
  nav.innerHTML = `
    <a href="#start-studying">Start</a>
    <a href="#my-decks-heading">My decks</a>
    <a href="/voice-flashcards/">Voice flashcards</a>
    <a href="/medical-students/">Medical students</a>
    <a href="/pricing/">Pricing</a>
  `;
  topbar.insertBefore(nav, actions);
}

function strengthenHero() {
  const badge = document.querySelector('.prototype-badge');
  if (badge) badge.textContent = 'Free app';

  const eyebrow = document.querySelector('.hero-copy .eyebrow');
  if (eyebrow) eyebrow.textContent = 'Your questions. Your voice. Start in seconds.';

  const heading = document.querySelector('#hero-heading');
  if (heading) heading.textContent = 'Free voice flashcards that quiz you out loud.';

  const subtitle = document.querySelector('.hero-subtitle');
  if (subtitle) {
    subtitle.textContent = 'Choose a ready-made deck, paste questions from your favorite AI, or import questions you already have. samme3le asks. You answer.';
  }

  const demoButton = document.querySelector('#loadDemo');
  if (demoButton) demoButton.textContent = 'Try 5-question demo';

  const secondaryAction = document.querySelector('.hero-actions a');
  if (secondaryAction) {
    secondaryAction.textContent = 'Choose how to start';
    secondaryAction.href = '#start-studying';
  }

  const proofItems = document.querySelectorAll('.hero-proof li');
  const proof = ['Free core app', 'No credit card', 'No paid AI required'];
  proofItems.forEach((item, index) => {
    if (proof[index]) item.textContent = proof[index];
  });
}

function addStudyPaths() {
  const hero = document.querySelector('.hero');
  if (!hero || document.querySelector('#start-studying')) return;

  const section = document.createElement('section');
  section.id = 'start-studying';
  section.className = 'study-paths card';
  section.setAttribute('aria-labelledby', 'study-paths-heading');
  section.innerHTML = `
    <div class="study-paths-heading">
      <p class="eyebrow">Start here</p>
      <h2 id="study-paths-heading">How do you want to start?</h2>
      <p>Pick the easiest path for what you already have. All three feed the same spoken study engine.</p>
    </div>

    <div class="study-path-grid">
      <article class="study-path-card">
        <div class="study-path-topline">
          <span class="study-path-number" aria-hidden="true">1</span>
          <span class="study-path-kicker">0 setup</span>
        </div>
        <h3>Choose a deck</h3>
        <p>Try the ready-made five-question sample deck immediately. A larger free deck library is the next expansion.</p>
        <button class="button primary full-button" type="button" data-study-path-demo>Try sample deck</button>
      </article>

      <article class="study-path-card featured-path">
        <div class="study-path-topline">
          <span class="study-path-number" aria-hidden="true">2</span>
          <span class="study-path-kicker">Fastest for your own material</span>
        </div>
        <h3>Paste questions</h3>
        <p>Copy Q&A from ChatGPT, Claude, Gemini, a spreadsheet, or your own notes. No account or public link required.</p>
        <a class="button primary full-button" href="#pasteQuestions" data-study-path-paste>Paste my questions</a>
      </article>

      <article class="study-path-card">
        <div class="study-path-topline">
          <span class="study-path-number" aria-hidden="true">3</span>
          <span class="study-path-kicker">Bring what you already use</span>
        </div>
        <h3>Import existing questions</h3>
        <p>Keep using CSV or Google Sheets when your deck already lives there. Those advanced prototype imports remain intact.</p>
        <a class="button secondary full-button" href="#advanced-imports" data-study-path-import>See import options</a>
      </article>
    </div>

    <div class="own-ai-note">
      <strong>Already pay for an AI assistant?</strong>
      <span>Let it create the questions. Copy the Q&A into samme3le. Your AI makes the deck; samme3le handles the spoken practice.</span>
    </div>
  `;

  hero.insertAdjacentElement('afterend', section);

  section.querySelector('[data-study-path-demo]')?.addEventListener('click', () => {
    document.querySelector('#loadDemo')?.click();
  });

  section.querySelector('[data-study-path-paste]')?.addEventListener('click', () => {
    window.setTimeout(() => document.querySelector('#pasteQuestions')?.focus(), 50);
  });

  const advancedImports = document.querySelector('.advanced-import-heading');
  if (advancedImports) advancedImports.id = 'advanced-imports';
}

function clarifyQuestionSection() {
  const heading = document.querySelector('#questions-heading');
  if (heading) heading.textContent = 'Paste or import your own questions';

  const description = heading?.parentElement?.querySelector('p');
  if (description) {
    description.textContent = 'Paste Q&A for the fastest no-signup path, or use the existing CSV and Google Sheet imports below.';
  }
}

function updateHowItWorks() {
  const steps = [...document.querySelectorAll('.simple-step')];
  const content = [
    ['Bring questions your way', 'Choose the sample deck, paste Q&A from your AI, or import questions you already have.'],
    ['Choose how to study', 'Use Answer out loud for active recall, or switch to one of the listening modes.'],
    ['Start speaking', 'samme3le asks each question, listens when supported, checks the answer locally, and keeps going.']
  ];

  steps.forEach((step, index) => {
    const [title, body] = content[index] ?? [];
    if (!title) return;
    const heading = step.querySelector('h3');
    const paragraph = step.querySelector('p');
    if (heading) heading.textContent = title;
    if (paragraph) paragraph.textContent = body;
  });
}

function addFreePlanStrip() {
  const studyPaths = document.querySelector('#start-studying');
  if (!studyPaths || document.querySelector('.free-product-strip')) return;

  const section = document.createElement('section');
  section.className = 'free-product-strip';
  section.setAttribute('aria-labelledby', 'free-plan-heading');
  section.innerHTML = `
    <div>
      <h2 id="free-plan-heading">The core study app is free.</h2>
      <p>Use the sample deck, paste your own Q&A, or bring an existing deck. No credit card and no paid AI call is required for the oral study engine.</p>
    </div>
    <a class="button primary" href="#pasteQuestions">Paste questions free</a>
  `;
  studyPaths.insertAdjacentElement('afterend', section);
}

function addFooterNavigation() {
  const footer = document.querySelector('footer');
  if (!footer || document.querySelector('.homepage-links')) return;

  const useCases = document.createElement('nav');
  useCases.className = 'homepage-use-cases';
  useCases.setAttribute('aria-label', 'samme3le use cases');
  useCases.innerHTML = `
    <a href="/voice-flashcards/">Voice flashcards</a>
    <a href="/quiz-me-from-my-notes/">Quiz me from my notes</a>
    <a href="/google-sheets-flashcards/">Google Sheets flashcards</a>
    <a href="/active-recall-out-loud/">Active recall out loud</a>
    <a href="/medical-students/">Medical students</a>
  `;

  const legal = document.createElement('nav');
  legal.className = 'homepage-links';
  legal.setAttribute('aria-label', 'Legal and support');
  legal.innerHTML = `
    <a href="/pricing/">Pricing</a>
    <a href="/terms/">Terms</a>
    <a href="/privacy/">Privacy</a>
    <a href="/acceptable-use/">Acceptable use</a>
    <a href="/medical-disclaimer/">Educational disclaimer</a>
    <a href="/accessibility/">Accessibility</a>
    <a href="/contact/">Contact</a>
  `;
  footer.append(useCases, legal);
}

export function setupHomepageMarketing() {
  ensureStylesheet();
  setMetadata();
  addNavigation();
  strengthenHero();
  addStudyPaths();
  clarifyQuestionSection();
  updateHowItWorks();
  addFreePlanStrip();
  addFooterNavigation();
}
