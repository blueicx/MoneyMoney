const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
const ast = ts.createSourceFile('runtime.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = ast.statements.filter(row => ts.isFunctionDeclaration(row) && ['formatChartTime', 'formatStockKlineTime', 'stockKlineIsIntraday'].includes(row.name?.text)).map(row => source.slice(row.getStart(ast), row.end)).join('\n');
function runtime() {
  const counts = { constructs: 0, formats: 0 };
  const context = vm.createContext({ Intl: { DateTimeFormat: function (...args) {
    counts.constructs++;
    const formatter = new Intl.DateTimeFormat(...args);
    return { format(value) { counts.formats++; return formatter.format(value); } };
  } } });
  vm.runInContext("var currentStockKlinePeriod='5m', stockChartExchangeTimezone='America/New_York', localeCalls=0; const originalLocale=Date.prototype.toLocaleString; Date.prototype.toLocaleString=function(...args){localeCalls++;return originalLocale.apply(this,args)};" + functions, context);
  return { context, counts };
}
test('chart point labels reuse their formatter without changing local timestamps or missing-value handling', () => {
  const { context, counts } = runtime();
  const value = '2026-10-15T13:45:00Z';
  const expected = new Date(value).toLocaleString('zh-CN', { year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
  for (let i = 0; i < 200; i++) assert.equal(context.formatChartTime(value), expected);
  assert.equal(context.formatChartTime(null), '--');
  assert.equal(context.formatChartTime('not-a-date'), '--');
  assert.equal(vm.runInContext('localeCalls', context), 0, 'point labels must not reconstruct locale formatting on every call');
  assert.equal(counts.constructs, 1);
  assert.equal(counts.formats, 1, 'repeated source times should reuse the formatted value, not just the formatter');
});
test('intraday formatters are keyed by exchange timezone, preserve DST and do not change daily dates', () => {
  const { context, counts } = runtime();
  for (const zone of ['America/New_York', 'Asia/Hong_Kong']) {
    context.stockChartExchangeTimezone = zone;
    for (const value of ['2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z']) {
      const expected = new Intl.DateTimeFormat('zh-CN', { timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(new Date(value)) + ' ' + zone;
      for (let i = 0; i < 50; i++) assert.equal(context.formatStockKlineTime(value), expected);
    }
  }
  assert.equal(counts.constructs, 2, 'reuse one formatter per timezone rather than per point');
  assert.equal(counts.formats, 4, 'each timestamp is formatted once per exchange timezone');
  context.currentStockKlinePeriod = '1d';
  assert.equal(context.formatStockKlineTime('2026-10-15T00:00:00Z'), '2026-10-15');
  assert.equal(context.formatStockKlineTime('invalid'), '--');
});

test('formatted timestamp values are bounded, normalize equivalent inputs and refresh after eviction', () => {
  const { context, counts } = runtime();
  const start = Date.parse('2026-10-15T00:00:00Z');
  const expected = context.formatChartTime(start);
  assert.equal(context.formatChartTime(new Date(start).toISOString()), expected);
  assert.equal(counts.formats, 1);
  for (let i = 1; i <= 600; i++) context.formatChartTime(start + i * 60000);
  const before = counts.formats;
  assert.equal(context.formatChartTime(start), expected);
  assert.equal(counts.formats, before + 1, 'old values are evicted instead of retaining an unbounded session history');
  assert.ok(context.formatChartTime.values.size <= 512);
  context.formatStockKlineTime(start);
  for (let i = 1; i <= 600; i++) context.formatStockKlineTime(start + i * 60000);
  assert.ok(context.formatStockKlineTime.values.size <= 512);
  context.stockChartExchangeTimezone = 'Asia/Hong_Kong';
  const actual = context.formatStockKlineTime(start);
  assert.match(actual, /08:00.*Asia\/Hong_Kong/);
  context.currentStockKlinePeriod = '1d';
  assert.equal(context.formatStockKlineTime(start), '2026-10-15', 'intraday cached labels cannot leak into daily candles');
});
test('exchange formatter cache is bounded and invalid timezones do not poison it', () => {
  const { context } = runtime();
  for (const zone of ['UTC','Asia/Shanghai','Asia/Tokyo','Asia/Hong_Kong','Europe/London','Europe/Paris','America/New_York','America/Chicago','America/Los_Angeles','Australia/Sydney']) {
    context.stockChartExchangeTimezone = zone;
    context.formatStockKlineTime('2026-10-15T00:00:00Z');
  }
  assert.equal(context.formatStockKlineTime.formatters.size, 8);
  context.stockChartExchangeTimezone = 'not-a-timezone';
  assert.throws(() => context.formatStockKlineTime('2026-10-15T00:00:00Z'), RangeError);
  assert.equal(context.formatStockKlineTime.formatters.size, 8);
});
