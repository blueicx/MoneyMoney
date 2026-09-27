const test = require('node:test');
const assert = require('node:assert/strict');

const { buildFundamentalFactors, buildFundamentalSignal, buildQuarterlyFundamentalHistory, summarizeFundamentalTtm } = require('../dist/features/fundamental-quality.js');

test('SEC quarterly facts derive Q4 from the annual filing and build an eight-quarter TTM comparison', () => {
  const tags = {
    RevenueFromContractWithCustomerExcludingAssessedTax: [200, 250, 250, 280, 290, 310],
    NetIncomeLoss: [20, 25, 25, 28, 29, 31],
    NetCashProvidedByUsedInOperatingActivities: [18, 24, 24, 26, 28, 30],
  };
  const facts = { facts: { 'us-gaap': {} } };
  for (const [tag, values] of Object.entries(tags)) {
    const quarterly = [];
    const years = [
      { fy: 2023, dates: [['2023-01-01', '2023-03-31'], ['2023-04-01', '2023-06-30'], ['2023-07-01', '2023-09-30']], annual: values[0] + values[1] + values[2] + (tag === 'RevenueFromContractWithCustomerExcludingAssessedTax' ? 300 : tag === 'NetIncomeLoss' ? 30 : 28) },
      { fy: 2024, dates: [['2024-01-01', '2024-03-31'], ['2024-04-01', '2024-06-30'], ['2024-07-01', '2024-09-30']], annual: values[3] + values[4] + values[5] + (tag === 'RevenueFromContractWithCustomerExcludingAssessedTax' ? 320 : tag === 'NetIncomeLoss' ? 32 : 32) },
    ];
    for (const year of years) {
      for (let q = 0; q < 3; q += 1) quarterly.push({ start: year.dates[q][0], end: year.dates[q][1], val: values[(year.fy - 2023) * 3 + q], form: '10-Q', fp: `Q${q + 1}`, fy: year.fy, filed: `${year.dates[q][1]}T00:00:00Z` });
      quarterly.push({ start: `${year.fy}-01-01`, end: `${year.fy}-12-31`, val: year.annual, form: '10-K', fp: 'FY', fy: year.fy, filed: `${year.fy + 1}-02-20` });
    }
    facts.facts['us-gaap'][tag] = { units: { USD: quarterly } };
  }
  const history = buildQuarterlyFundamentalHistory(facts);
  assert.equal(history.length, 8);
  assert.equal(history.find(row => row.periodKey === '2023:Q4').revenueUsd, 300);
  assert.equal(history.find(row => row.periodKey === '2024:Q4').revenueUsd, 320);
  const ttm = summarizeFundamentalTtm(history);
  assert.equal(ttm.revenueUsd, 1200);
  assert.equal(ttm.priorRevenueUsd, 1000);
  assert.equal(ttm.revenueGrowthPct, 20);
});

test('基本面说明只陈述数据，不给仓位、买卖或追涨指令', () => {
  const result = buildFundamentalSignal(82, {
    revenueGrowthPct: 18, grossMarginPct: 48, operatingMarginPct: 21, netMarginPct: 16,
    operatingCashFlowMarginPct: 19, cashConversionRatio: 1.12, accrualRatioPct: 2,
    currentRatio: 1.8, liabilitiesToAssetsPct: 42, returnOnEquityPct: 24,
  }, 30);
  assert.match(result.adviceZh, /增长|利润率|现金流/);
  assert.doesNotMatch(result.adviceZh, /买入|卖出|仓位|止损|追高/);
});

test('基本面因素按指标生成支持项和风险项', () => {
  const result = buildFundamentalFactors({
    revenueGrowthPct: 18,
    grossMarginPct: 48,
    operatingMarginPct: 21,
    netMarginPct: 16,
    operatingCashFlowMarginPct: 19,
    cashConversionRatio: 1.12,
    accrualRatioPct: 2,
    currentRatio: 1.8,
    liabilitiesToAssetsPct: 42,
    returnOnEquityPct: 24,
  }, 82, 30);
  assert.ok(result.supportingFactors.some(item => item.label.includes('增长')));
  assert.ok(result.supportingFactors.some(item => item.label.includes('现金')));
  assert.equal(result.riskFactors.length, 0);
});

test('基本面因素明确标出现金流、偿债和负债风险', () => {
  const result = buildFundamentalFactors({
    revenueGrowthPct: -8,
    grossMarginPct: 18,
    operatingMarginPct: 3,
    netMarginPct: 2,
    operatingCashFlowMarginPct: -6,
    cashConversionRatio: 0.4,
    accrualRatioPct: 14,
    currentRatio: 0.82,
    liabilitiesToAssetsPct: 84,
    returnOnEquityPct: -9,
  }, 28, 500);
  assert.ok(result.riskFactors.some(item => item.label.includes('现金')));
  assert.ok(result.riskFactors.some(item => item.label.includes('偿债')));
  assert.ok(result.riskFactors.some(item => item.label.includes('负债')));
  assert.ok(result.riskFactors.some(item => item.label.includes('数据')));
});
