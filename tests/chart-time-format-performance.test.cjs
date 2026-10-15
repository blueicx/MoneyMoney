const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
const ast = ts.createSourceFile('runtime.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = ast.statements.filter(row => ts.isFunctionDeclaration(row) && ['formatChartTime', 'formatStockKlineTime', 'stockKlineIsIntraday'].includes(row.name?.text)).map(row => source.slice(row.getStart(ast), row.end)).join('\n');
function runtime() {
  const counts = { constructs: 0 };
  const context = vm.createContext({ Intl: { DateTimeFormat: function (...args) { counts.constructs++; return new Intl.DateTimeFormat(...args); } } });
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
  context.currentStockKlinePeriod = '1d';
  assert.equal(context.formatStockKlineTime('2026-10-15T00:00:00Z'), '2026-10-15');
  assert.equal(context.formatStockKlineTime('invalid'), '--');
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
