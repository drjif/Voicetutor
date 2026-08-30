import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const OLD_ORIGIN = 'https://tutor.gi-jad.com';
const root = process.cwd();
const input = process.argv[2];

if (!input) {
  console.error('Usage: node scripts/set-domain.mjs https://same3le.com');
  process.exit(1);
}

let newOrigin;
try {
  const url = new URL(input);
  if (url.protocol !== 'https:') throw new Error('HTTPS is required');
  newOrigin = url.origin;
} catch (error) {
  console.error(`Invalid production origin: ${error.message}`);
  process.exit(1);
}

const includedExtensions = new Set(['.html', '.xml', '.txt', '.js', '.md']);
const ignoredDirectories = new Set(['.git', 'node_modules']);
let changed = 0;

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(filePath);
      continue;
    }
    if (!includedExtensions.has(path.extname(entry.name))) continue;
    const original = await fs.readFile(filePath, 'utf8');
    const updated = original.split(OLD_ORIGIN).join(newOrigin);
    if (updated !== original) {
      await fs.writeFile(filePath, updated);
      changed += 1;
      console.log(`Updated ${path.relative(root, filePath)}`);
    }
  }
}

await walk(root);
await fs.writeFile(path.join(root, 'CNAME'), `${new URL(newOrigin).hostname}\n`);
console.log(`Updated ${changed} files and set CNAME to ${new URL(newOrigin).hostname}.`);
console.log('Next: configure DNS, enforce HTTPS, add permanent URL-matched redirects from the old domain, and submit the new sitemap.');
