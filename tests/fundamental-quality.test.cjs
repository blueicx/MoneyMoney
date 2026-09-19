const test = require('node:test');
const assert = require('node:assert/strict');

const { buildFundamentalFactors } = require('../dist/features/fundamental-quality.js');

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
