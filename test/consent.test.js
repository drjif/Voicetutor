import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../consent.js', import.meta.url), 'utf8');
const FLAG = 'ga-disable-G-8FVETBN9N5';

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map)
  };
}

function run({ zone = 'America/New_York', stored = {}, storage } = {}) {
  const dispatched = [];
  const window = {
    localStorage: storage ?? memoryStorage(stored),
    location: { origin: 'https://www.same3le.com', pathname: '/quizlet-to-anki/' },
    dispatchEvent: (event) => dispatched.push(event)
  };
  const document = {
    readyState: 'loading',
    addEventListener() {},
    querySelectorAll: () => [],
    referrer: '',
    title: 'Test page',
    body: null,
    head: null
  };
  const Intl = { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: zone }) }) };
  vm.runInContext(source, vm.createContext({ window, document, Intl, CustomEvent }));
  const commands = () => window.dataLayer.map((args) => JSON.parse(JSON.stringify(Array.from(args))));
  return { window, commands, dispatched };
}

test('everyone starts with ads off, and EEA/UK/CH visitors (by IP) with analytics off', () => {
  const { commands } = run();
  const [regional, general] = commands();
  assert.equal(regional[0], 'consent');
  assert.equal(regional[1], 'default');
  assert.equal(regional[2].analytics_storage, 'denied');
  assert.equal(regional[2].ad_storage, 'denied');
  for (const code of ['FR', 'DE', 'IE', 'GB', 'CH', 'NO', 'IS', 'LI']) assert.ok(regional[2].region.includes(code), code);
  assert.equal(regional[2].region.length, 32);
  assert.equal(general[2].ad_user_data, 'denied');
  assert.equal(general[2].ad_personalization, 'denied');
  assert.equal(general[2].region, undefined);
});

test('US time zone with no choice: analytics on, nothing held', () => {
  const { window, commands } = run({ zone: 'America/New_York' });
  assert.equal(commands()[1][2].analytics_storage, 'granted');
  assert.equal(commands().length, 2, 'no update without a stored choice');
  assert.notEqual(window[FLAG], true);
  assert.equal(window.same3leConsent.held(), false);
});

test('European time zone with no choice: analytics off and nothing sent until they choose', () => {
  for (const zone of ['Europe/Paris', 'Europe/London', 'Europe/Dublin', 'Atlantic/Canary', 'Asia/Nicosia']) {
    const { window, commands } = run({ zone });
    assert.equal(commands()[1][2].analytics_storage, 'denied', zone);
    assert.equal(window[FLAG], true, zone);
    assert.equal(window.same3leConsent.held(), true, zone);
  }
});

test('a stored choice is honoured on every visit, anywhere', () => {
  const allowed = run({ zone: 'Europe/Berlin', stored: { 'same3le.analyticsConsent.v1': 'granted' } });
  assert.deepEqual(allowed.commands()[2], ['consent', 'update', { analytics_storage: 'granted' }]);
  assert.notEqual(allowed.window[FLAG], true);

  const declined = run({ zone: 'America/Chicago', stored: { 'same3le.analyticsConsent.v1': 'denied' } });
  assert.deepEqual(declined.commands()[2], ['consent', 'update', { analytics_storage: 'denied' }]);
  assert.equal(declined.window[FLAG], true);
});

test('allowing releases analytics, records the held page view, saves the choice and tells listeners', () => {
  const { window, commands, dispatched } = run({ zone: 'Europe/Madrid' });
  window.same3leConsent.set('granted');
  assert.equal(window[FLAG], false);
  const after = commands().slice(2);
  assert.deepEqual(after[0], ['consent', 'update', { analytics_storage: 'granted' }]);
  assert.equal(after[1][0], 'event');
  assert.equal(after[1][1], 'page_view');
  assert.equal(after[1][2].page_location, 'https://www.same3le.com/quizlet-to-anki/');
  assert.equal(window.localStorage.getItem('same3le.analyticsConsent.v1'), 'granted');
  assert.equal(dispatched[0].type, 'same3le:consent');
  assert.equal(dispatched[0].detail.analytics, 'granted');
});

test('declining keeps everything off and is remembered', () => {
  const { window, commands } = run({ zone: 'Europe/Rome' });
  window.same3leConsent.set('denied');
  assert.equal(window[FLAG], true);
  assert.ok(!commands().some((c) => c[0] === 'event'), 'no page view is sent after declining');
  assert.equal(window.localStorage.getItem('same3le.analyticsConsent.v1'), 'denied');
});

test('blocked storage never breaks the page', () => {
  const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); } };
  const { window } = run({ zone: 'Europe/Paris', storage: throwing });
  assert.equal(window.same3leConsent.choice(), null);
  assert.doesNotThrow(() => window.same3leConsent.set('granted'));
  assert.equal(window[FLAG], false);
});
