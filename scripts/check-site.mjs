import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const ORIGIN = 'https://www.same3le.com';
const seoPages = [
  'voice-flashcards/index.html',
  'quiz-me-from-my-notes/index.html',
  'google-sheets-flashcards/index.html',
  'active-recall-out-loud/index.html',
  'medical-students/index.html',
  'pricing/index.html',
  'about/index.html'
];
const legalPages = [
  'terms/index.html',
  'privacy/index.html',
  'acceptable-use/index.html',
  'billing-and-cancellation/index.html',
  'accessibility/index.html',
  'contact/index.html'
];
const errors = [];

async function read(relativePath) {
  try {
    return await fs.readFile(path.join(root, relativePath), 'utf8');
  } catch (error) {
    errors.push(`${relativePath}: missing (${error.code ?? error.message})`);
    return '';
  }
}

function expect(relativePath, source, pattern, message) {
  if (!pattern.test(source)) errors.push(`${relativePath}: ${message}`);
}

function extractFaqs(source) {
  return [...source.matchAll(/<details>\s*<summary>(.*?)<\/summary>\s*<p>(.*?)<\/p>\s*<\/details>/gs)].map((match) => ({
    q: decodeJsonHtml(match[1].replace(/\s+/g, ' ').trim()),
    a: decodeJsonHtml(match[2].replace(/\s+/g, ' ').trim())
  }));
}

function decodeJsonHtml(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"');
}

function parseJsonLdGraphs(source) {
  const graphs = [];
  for (const match of source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(match[1]);
      const nodes = parsed['@graph'] ? parsed['@graph'] : [parsed];
      graphs.push(...nodes);
    } catch (error) {
      errors.push(`JSON-LD parse error: ${error.message}`);
    }
  }
  return graphs;
}

function expectSeoHead(relativePath, source, route) {
  expect(relativePath, source, /<title>[^<]{20,}<\/title>/i, 'missing useful title');
  expect(relativePath, source, /<meta name="description" content="[^"]{80,}"/i, 'missing substantial meta description');
  expect(relativePath, source, new RegExp(`<link rel="canonical" href="${ORIGIN.replaceAll('.', '\\.')}/${route}"`), 'missing www canonical');
  expect(relativePath, source, new RegExp(`property="og:url" content="${ORIGIN.replaceAll('.', '\\.')}/${route}"`), 'missing www og:url');
  expect(relativePath, source, /property="og:image" content="https:\/\/www\.same3le\.com\/og-image\.png"/, 'missing og:image');
  expect(relativePath, source, /name="twitter:card" content="summary_large_image"/, 'missing Twitter card');
  expect(relativePath, source, /<h1[^>]*>[\s\S]+?<\/h1>/i, 'missing H1');
  expect(relativePath, source, /href="\/marketing\.css"/i, 'missing shared stylesheet');
  expect(relativePath, source, /SoftwareApplication/, 'missing SoftwareApplication schema');
  expect(relativePath, source, /"@type": "Organization"/, 'missing Organization schema');
  if (/name="robots" content="noindex/i.test(source)) errors.push(`${relativePath}: SEO page must not be noindex`);
}

for (const relativePath of seoPages) {
  const source = await read(relativePath);
  const route = relativePath.replace(/index\.html$/, '');
  expectSeoHead(relativePath, source, route);
  if (relativePath !== 'about/index.html') {
    expect(relativePath, source, /free/i, 'does not clearly mention free access');
  }

  const faqs = extractFaqs(source);
  const graph = parseJsonLdGraphs(source);
  if (faqs.length) {
    const faqNode = graph.find((node) => node['@type'] === 'FAQPage');
    if (!faqNode) {
      errors.push(`${relativePath}: missing FAQPage JSON-LD`);
    } else {
      const entities = faqNode.mainEntity ?? [];
      if (entities.length !== faqs.length) {
        errors.push(`${relativePath}: FAQPage has ${entities.length} questions, visible FAQ has ${faqs.length}`);
      }
      faqs.forEach((faq, index) => {
        const entity = entities[index];
        const name = decodeJsonHtml(entity?.name ?? '');
        const text = decodeJsonHtml(entity?.acceptedAnswer?.text ?? '');
        if (name !== faq.q || text !== faq.a) {
          errors.push(`${relativePath}: FAQPage Q${index + 1} does not match visible text`);
        }
      });
    }
  }
}

const sheets = await read('google-sheets-flashcards/index.html');
expect('google-sheets-flashcards/index.html', sheets, /"@type": "HowTo"/, 'missing HowTo schema');
expect('google-sheets-flashcards/index.html', sheets, /Create three clear columns\./, 'HowTo missing step 1 name');

const medical = await read('medical-students/index.html');
expect('medical-students/index.html', medical, /datetime="2026-08-31"/, 'missing visible dateModified');
expect('medical-students/index.html', medical, /medical device/i, 'missing device warning');
expect('medical-students/index.html', medical, /PHI|patient information/i, 'missing PHI warning');

for (const relativePath of legalPages) {
  const source = await read(relativePath);
  expect(relativePath, source, /name="robots" content="noindex,follow"/i, 'pre-launch legal page must remain noindex');
  expect(relativePath, source, /<h1[^>]*>[\s\S]+?<\/h1>/i, 'missing H1');
}

const disclaimer = await read('medical-disclaimer/index.html');
expect('medical-disclaimer/index.html', disclaimer, /<link rel="canonical" href="https:\/\/www\.same3le\.com\/medical-disclaimer\/"/, 'disclaimer missing www canonical');
if (/name="robots" content="noindex/i.test(disclaimer)) errors.push('medical-disclaimer/index.html: must be indexable');
expect('medical-disclaimer/index.html', disclaimer, /not medical advice/i, 'disclaimer lost its core warning');

const sitemap = await read('sitemap.xml');
const indexableRoutes = ['', ...seoPages.map((p) => p.replace(/index\.html$/, '')), 'medical-disclaimer/'];
for (const route of indexableRoutes) {
  expect('sitemap.xml', sitemap, new RegExp(`<loc>${ORIGIN}/${route}</loc>`), `missing ${route || '/'} URL`);
}
if (/2026-08-01/.test(sitemap)) errors.push('sitemap.xml: lastmod still uses 2026-08-01');
if (/https:\/\/same3le\.com\//.test(sitemap) && !/https:\/\/www\.same3le\.com\//.test(sitemap)) {
  errors.push('sitemap.xml: still using apex host');
}

const robots = await read('robots.txt');
expect('robots.txt', robots, /User-agent: \*/i, 'missing wildcard user-agent');
expect('robots.txt', robots, /Allow: \//i, 'must allow crawlers');
expect('robots.txt', robots, /Sitemap: https:\/\/www\.same3le\.com\/sitemap\.xml/i, 'missing www sitemap declaration');
if (/GPTBot|ClaudeBot|PerplexityBot|Disallow:/i.test(robots) && /Disallow:/.test(robots)) {
  errors.push('robots.txt: must not add crawl blocks');
}

const llms = await read('llms.txt');
expect('llms.txt', llms, /in-browser spoken Q.A tutor/i, 'missing definition');
expect('llms.txt', llms, /does not automatically generate questions from PDFs/i, 'missing PDF limitation');
expect('llms.txt', llms, /https:\/\/www\.same3le\.com\/voice-flashcards\//, 'missing landing URLs');

await read('favicon.ico');
await read('apple-touch-icon.png');
await read('og-image.png');
await read('vercel.json');

const shell = await read('homepage-marketing.js');
expect('homepage-marketing.js', shell, /The core study app is free/i, 'missing free homepage message');
expect('homepage-marketing.js', shell, /How do you want to start\?/i, 'missing study-path chooser');
expect('homepage-marketing.js', shell, /Choose a deck/i, 'missing ready-made deck path');
expect('homepage-marketing.js', shell, /Paste questions/i, 'missing paste path');
expect('homepage-marketing.js', shell, /Import existing questions/i, 'missing import path');
expect('homepage-marketing.js', shell, /No paid AI required/i, 'missing zero-paid-AI positioning');
expect('homepage-marketing.js', shell, /data-study-path-demo/i, 'missing demo path action');
expect('homepage-marketing.js', shell, /href="#pasteQuestions"/i, 'missing direct paste path action');

const fileUi = await read('file-import-ui.js');
expect('file-import-ui.js', fileUi, /Import a deck or file/i, 'missing direct file import heading');
expect('file-import-ui.js', fileUi, /Excel \.xlsx/i, 'missing Excel format');
expect('file-import-ui.js', fileUi, /Anki \.apkg/i, 'missing Anki format');
expect('file-import-ui.js', fileUi, /\.xlsx,\.apkg,\.csv,\.tsv,\.txt/i, 'file picker does not accept all Step 5 formats');
expect('file-import-ui.js', fileUi, /processed locally/i, 'missing local-processing disclosure');

const fileImport = await read('file-import.js');
expect('file-import.js', fileImport, /parseAnkiPackage/i, 'Anki parser is not connected');
expect('file-import.js', fileImport, /parseXlsxWorkbook/i, 'Excel parser is not connected');
expect('file-import.js', fileImport, /parseDelimited/i, 'CSV\/TSV parser is not connected');

const serviceWorker = await read('service-worker.js');
expect('service-worker.js', serviceWorker, /same3le-v17/i, 'SEO/GEO assets must refresh the PWA cache');
for (const asset of ['file-import-ui.js', 'file-import.js', 'xlsx-import.js', 'anki-import.js', 'zip-reader.js', 'sqlite-read.js', 'supabase-config.js', 'auth-state.js', 'auth.js', 'saved-sources.js', 'account-ui.js', 'favicon.ico', 'og-image.png']) {
  expect('service-worker.js', serviceWorker, new RegExp(asset.replace('.', '\\.')), `missing ${asset} from PWA cache`);
}

const homepage = await read('index.html');
expect('index.html', homepage, /My decks/i, 'missing My decks account area');
expect('index.html', homepage, /Save to my account/i, 'missing save-to-account action');
expect('index.html', homepage, /Start studying/i, 'missing start-studying action after a sheet loads');
expect('index.html', homepage, /Optional: send me product updates/i, 'marketing consent must remain optional and separate');
expect('index.html', homepage, /accountHeaderButton/, 'account chrome missing from the app shell');
expect('index.html', homepage, /<link rel="canonical" href="https:\/\/www\.same3le\.com\/"\s*\/?>/, 'homepage missing www canonical');
expect('index.html', homepage, /application\/ld\+json/, 'homepage missing JSON-LD');
expect('index.html', homepage, /SoftwareApplication/, 'homepage missing SoftwareApplication');
expect('index.html', homepage, /Organization/, 'homepage missing Organization');
expect('index.html', homepage, /og:image/, 'homepage missing og:image');
expect('index.html', homepage, /href="\/voice-flashcards\/"/, 'homepage does not link voice-flashcards');
expect('index.html', homepage, /href="\/quiz-me-from-my-notes\/"/, 'homepage does not link quiz-from-notes');
expect('index.html', homepage, /href="\/google-sheets-flashcards\/"/, 'homepage does not link google-sheets');
expect('index.html', homepage, /href="\/active-recall-out-loud\/"/, 'homepage does not link active-recall');
expect('index.html', homepage, /href="\/medical-students\/"/, 'homepage does not link medical-students');
expect('index.html', homepage, /same3le is a free browser app that turns your question-and-answer list into a spoken tutor/, 'missing crawlable definition');
expect('index.html', homepage, /Free\. Optional Pro later\./, 'missing honest free positioning');

const about = await read('about/index.html');
expect('about/index.html', about, /does not automatically generate questions from PDFs/i, 'about missing PDF limitation');
expect('about/index.html', about, /United States/, 'about missing operator geography');

const accountUi = await read('account-ui.js');
expect('account-ui.js', accountUi, /Sign in to use this deck on your other devices/i, 'missing anonymous save prompt');

const privacy = await read('privacy/index.html');
expect('privacy/index.html', privacy, /authentication information and saved Google Sheet identifiers/i, 'privacy policy must disclose Supabase account storage');
expect('privacy/index.html', privacy, /does not intentionally store spoken answers, audio, or transcripts/i, 'privacy policy must disclose that speech is not stored');
expect('privacy/index.html', privacy, /Local imported deck contents remain in this browser/i, 'privacy policy must not claim all data stays local after accounts');

const config = await read('supabase-config.js');
expect('supabase-config.js', config, /NEVER add a service-role key/i, 'missing service-role warning in public config');
expect('supabase-config.js', config, /https:\/\/www\.same3le\.com/, 'auth site URL must use the www production hostname');
expect('supabase-config.js', config, /yleyerkmqeozlfuaqbmj\.supabase\.co/, 'frontend must use the same3le project URL');

const vercel = await read('vercel.json');
expect('vercel.json', vercel, /"trailingSlash": true/, 'missing trailing-slash normalization');
expect('vercel.json', vercel, /\/index\.html/, 'missing index.html redirect');

const secretPattern = /service_role|DATABASE_PASSWORD|JWT_SECRET|postgres(ql)?:\/\/[^:\s]+:[^@\s]+@/i;
for (const relativePath of ['supabase-config.js', 'auth.js', 'saved-sources.js', 'account-ui.js', 'index.html', 'app.js']) {
  const source = await read(relativePath);
  if (secretPattern.test(source)) errors.push(`${relativePath}: appears to contain a committed secret`);
}

if (errors.length) {
  console.error(`Site validation failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Validated ${seoPages.length} SEO pages, ${legalPages.length} legal pages, homepage study paths, Step 5 local imports, Account Sync v1, and PWA cache.`);
