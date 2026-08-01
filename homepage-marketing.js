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
    description.content = 'Turn your notes into free voice flashcards. Upload a Google Sheet or CSV, answer questions out loud, and let samme3le keep the study session moving.';
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
    <a href="/voice-flashcards/">Voice flashcards</a>
    <a href="/medical-students/">Medical students</a>
    <a href="/pricing/">Pricing</a>
  `;
  topbar.insertBefore(nav, actions);
}

function strengthenHero() {
  const badge = document.querySelector('.prototype-badge');
  if (badge) badge.textContent = 'Free app';

  const heading = document.querySelector('#hero-heading');
  if (heading) heading.textContent = 'Turn your notes into voice flashcards that quiz you out loud.';

  const subtitle = document.querySelector('.hero-subtitle');
  if (subtitle) subtitle.textContent = 'Add a list of questions and answers. samme3le reads each question, listens to your answer, and keeps going automatically.';

  const proofItems = document.querySelectorAll('.hero-proof li');
  const proof = ['Free core app', 'No credit card', 'Optional Pro later'];
  proofItems.forEach((item, index) => {
    if (proof[index]) item.textContent = proof[index];
  });
}

function addFreePlanStrip() {
  const hero = document.querySelector('.hero');
  if (!hero || document.querySelector('.free-product-strip')) return;

  const section = document.createElement('section');
  section.className = 'free-product-strip';
  section.setAttribute('aria-labelledby', 'free-plan-heading');
  section.innerHTML = `
    <div>
      <h2 id="free-plan-heading">The core study app is free.</h2>
      <p>Use demo questions, import your own Google Sheet or CSV, and run spoken study sessions without a credit card. Pro will be an optional subscription for saved account features.</p>
    </div>
    <a class="button primary" href="/pricing/">See Free vs Pro</a>
  `;
  hero.insertAdjacentElement('afterend', section);
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
  addFreePlanStrip();
  addFooterNavigation();
}
