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

const serviceWorker = await read('service-worker.js');
expect('service-worker.js', serviceWorker, /samme3le-v13/i, 'homepage redesign must refresh the PWA cache');
expect('service-worker.js', serviceWorker, /homepage-marketing\.css/i, 'homepage stylesheet is not cached');
expect('service-worker.js', serviceWorker, /homepage-marketing\.js/i, 'homepage behavior is not cached');

if (errors.length) {
  console.error(`Site validation failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Validated ${seoPages.length} SEO pages, ${legalPages.length} legal pages, sitemap, robots, homepage study paths, and PWA cache.`);
