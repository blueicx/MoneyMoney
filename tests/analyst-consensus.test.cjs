const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAnalystActionSummary } = require('../dist/features/analyst-consensus.js');

test('分析师动态生成可追溯的结构化事实摘要', () => {
  const action = {
    firm: 'Northstar Research',
    analyst: 'Li Wei',
    date: '2026-09-12',
    action: 'upgrade',
    actionZh: '上调',
    ratingNew: 'Buy',
    ratingOld: 'Hold',
    targetNow: 350,
    targetOld: 315,
    analystRankPct: 12,
  };
  const summary = buildAnalystActionSummary(action);
  assert.match(summary, /Li Wei/);
  assert.match(summary, /Northstar Research/);
  assert.match(summary, /上调/);
  assert.match(summary, /Hold.*Buy/);
  assert.match(summary, /315.*350/);
});

test('没有观点原文时不伪造引用文本', () => {
  const action = {
    firm: 'Northstar Research',
    analyst: 'Li Wei',
    date: '2026-09-12',
    action: 'maintain',
    actionZh: '维持',
    ratingNew: 'Buy',
    ratingOld: 'Buy',
    targetNow: null,
    targetOld: null,
    analystRankPct: null,
  };
  assert.equal(action.sourceExcerpt ?? null, null);
  assert.doesNotMatch(buildAnalystActionSummary(action), /表示|认为|预计/);
});
