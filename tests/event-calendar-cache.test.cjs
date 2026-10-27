const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-calendar-cache-'));
process.env.MONEYMONEY_DATA_DIR = dataDir;
const macro = require('../dist/features/external-market-data');
const earnings = require('../dist/features/earnings-calendar');
const translation = require('../dist/features/market-translation');
const originals = { macro: macro.getMacroCalendar, earnings: earnings.getEarningsCalendar, translation: translation.translateEnglishTitles };
let macroCalls = 0, earningsCalls = 0, gate = null;
macro.getMacroCalendar = async () => { macroCalls++; return { source: 'fixture', fetchedAt: new Date().toISOString(), events: [], stale: false }; };
earnings.getEarningsCalendar = async date => { earningsCalls++; if (gate) await gate; return { source: 'fixture', fetchedAt: new Date().toISOString(), date, items: [], count: 0 }; };
translation.translateEnglishTitles = async () => new Map();
const { getUpcomingEventCalendar } = require('../dist/features/event-calendar');
const spanDays = result => (Date.parse(`${result.endDate}T00:00:00Z`) - Date.parse(`${result.startDate}T00:00:00Z`)) / 86400000;

test('a same-day calendar of the requested horizon is reused, but a different horizon and force refresh are not', async () => {
  const first = await getUpcomingEventCalendar(7);
  const second = await getUpcomingEventCalendar(7);
  assert.equal(spanDays(first), 7);
  assert.equal(spanDays(second), 7);
  assert.equal(macroCalls, 1, 'the second read should reuse the calendar rather than recrawl sources');
  assert.equal(earningsCalls, 7);
  const shorter = await getUpcomingEventCalendar(3);
  assert.equal(spanDays(shorter), 3);
  assert.equal(macroCalls, 2);
  assert.equal(earningsCalls, 10);
  await getUpcomingEventCalendar(3, true);
  assert.equal(macroCalls, 3, 'explicit refresh must not reuse the cached result');
  assert.equal(earningsCalls, 13);
});

test('an expired matching calendar is labeled stale while one refresh runs in the background', async () => {
  const fresh = await getUpcomingEventCalendar(3, true);
  const originalNow = Date.now;
  Date.now = () => originalNow() + 300001;
  let release;
  gate = new Promise(resolve => { release = resolve; });
  const beforeMacro = macroCalls, beforeEarnings = earningsCalls;
  try {
    const pending = getUpcomingEventCalendar(3);
    const observed = await Promise.race([pending.then(value => ({ value })), new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 200))]);
    if (observed.timedOut) { release(); await pending; assert.fail('stale data should not wait for slow sources'); }
    assert.equal(observed.value.stale, true);
    assert.equal(observed.value.fetchedAt, fresh.fetchedAt);
    assert.equal(observed.value.sourceStatus.earnings, 'cached');
    assert.equal(observed.value.sourceStatus.macro, 'cached');
    const again = await getUpcomingEventCalendar(3);
    assert.equal(again.stale, true);
    assert.equal(macroCalls - beforeMacro, 1, 'concurrent stale reads coalesce their refresh');
    assert.equal(earningsCalls - beforeEarnings, 3);
    const refresh = getUpcomingEventCalendar(3, true);
    release();
    const updated = await refresh;
    assert.notEqual(updated.stale, true);
  } finally { release(); gate = null; Date.now = originalNow; }
});

test('stale serving preserves partial source status and its reason', async () => {
  const originalEarnings = earnings.getEarningsCalendar;
  let count = 0;
  earnings.getEarningsCalendar = async date => {
    if (++count === 1) throw new Error('fixture source failure');
    return originalEarnings(date);
  };
  const partial = await getUpcomingEventCalendar(2, true);
  earnings.getEarningsCalendar = originalEarnings;
  assert.equal(partial.sourceStatus.earnings, 'partial');
  assert.ok(partial.sourceReasons.earnings);
  const originalNow = Date.now;
  Date.now = () => originalNow() + 300001;
  let release;
  gate = new Promise(resolve => { release = resolve; });
  try {
    const stale = await getUpcomingEventCalendar(2);
    assert.equal(stale.stale, true);
    assert.equal(stale.sourceStatus.earnings, 'partial');
    assert.match(stale.sourceReasons.earnings, /部分|失败/);
    assert.match(stale.sourceReasons.earnings, /过期/);
    const refresh = getUpcomingEventCalendar(2, true);
    release(); await refresh;
  } finally { release(); gate = null; Date.now = originalNow; earnings.getEarningsCalendar = originalEarnings; }
});

test('a calendar older than the maximum stale age is not returned while its source refresh is pending', async () => {
  await getUpcomingEventCalendar(2, true);
  const originalNow = Date.now;
  Date.now = () => originalNow() + 3 * 24 * 60 * 60 * 1000 + 1000;
  let release;
  gate = new Promise(resolve => { release = resolve; });
  try {
    const pending = getUpcomingEventCalendar(2);
    const observed = await Promise.race([pending.then(() => 'returned'), new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]);
    release();
    await pending;
    assert.equal(observed, 'waiting', 'over-age evidence cannot be served as a valid cached calendar');
  } finally { release(); gate = null; Date.now = originalNow; }
});

test('overlapping requests for different horizons do not share the wrong calendar', async () => {
  let release;
  gate = new Promise(resolve => { release = resolve; });
  const beforeMacro = macroCalls, beforeEarnings = earningsCalls;
  const first = getUpcomingEventCalendar(4, true);
  const second = getUpcomingEventCalendar(6, true);
  release();
  const [four, six] = await Promise.all([first, second]);
  gate = null;
  assert.equal(spanDays(four), 4);
  assert.equal(spanDays(six), 6);
  assert.equal(macroCalls - beforeMacro, 2);
  assert.equal(earningsCalls - beforeEarnings, 10);
});

test('overlapping requests for the same horizon share one source refresh', async () => {
  let release;
  gate = new Promise(resolve => { release = resolve; });
  const beforeMacro = macroCalls, beforeEarnings = earningsCalls;
  const first = getUpcomingEventCalendar(5, true);
  const second = getUpcomingEventCalendar(5, true);
  release();
  const [left, right] = await Promise.all([first, second]);
  gate = null;
  assert.equal(spanDays(left), 5);
  assert.equal(spanDays(right), 5);
  assert.equal(macroCalls - beforeMacro, 1);
  assert.equal(earningsCalls - beforeEarnings, 5);
});

test('disk fallback preserves partial source evidence and rejects a different horizon', async () => {
  const originalEarnings = earnings.getEarningsCalendar, originalMacro = macro.getMacroCalendar;
  let count = 0;
  try {
    earnings.getEarningsCalendar = async date => {
      if (++count === 1) throw new Error('fixture source failure');
      return originalEarnings(date);
    };
    macro.getMacroCalendar = async () => { throw new Error('fixture macro unavailable'); };
    const partial = await getUpcomingEventCalendar(3, true);
    assert.equal(partial.sourceStatus.earnings, 'partial');
    assert.equal(partial.sourceStatus.macro, 'unavailable');
    earnings.getEarningsCalendar = originalEarnings;
    macro.getMacroCalendar = async () => ({ events: {}, fetchedAt: new Date().toISOString(), stale: false });
    const fallback = await getUpcomingEventCalendar(3, true);
    assert.equal(fallback.stale, true);
    assert.equal(fallback.sourceStatus.earnings, 'partial');
    assert.equal(fallback.sourceStatus.macro, 'unavailable');
    assert.match(fallback.sourceReasons.earnings, /失败/);
    await assert.rejects(getUpcomingEventCalendar(4, true), 'a three-day disk snapshot cannot represent four days');
  } finally { earnings.getEarningsCalendar = originalEarnings; macro.getMacroCalendar = originalMacro; }
});

test.after(() => {
  macro.getMacroCalendar = originals.macro; earnings.getEarningsCalendar = originals.earnings;
  translation.translateEnglishTitles = originals.translation;
  try { require('../dist/storage/sqlite-state').stateStore.close(); } catch {}
  fs.rmSync(dataDir, { recursive: true, force: true });
});
