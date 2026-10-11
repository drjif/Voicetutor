import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  readAnkiFile,
  readZipDirectory,
  readZipEntry,
  readSqliteTable,
  tableColumns,
  notetypeKind,
  decompressZstd,
  ApkgError
} from '../apkg-to-csv/apkg-read.js';
import {
  buildTable,
  describeDeck,
  noteCards,
  plainText,
  studyHandoff,
  toCsv,
  toQuizletText,
  toTsv
} from '../apkg-to-csv/convert.js';
import { cardsFromAnkiFields, cleanAnkiText } from '../anki-import.js';
import { parsePastedQuestions } from '../paste-data.js';

const fixture = (name) => new URL(`./fixtures/apkg/${name}`, import.meta.url);
async function open(name, as = name) {
  return new File([await readFile(fixture(name))], as);
}
const decks = {};
async function deck(name) {
  decks[name] ??= await readAnkiFile(await open(name));
  return decks[name];
}

// ---- Reading every package format ------------------------------------------------------

test('reads a modern .apkg (zstd collection.anki21b), skipping the placeholder for old Anki', async () => {
  const modern = await deck('modern.apkg');
  assert.equal(modern.format, 'modern');
  assert.equal(modern.container, 'apkg');
  assert.equal(modern.notes.length, 11);
  assert.equal(modern.mediaFiles, 2);
  const basic = modern.noteTypes.find((type) => type.name === 'Basic');
  assert.deepEqual(basic.fields, ['Front', 'Back']);
  assert.equal(modern.noteTypes.find((type) => type.name === 'Cloze').kind, 'cloze');
  assert.deepEqual(modern.notes[0], {
    id: modern.notes[0].id,
    typeId: basic.id,
    fields: ['What organelle makes most of a cell’s ATP?', 'The <b>mitochondrion</b>'],
    tags: ['bio::cells', 'high-yield'],
    deck: 'Biology::Cells'
  });
});

test('legacy, modern and .colpkg exports of the same collection give identical CSV', async () => {
  const modern = toCsv(buildTable(await deck('modern.apkg')));
  assert.equal(toCsv(buildTable(await deck('legacy.apkg'))), modern);
  assert.equal(toCsv(buildTable(await deck('modern.colpkg'))), modern);
  assert.equal((await deck('legacy.apkg')).format, 'legacy');
  assert.equal((await deck('modern.colpkg')).container, 'colpkg');
});

test('reads the oldest format (collection.anki2 written by genanki)', async () => {
  const old = await deck('genanki-legacy.apkg');
  assert.equal(old.format, 'legacy');
  assert.deepEqual(old.notes.map((note) => note.deck), Array(3).fill('Old Format::Pharmacology'));
  assert.deepEqual(old.notes[1].fields, ['Comma, "quote" and\nnewline', 'Back, too']);
  assert.deepEqual(old.notes[1].tags, ['edge', 'pharm::tox']);
});

test('a deck exported with scheduling and deck options reads the same way', async () => {
  const sub = await deck('subdeck-only.apkg');
  assert.deepEqual([...new Set(sub.notes.map((note) => note.deck))], ['Biology::Genetics']);
  assert.equal(sub.notes.length, 4);
});

test('opens a raw collection file (collection.anki2 from the Anki folder)', async () => {
  const file = await open('modern.apkg');
  const entry = (await readZipDirectory(file)).find((item) => item.name === 'collection.anki21b');
  const sqlite = await decompressZstd(await readZipEntry(file, entry));
  const raw = await readAnkiFile(new File([sqlite], 'collection.anki2'));
  assert.equal(raw.container, 'collection');
  assert.deepEqual(raw.notes, (await deck('modern.apkg')).notes);
});

test('the example deck on the page converts', async () => {
  const example = await readAnkiFile(new File([await readFile(new URL('../apkg-to-csv/example.apkg', import.meta.url))], 'example.apkg'));
  const summary = describeDeck(example);
  assert.equal(summary.noteCount, 8);
  assert.equal(summary.studyCards, 10);
  assert.equal(example.format, 'modern');
});

// ---- ZIP64 -------------------------------------------------------------------------------

function zip64(entries) {
  // Minimal ZIP64 archive: stored entries, maxed-out 32-bit fields, sizes in extra field 0x0001.
  const chunks = [];
  const central = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const { name, data } of entries) {
    const nameBytes = enc.encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 45, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    const cd = new DataView(new ArrayBuffer(46 + 28));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 45, true);
    cd.setUint16(6, 45, true);
    cd.setUint32(20, 0xffffffff, true);
    cd.setUint32(24, 0xffffffff, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 28, true);
    cd.setUint32(42, 0xffffffff, true);
    cd.setUint16(46, 0x0001, true);
    cd.setUint16(48, 24, true);
    cd.setBigUint64(50, BigInt(data.length), true);
    cd.setBigUint64(58, BigInt(data.length), true);
    cd.setBigUint64(66, BigInt(offset), true);
    const header = new Uint8Array(cd.buffer);
    central.push(header.subarray(0, 46), nameBytes, header.subarray(46));
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const record = new DataView(new ArrayBuffer(56 + 20 + 22));
  record.setUint32(0, 0x06064b50, true);
  record.setBigUint64(4, 44n, true);
  record.setBigUint64(24, BigInt(entries.length), true);
  record.setBigUint64(32, BigInt(entries.length), true);
  record.setBigUint64(40, BigInt(centralSize), true);
  record.setBigUint64(48, BigInt(offset), true);
  record.setUint32(56, 0x07064b50, true);
  record.setBigUint64(64, BigInt(offset + centralSize), true);
  record.setUint32(72, 1, true);
  record.setUint32(76, 0x06054b50, true);
  record.setUint16(84, 0xffff, true);
  record.setUint16(86, 0xffff, true);
  record.setUint32(88, 0xffffffff, true);
  record.setUint32(92, 0xffffffff, true);
  return new Blob([...chunks, ...central, new Uint8Array(record.buffer)]);
}

test('reads ZIP64 packages (huge media-heavy decks use them)', async () => {
  const file = await open('modern.apkg');
  const entries = await readZipDirectory(file);
  const collection = await readZipEntry(file, entries.find((item) => item.name === 'collection.anki21b'));
  const big = zip64([
    { name: '0', data: new Uint8Array(5) },
    { name: 'collection.anki21b', data: collection },
    { name: 'media', data: new Uint8Array(2) }
  ]);
  const read = await readAnkiFile(new File([big], 'big.apkg'));
  assert.equal(read.notes.length, 11);
  assert.equal(read.mediaFiles, 1);
});

test('reads only the ZIP directory and the collection, never the media files', async () => {
  const file = await open('modern.apkg');
  const collection = await readZipEntry(file, (await readZipDirectory(file)).find((item) => item.name === 'collection.anki21b'));
  const media = new Uint8Array(3 * 1024 * 1024).fill(7);
  const bytes = new Uint8Array(await zip64([
    { name: '0', data: media },
    { name: 'collection.anki21b', data: collection },
    { name: 'media', data: new Uint8Array(2) }
  ]).arrayBuffer());
  const reads = [];
  const tracking = (start = 0, end = bytes.length) => ({
    size: end - start,
    name: 'media-heavy.apkg',
    slice(from = 0, to = end - start) {
      return tracking(start + from, start + Math.min(to, end - start));
    },
    async arrayBuffer() {
      reads.push([start, end]);
      return bytes.slice(start, end).buffer;
    }
  });
  const result = await readAnkiFile(tracking());
  assert.equal(result.notes.length, 11);
  const mediaStart = 30 + 1;
  const mediaRead = reads.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, mediaStart + media.length) - Math.max(start, mediaStart)), 0);
  assert.ok(mediaRead <= 1024, `read ${mediaRead} bytes of the media file`);
  const total = reads.reduce((sum, [start, end]) => sum + end - start, 0);
  assert.ok(total < 200 * 1024, `read ${total} bytes of a ${bytes.length}-byte deck`);
});

// ---- SQLite details ----------------------------------------------------------------------

test('reads multi-level b-trees, overflow pages and WITHOUT ROWID tables exactly', async () => {
  const bytes = new Uint8Array(await readFile(fixture('btree-512.sqlite')));
  const rows = readSqliteTable(bytes, 't');
  assert.equal(rows.length, 150);
  rows.forEach((row, index) => {
    assert.equal(row.id, index - 75);
    assert.equal(row.body, `row ${index} ${index % 25 === 0 ? 'long '.repeat(300) : 'é'.repeat(index % 7)}`);
  });
  const keyed = readSqliteTable(bytes, 'w');
  assert.equal(keyed.length, 150);
  for (const row of keyed) {
    const index = Number(row.k.slice(4));
    assert.equal(row.n, index % 9);
    assert.equal(row.v, index % 25 === 0 ? 'V'.repeat(1500) : `v${index}`);
  }
});

test('parses CREATE TABLE with comments, quotes and table-level primary keys', () => {
  const notes = tableColumns('CREATE TABLE notes (\n id integer PRIMARY KEY,\n flds text NOT NULL,\n -- deliberate, because\n sfld integer NOT NULL\n)');
  assert.deepEqual(notes.columns.map((column) => column.name), ['id', 'flds', 'sfld']);
  assert.equal(notes.columns[0].integerPrimaryKey, true);
  const fields = tableColumns('CREATE TABLE fields ( ntid integer NOT NULL, "ord" integer NOT NULL, [name] text, PRIMARY KEY (ntid, ord) ) without rowid');
  assert.deepEqual(fields.columns.map((column) => column.name), ['ntid', 'ord', 'name']);
  assert.deepEqual(fields.primaryKey, ['ntid', 'ord']);
  assert.equal(fields.columns[0].integerPrimaryKey, false);
});

test('reads the note-type kind from its protobuf config', () => {
  assert.equal(notetypeKind(new Uint8Array([0x08, 0x01, 0x1a, 0x01, 0x41])), 'cloze');
  assert.equal(notetypeKind(new Uint8Array([0x1a, 0x02, 0x41, 0x42, 0x10, 0x00])), 'normal');
  assert.equal(notetypeKind(null), 'normal');
});

// ---- Errors people will actually hit -----------------------------------------------------

async function errorCode(file) {
  try {
    await readAnkiFile(file);
  } catch (error) {
    assert.ok(error instanceof ApkgError, error.message);
    assert.ok(error.message.length > 20 && !/sqlite|zstd|b-tree|undefined/i.test(error.message), `message: ${error.message}`);
    return error.code;
  }
  return 'no error';
}

test('gives a clear message for files that are not Anki decks', async () => {
  assert.equal(await errorCode(new File(['hello, world'], 'notes.apkg')), 'not-anki');
  assert.equal(await errorCode(new File([], 'empty.apkg')), 'empty');
  assert.equal(await errorCode(zip64([{ name: 'readme.txt', data: new TextEncoder().encode('hi') }])), 'no-collection');
});

test('gives a clear message for damaged decks', async () => {
  const bytes = await readFile(fixture('modern.apkg'));
  assert.equal(await errorCode(new File([bytes.subarray(0, bytes.length - 900)], 'cut.apkg')), 'not-anki');
  const broken = Uint8Array.from(bytes);
  const entry = (await readZipDirectory(new File([bytes], 'x'))).find((item) => item.name === 'collection.anki21b');
  broken.fill(0x41, entry.localHeaderOffset + 60, entry.localHeaderOffset + 600);
  assert.equal(await errorCode(new File([broken], 'broken.apkg')), 'corrupt');
});

test('never shows the "please update Anki" placeholder as the deck', async () => {
  const file = await open('modern.apkg');
  const entries = await readZipDirectory(file);
  const stub = await readZipEntry(file, entries.find((item) => item.name === 'collection.anki2'));
  assert.equal(await errorCode(zip64([{ name: 'collection.anki2', data: stub }])), 'corrupt');
});

// ---- Tables and CSV ----------------------------------------------------------------------

test('All fields: one row per note, field names as headers, cards first and extras last', async () => {
  const all = await deck('modern.apkg');
  const table = buildTable(all);
  // Five note types: columns are positional (as in Anki's own export), named where it stays readable.
  assert.deepEqual(table.header, ['Field 1', 'Field 2', 'Example / Header', 'Audio / Back Extra', 'Comments', 'Tags', 'Deck', 'Note type']);
  assert.equal(table.rows.length, 11);
  assert.deepEqual(table.rows[6], ['Allele', 'A version of a gene', 'Brown vs. blue eye alleles', '', '', 'bio::genetics', 'Biology::Genetics', 'Vocab']);
  const vocab = all.noteTypes.find((type) => type.name === 'Vocab');
  assert.deepEqual(buildTable(all, { typeId: vocab.id }).header, ['Word', 'Meaning', 'Example', 'Audio', 'Tags']);
  const cells = buildTable(all, { deckName: 'Biology::Cells' });
  assert.deepEqual(cells.header.slice(0, 2), ['Front / Text / Occlusion', 'Back / Back Extra / Image']);
  const single = buildTable(await deck('subdeck-only.apkg'), { deckName: 'Biology::Genetics' });
  assert.equal(single.header[0], 'Front / Word');
});

test('a single note type uses its own field names and no note-type column', async () => {
  const example = await readAnkiFile(new File([await readFile(new URL('../apkg-to-csv/example.apkg', import.meta.url))], 'example.apkg'));
  const basicOnly = { ...example, notes: example.notes.filter((note) => !note.fields[0].includes('{{c')) };
  assert.deepEqual(buildTable(basicOnly).header, ['Front', 'Back', 'Tags']);
});

test('CSV keeps commas, quotes, line breaks and accents (exact output)', async () => {
  const table = buildTable(await deck('modern.apkg'), { mode: 'cards', deckName: 'Biology::Cells' });
  assert.equal(toCsv(table), [
    'Front,Back,Tags',
    'What organelle makes most of a cell’s ATP?,The mitochondrion,bio::cells high-yield',
    '"Quote ""this"", then a comma, please","Line one\nLine two\nLine three",edge',
    '"Café, naïve & résumé — 中文 ✓",Accents & entities <ok> here,',
    'Osmosis,Movement of water across a semipermeable membrane,bio::cells',
    '[…] make ATP.,Mitochondria,bio::cells',
    'Mitochondria make […].,ATP,bio::cells',
    'The [organelle] holds DNA.,nucleus,',
    ''
  ].join('\r\n'));
  assert.equal(table.skipped, 1, 'the image occlusion note makes no text card');
});

test('TSV quotes tabs, quotes and line breaks', () => {
  const tsv = toTsv({ header: ['Front', 'Back'], rows: [['a\tb', 'say "hi"'], ['one\ntwo', 'plain']] });
  assert.equal(tsv, 'Front\tBack\r\n"a\tb"\t"say ""hi"""\r\n"one\ntwo"\tplain\r\n');
});

test('Keep HTML exports the fields exactly as Anki stores them', async () => {
  const table = buildTable(await deck('modern.apkg'), { html: true });
  assert.equal(table.rows[0][1], 'The <b>mitochondrion</b>');
  assert.equal(table.rows[2][1], 'Accents &amp; entities &lt;ok&gt;&nbsp;here');
  const cards = buildTable(await deck('modern.apkg'), { mode: 'cards', html: true });
  assert.ok(cards.rows.some((row) => row[0] === 'Label this diagram' && row[1] === '<img src="cell.png">'), 'image-only backs are kept with HTML');
});

test('Front & back makes the same cards as the same3le app does from the deck', async () => {
  const all = await deck('modern.apkg');
  const squash = (text) => text.replace(/\s+/g, ' ').trim();
  for (const note of all.notes) {
    if (note.fields[0].includes('image-occlusion')) continue;
    const ours = noteCards(note).map((card) => [squash(card.front), squash(card.back)]);
    const app = cardsFromAnkiFields([note.fields.join('\x1f')]).map((card) => [squash(card.question), squash(card.answer)]);
    assert.deepEqual(ours, app, note.fields[0]);
  }
});

test('plain text keeps Anki line breaks and drops media markup', () => {
  assert.equal(plainText('One<div>Two</div><div>Three</div>'), 'One\nTwo\nThree');
  assert.equal(plainText('Hear it [sound:a.mp3]<img src="x.png">'), 'Hear it');
  assert.equal(plainText('<ul><li>alpha</li><li>beta</li></ul>'), '• alpha\n• beta');
});

test('the fast cleaning path matches the app’s cleanAnkiText exactly', () => {
  const pieces = ['Line', ' ', '\n', '\t', '<br>', '<br/>', '<BR >', '<div>', '</div>', '<p class="x">', '</p>', '<li>', '</li>',
    '<ul>', '</ul>', '<b>', '</b>', '<img src="a.png">', '<img alt="diagram" src="b.png">', "<img alt='x'>", '[sound:a.mp3]',
    'é', '中', '\u00a0', '  ', '<span style="color:red">', '</span>', '<h2>', '</h2>', 'text', ',', '"', '<', '>', '[', ']'];
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const block = /<(?:div|p|li|tr|h[1-6]|ul|ol|table|blockquote)\b/gi;
  for (let index = 0; index < 3000; index += 1) {
    const text = Array.from({ length: 1 + Math.floor(random() * 16) }, () => pieces[Math.floor(random() * pieces.length)]).join('');
    assert.equal(plainText(text), cleanAnkiText(text.replace(block, '<br>$&')), JSON.stringify(text));
  }
});

test('deck filter includes subdecks', async () => {
  const all = await deck('modern.apkg');
  assert.equal(buildTable(all, { deckName: 'Biology::Genetics' }).rows.length, 4);
  assert.equal(buildTable(all, { deckName: 'Biology' }).rows.length, 11);
  assert.equal(buildTable(all, { deckName: 'Biology::Genetics' }).header.includes('Deck'), false);
});

test('describes the deck honestly: note types, decks, tags, images and audio', async () => {
  const summary = describeDeck(await deck('modern.apkg'));
  assert.equal(summary.noteCount, 11);
  assert.equal(summary.studyCards, 9);
  assert.equal(summary.images, 1);
  assert.equal(summary.sounds, 1);
  assert.deepEqual(summary.decks.map((item) => `${item.name}:${item.count}`), ['Biology:11', 'Biology::Cells:7', 'Biology::Genetics:4']);
  assert.equal(summary.noteTypes[0].name, 'Basic');
});

test('Quizlet text: tab between term and definition, one card per line', async () => {
  const text = toQuizletText(await deck('modern.apkg'), { deckName: 'Biology::Cells' });
  const lines = text.split('\n');
  assert.equal(lines.length, 7);
  assert.equal(lines[1], 'Quote "this", then a comma, please\tLine one / Line two / Line three');
  assert.ok(lines.every((line) => line.split('\t').length === 2));
});

test('the study handoff is read back by the app’s own paste parser, and big decks are cut cleanly', async () => {
  const all = await deck('modern.apkg');
  const full = studyHandoff(all);
  assert.equal(full.count, 9);
  assert.equal(parsePastedQuestions(full.text).cards.length, 9);
  const cut = studyHandoff(all, { maxChars: 150 });
  assert.ok(cut.count >= 1 && cut.count < 9);
  assert.equal(cut.total, 9);
  assert.ok(cut.text.length <= 150);
  assert.equal(parsePastedQuestions(cut.text).cards.length, cut.count);
  assert.equal(studyHandoff(all, { maxCards: 3 }).count, 3);
});
