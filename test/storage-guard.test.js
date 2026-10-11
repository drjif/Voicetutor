import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../storage-guard.js', import.meta.url), 'utf8');

class MemoryStorage {
  constructor(entries = {}) { this.map = new Map(Object.entries(entries)); }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(String(k)); }
  clear() { this.map.clear(); }
}

class FullStorage extends MemoryStorage {
  setItem() { throw new Error('QuotaExceededError'); }
}

function run(window) {
  const context = vm.createContext({ window, console: { warn() {} } });
  vm.runInContext(source, context);
  return window;
}

test('leaves healthy storage untouched', () => {
  const local = new MemoryStorage({ a: '1' });
  const session = new MemoryStorage();
  const window = run({ localStorage: local, sessionStorage: session });
  assert.equal(window.localStorage, local);
  assert.equal(window.sessionStorage, session);
  assert.deepEqual([...window.__same3leStorageFallback], []);
  assert.equal(local.getItem('__same3le_storage_probe__'), null, 'probe key cleaned up');
});

test('when writes throw: keeps saved data readable and holds new writes in memory', () => {
  const window = run({ localStorage: new FullStorage({ settings: '{"mode":"passive"}' }), sessionStorage: new MemoryStorage() });
  const ls = window.localStorage;
  assert.deepEqual([...window.__same3leStorageFallback], ['localStorage']);
  assert.equal(ls.getItem('settings'), '{"mode":"passive"}', 'existing data survives');
  assert.doesNotThrow(() => ls.setItem('settings', '{"mode":"active"}'));
  assert.equal(ls.getItem('settings'), '{"mode":"active"}', 'newer value wins');
  ls.setItem('n', 5);
  assert.equal(ls.getItem('n'), '5', 'values are stored as strings, like real storage');
  ls.removeItem('settings');
  assert.equal(ls.getItem('settings'), null);
  assert.equal(ls.length, 1);
  assert.equal(ls.key(0), 'n');
  ls.clear();
  assert.equal(ls.length, 0);
});

test('when any access throws: falls back to working in-memory storage', () => {
  const window = {};
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(window, name, { configurable: true, get() { throw new Error('SecurityError'); } });
  }
  run(window);
  assert.deepEqual([...window.__same3leStorageFallback], ['localStorage', 'sessionStorage']);
  window.sessionStorage.setItem('visit', '1');
  assert.equal(window.sessionStorage.getItem('visit'), '1');
  assert.equal(window.localStorage.getItem('missing'), null);
});

test('when storage is missing (null): falls back to working in-memory storage', () => {
  const window = run({ localStorage: null, sessionStorage: null });
  window.localStorage.setItem('k', 'v');
  assert.equal(window.localStorage.getItem('k'), 'v');
  assert.equal(window.sessionStorage.length, 0);
});

test('the homepage runs the guard before app.js and tool pages do not load it', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const guard = html.indexOf('<script defer src="./storage-guard.js"></script>');
  const app = html.indexOf('<script type="module" src="./app.js"></script>');
  assert.ok(guard > 0 && app > guard, 'storage-guard.js must be a deferred classic script placed before app.js');
  const tool = await readFile(new URL('../quizlet-to-anki/index.html', import.meta.url), 'utf8');
  assert.ok(!tool.includes('storage-guard.js'), 'tool pages must see real storage failures to fall back to the clipboard');
});
