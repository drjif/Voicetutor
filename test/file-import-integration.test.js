import test from 'node:test';
import assert from 'node:assert/strict';

import { parseStudyFile } from '../file-import.js';

const APKG_BASE64 = [
  'UEsDBBQAAAAAACRKD13V1w/eAAQAAAAEAAAQAAAAY29sbGVjdGlvbi5hbmtpMlNRTGl0ZSBmb3JtYXQgMwACAAEBAEAgIAAAAAMA',
  'AAACAAAAAAAAAAAAAAACAAAABAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAuenENAAAA',
  'AQDhAADhAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIIcAQcXFxcBhBd0YWJsZW5vdGVzbm90ZXMCQ1JF',
  'QVRFIFRBQkxFIG5vdGVzICgKaWQgaW50ZWdlciBwcmltYXJ5IGtleSwgZ3VpZCB0ZXh0IG5vdCBudWxsLCBtaWQgaW50ZWdlciBu',
  'b3QgbnVsbCwgbW9kIGludGVnZXIgbm90IG51bGwsCnVzbiBpbnRlZ2VyIG5vdCBudWxsLCB0YWdzIHRleHQgbm90IG51bGwsIGZs',
  'ZHMgdGV4dCBub3QgbnVsbCwgc2ZsZCBpbnRlZ2VyIG5vdCBudWxsLApjc3VtIGludGVnZXIgbm90IG51bGwsIGZsYWdzIGludGVn',
  'ZXIgbm90IG51bGwsIGRhdGEgdGV4dCBub3QgbnVsbAopDQAAAAIBlQABzQGVAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANgIMABEJCAgNXQgI',
  'CA1nMlRoZSBjYXBpdGFsIG9mIEZyYW5jZSBpcyB7e2MxOjpQYXJpc319Lh8xAQwAEQkICA1TCAgIDWcxV2hhdCBpcyBBVFA/H0Fk',
  'ZW5vc2luZSB0cmlwaG9zcGhhdGVQSwECFAMUAAAAAAAkSg9d1dcP3gAEAAAABAAAEAAAAAAAAAAAAAAAgAEAAAAAY29sbGVjdGlv',
  'bi5hbmtpMlBLBQYAAAAAAQABAD4AAAAuBAAAAAA='
].join('');

const XLSX_BASE64 = 'UEsDBBQAAAAAACJKD1364PfUDwEAAA8BAAAPAAAAeGwvd29ya2Jvb2sueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHdvcmtib29rIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvc3ByZWFkc2hlZXRtbC8yMDA2L21haW4iIHhtbG5zOnI9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L3JlbGF0aW9uc2hpcHMiPgo8c2hlZXRzPjxzaGVldCBuYW1lPSJRdWVzdGlvbnMiIHNoZWV0SWQ9IjEiIHI6aWQ9InJJZDEiLz48L3NoZWV0cz48L3dvcmtib29rPlBLAwQUAAAAAAAiSg9d1JtlDRoBAAAaAQAAGgAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPFJlbGF0aW9uc2hpcHMgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9wYWNrYWdlLzIwMDYvcmVsYXRpb25zaGlwcyI+CjxSZWxhdGlvbnNoaXAgSWQ9InJJZDEiIFR5cGU9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L3JlbGF0aW9uc2hpcHMvd29ya3NoZWV0IiBUYXJnZXQ9IndvcmtzaGVldHMvc2hlZXQxLnhtbCIvPgo8L1JlbGF0aW9uc2hpcHM+UEsDBBQAAAAAACJKD11TMZ6v0wIAANMCAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHdvcmtzaGVldCB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3NwcmVhZHNoZWV0bWwvMjAwNi9tYWluIj48c2hlZXREYXRhPgo8cm93IHI9IjEiPjxjIHI9IkExIiB0PSJpbmxpbmVTdHIiPjxpcz48dD5RdWVzdGlvbjwvdD48L2lzPjwvYz48YyByPSJCMSIgdD0iaW5saW5lU3RyIj48aXM+PHQ+QW5zd2VyPC90PjwvaXM+PC9jPjxjIHI9IkMxIiB0PSJpbmxpbmVTdHIiPjxpcz48dD5BY2NlcHRlZCBhbHRlcm5hdGl2ZXM8L3Q+PC9pcz48L2M+PC9yb3c+Cjxyb3cgcj0iMiI+PGMgcj0iQTIiIHQ9ImlubGluZVN0ciI+PGlzPjx0PkNhcGl0YWwgb2YgRnJhbmNlPzwvdD48L2lzPjwvYz48YyByPSJCMiIgdD0iaW5saW5lU3RyIj48aXM+PHQ+UGFyaXM8L3Q+PC9pcz48L2M+PGMgcj0iQzIiIHQ9ImlubGluZVN0ciI+PGlzPjx0PkNpdHkgb2YgUGFyaXM8L3Q+PC9pcz48L2M+PC9yb3c+Cjxyb3cgcj0iMyI+PGMgcj0iQTMiIHQ9ImlubGluZVN0ciI+PGlzPjx0PldoYXQgaG9ybW9uZSBsb3dlcnMgZ2x1Y29zZT88L3Q+PC9pcz48L2M+PGMgcj0iQjMiIHQ9ImlubGluZVN0ciI+PGlzPjx0Pkluc3VsaW48L3Q+PC9pcz48L2M+PGMgcj0iQzMiIHQ9ImlubGluZVN0ciI+PGlzPjx0Pmluc3VsaW4gaG9ybW9uZTwvdD48L2lzPjwvYz48L3Jvdz4KPC9zaGVldERhdGE+PC93b3Jrc2hlZXQ+UEsBAhQDFAAAAAAAIkoPXfrg99QPAQAADwEAAA8AAAAAAAAAAAAAAIABAAAAAHhsL3dvcmtib29rLnhtbFBLAQIUAxQAAAAAACJKD13Um2UNGgEAABoBAAAaAAAAAAAAAAAAAACAATwBAAB4bC9fcmVscy93b3JrYm9vay54bWwucmVsc1BLAQIUAxQAAAAAACJKD11TMZ6v0wIAANMCAAAYAAAAAAAAAAAAAACAAY4CAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxQSwUGAAAAAAMAAwDLAAAAlwUAAAAA';

function fakeBinaryFile(name, base64) {
  const bytes = Buffer.from(base64, 'base64');
  return {
    name,
    size: bytes.length,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    async text() {
      return bytes.toString('utf8');
    }
  };
}

test('parses a real minimal .xlsx package end-to-end', async () => {
  const parsed = await parseStudyFile(fakeBinaryFile('questions.xlsx', XLSX_BASE64));

  assert.equal(parsed.mode, 'rows');
  assert.equal(parsed.sourceKind, 'xlsx');
  assert.equal(parsed.hasHeaders, true);
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(parsed.rows[0].slice(0, 3), ['Question', 'Answer', 'Accepted alternatives']);
  assert.deepEqual(parsed.rows[1].slice(0, 3), ['Capital of France?', 'Paris', 'City of Paris']);
});

test('parses a legacy .apkg package end-to-end into basic and cloze cards', async () => {
  const parsed = await parseStudyFile(fakeBinaryFile('sample.apkg', APKG_BASE64));

  assert.equal(parsed.mode, 'cards');
  assert.equal(parsed.sourceKind, 'anki');
  assert.equal(parsed.cards.length, 2);

  const basic = parsed.cards.find((item) => item.question === 'What is ATP?');
  assert.equal(basic?.answer, 'Adenosine triphosphate');

  const cloze = parsed.cards.find((item) => item.question === 'The capital of France is […].');
  assert.equal(cloze?.answer, 'Paris');
});
