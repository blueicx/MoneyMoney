const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { runScenario } = require('../dist/features/decision-intelligence.js');

test('scenario engine applies rate and funding shocks with explicit exposure inputs', () => {
  const scenario = {
    id: 'multi-factor-shock',
    name: '多变量压力测试',
    market: 'crypto',
    shocks: [
      { target: 'rate', kind: 'rateBps', value: 100 },
      { target: 'funding', kind: 'fundingPct', value: 2 },
    ],
  };
  const positions = [{
    instrument: 'BTCUSDT', market: 'crypto', quantity: 1, price: 1000,
    rateDuration: 2, fundingBeta: 1.5, probabilitySensitivity: 0.5,
  }];
  const result = runScenario(scenario, positions);
  assert.equal(result.kind, 'stress-test');
  assert.equal(result.impact.totalValueBefore, 1000);
  assert.equal(result.impact.totalValueAfter, 950);
  assert.match(result.disclaimer, /压力测试/);
});

test('scenario engine applies probability shocks only to prediction exposures', () => {
  const result = runScenario({
    id: 'probability-reprice', name: '概率重估', market: 'prediction',
    shocks: [{ target: 'probability', kind: 'probabilityPp', value: -10 }],
  }, [{ instrument: 'prediction:demo', market: 'prediction', quantity: 100, price: 0.5, probabilitySensitivity: 1 }]);
  assert.equal(result.impact.totalValueBefore, 50);
  assert.equal(result.impact.totalValueAfter, 45);
});

test('portfolio import UI previews rows before committing them', () => {
  const source = fs.readFileSync('src/web/public/index.html', 'utf8');
  assert.match(source, /commit:\s*false/);
  assert.match(source, /commitPortfolioCsv\(\)/);
  assert.match(source, /确认写入/);
  assert.match(source, /portfolioHeaderAlias|字段映射/);
});

test('private decision, portfolio and workspace routes enforce admin access', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  for (const route of [
    "app.get('/api/decisions'",
    "app.get('/api/portfolio/analytics'",
    "app.get('/api/workspaces'",
  ]) {
    const start = server.indexOf(route);
    assert.ok(start >= 0, `missing ${route}`);
    const block = server.slice(start, start + 900);
    assert.match(block, /adminOnly\(req, res\)/, `private route must enforce admin access: ${route}`);
  }
});

test('evidence changes are visible in the decision workspace and use a per-market seen marker', () => {
  const source = fs.readFileSync('src/web/public/index.html', 'utf8');
  assert.match(source, /renderDecisionEvidenceChanges/);
  assert.match(source, /\/api\/evidence\/changes/);
  assert.match(source, /mm-evidence-seen/);
  assert.match(source, /自上次查看以来/);
});
