const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { buildAnalystActionSummary, parseRecentAnalystActions } = require('../dist/features/analyst-consensus.js');
const source = fs.readFileSync('src/features/analyst-consensus.ts', 'utf8');

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

test('兼容当前 StockAnalysis ratings payload 的对象闭合标记', () => {
  assert.match(source, /rawHtml\.includes\('\}\]\},ratings:\['\)/);
  assert.match(source, /extractSerialized\(rawHtml, '\}\]\},ratings:\['/);
});

test('从 ratings 数组提取分析师姓名、机构和目标价', () => {
  const raw = 'foo:{}]},ratings:[{action_rt:"Reiterates",pt_now:380,pt_old:null,firm:"Maxim Group",analyst:"Tom Forte",date:"2026-09-11",rating_new:"Buy",rating_old:""}],forecastDivider:null}';
  const actions = parseRecentAnalystActions(raw, 'https://stockanalysis.com/stocks/aapl/forecast/');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].analyst, 'Tom Forte');
  assert.equal(actions[0].firm, 'Maxim Group');
  assert.equal(actions[0].targetNow, 380);
});
