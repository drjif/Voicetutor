import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const seoPages = [
  'voice-flashcards/index.html',
  'quiz-me-from-my-notes/index.html',
  'google-sheets-flashcards/index.html',
  'active-recall-out-loud/index.html',
  'medical-students/index.html',
  'pricing/index.html'
];
const legalPages = [
  'terms/index.html',
  'privacy/index.html',
  'acceptable-use/index.html',
  'medical-disclaimer/index.html',
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

for (const relativePath of seoPages) {
  const source = await read(relativePath);
  expect(relativePath, source, /<title>[^<]{20,}<\/title>/i, 'missing useful title');
  expect(relativePath, source, /<meta name="description" content="[^"]{80,}"/i, 'missing substantial meta description');
  expect(relativePath, source, /<link rel="canonical" href="https:\/\/tutor\.gi-jad\.com\//i, 'missing current production canonical');
  expect(relativePath, source, /<h1[^>]*>[\s\S]+?<\/h1>/i, 'missing H1');
  expect(relativePath, source, /free/i, 'does not clearly mention free access');
  expect(relativePath, source, /href="\/marketing\.css"/i, 'missing shared stylesheet');
  if (/name="robots" content="noindex/i.test(source)) errors.push(`${relativePath}: SEO page must not be noindex`);
}

for (const relativePath of legalPages) {
  const source = await read(relativePath);
  expect(relativePath, source, /name="robots" content="noindex,follow"/i, 'pre-launch legal page must remain noindex');
  expect(relativePath, source, /<h1[^>]*>[\s\S]+?<\/h1>/i, 'missing H1');
}

const sitemap = await read('sitemap.xml');
for (const relativePath of seoPages) {
  const route = relativePath.replace(/index\.html$/, '');
  expect('sitemap.xml', sitemap, new RegExp(`<loc>https://tutor\\.gi-jad\\.com/${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>`), `missing ${route} URL`);
}

const robots = await read('robots.txt');
expect('robots.txt', robots, /Sitemap: https:\/\/tutor\.gi-jad\.com\/sitemap\.xml/i, 'missing sitemap declaration');

const shell = await read('homepage-marketing.js');
expect('homepage-marketing.js', shell, /The core study app is free/i, 'missing free homepage message');
expect('homepage-marketing.js', shell, /SoftwareApplication/i, 'missing software structured data');
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
expect('service-worker.js', serviceWorker, /samme3le-v15/i, 'Account Sync v1 must refresh the PWA cache');
for (const asset of ['file-import-ui.js', 'file-import.js', 'xlsx-import.js', 'anki-import.js', 'zip-reader.js', 'sqlite-read.js', 'supabase-config.js', 'auth-state.js', 'auth.js', 'saved-sources.js', 'account-ui.js']) {
  expect('service-worker.js', serviceWorker, new RegExp(asset.replace('.', '\\.')), `missing ${asset} from PWA cache`);
}

const homepage = await read('index.html');
expect('index.html', homepage, /My decks/i, 'missing My decks account area');
expect('index.html', homepage, /Save to my account/i, 'missing save-to-account action');
expect('index.html', homepage, /Start studying/i, 'missing start-studying action after a sheet loads');
expect('index.html', homepage, /Optional: send me product updates/i, 'marketing consent must remain optional and separate');
expect('index.html', homepage, /accountHeaderButton/, 'account chrome missing from the app shell');

const accountUi = await read('account-ui.js');
expect('account-ui.js', accountUi, /Sign in to use this deck on your other devices/i, 'missing anonymous save prompt');

const privacy = await read('privacy/index.html');
expect('privacy/index.html', privacy, /authentication information and saved Google Sheet identifiers/i, 'privacy policy must disclose Supabase account storage');
expect('privacy/index.html', privacy, /does not intentionally store spoken answers, audio, or transcripts/i, 'privacy policy must disclose that speech is not stored');
expect('privacy/index.html', privacy, /Local imported deck contents remain in this browser/i, 'privacy policy must not claim all data stays local after accounts');

const config = await read('supabase-config.js');
expect('supabase-config.js', config, /NEVER add a service-role key/i, 'missing service-role warning in public config');
expect('supabase-config.js', config, /https:\/\/tutor\.gi-jad\.com/, 'auth site URL must remain the current production hostname');

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
