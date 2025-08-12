import test from 'node:test';
import assert from 'node:assert/strict';
import { excelToDate } from '../utils/excelToDate.js';

test('converts Excel serial numbers to Date objects', () => {
  const d = excelToDate(45239);
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString().slice(0,10), '2023-11-09');
});

test('parses date strings without time portion', () => {
  const d = excelToDate('2023-11-09');
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString().slice(0,10), '2023-11-09');
});

test('parses date strings with time portion', () => {
  const d = excelToDate('2023-11-09 13:45');
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString().slice(0,10), '2023-11-09');
});

test('returns null for invalid or empty inputs', () => {
  assert.equal(excelToDate(''), null);
  assert.equal(excelToDate(null), null);
  assert.equal(excelToDate('not-a-date'), null);
});
