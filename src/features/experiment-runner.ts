import { calculateBacktestMetrics, createWalkForwardFolds, type BacktestMetrics, type WalkForwardFold } from './backtest-analysis';
import { BacktestEngine, type BacktestResult, type BacktestSignal } from './backtest-engine';
import { assertMarketContext, createExperimentRecord, type ExperimentRecord, type MarketContext } from './research-contracts';

export interface ExperimentPromotionRules {
  minOutOfSampleReturnPct?: number;
  minTrades?: number;
}

export interface ResearchExperimentInput {
  context: MarketContext & {
    strategyId?: string; strategyVersion?: string; dataSource?: string;
    dataFrom?: string; dataTo?: string; feeRate?: number; slippage?: number; seed?: number;
  };
  prices: number[];
  signals: readonly BacktestSignal[];
  split?: { trainSize?: number; testSize?: number; step?: number; purge?: number; embargo?: number };
  promotion?: ExperimentPromotionRules;
}

export interface ExperimentEvidence {
  summary: string;
  checks: { futureData: { passed: boolean; detail: string }; marketScope: { passed: boolean; detail: string }; data: { passed: boolean; detail: string } };
  outOfSample: BacktestMetrics;
  generatedAt: string;
}

export interface PromotionGate {
  passed: boolean;
  status: 'draft' | 'candidate';
  monitoringAllowed: false;
  reasons: string[];
}

export interface ResearchExperimentResult {
  experiment: ExperimentRecord;
  backtest: BacktestResult;
  folds: WalkForwardFold[];
  evidence: ExperimentEvidence;
  gate: PromotionGate;
}

function outOfSampleMetrics(result: BacktestResult, folds: readonly WalkForwardFold[], startingBalance: number): BacktestMetrics {
  const indexes = new Set<number>();
  folds.forEach(fold => { for (let index = fold.testStart; index <= fold.testEnd; index += 1) indexes.add(index); });
  const trades = result.trades.filter(trade => indexes.has(trade.timeIndex));
  const equity = [startingBalance];
  trades.forEach(trade => equity.push(equity[equity.length - 1] + trade.pnl));
  return calculateBacktestMetrics({ startingBalance, equityCurve: equity, trades });
}

export function runResearchExperiment(input: ResearchExperimentInput): ResearchExperimentResult {
  const context = assertMarketContext(input.context);
  if (!Array.isArray(input.prices) || !input.prices.length) throw new Error('Experiment prices are required');
  const feeRate = Number(input.context.feeRate ?? 0);
  const slippage = Number(input.context.slippage ?? 0);
  const experiment = createExperimentRecord({
    market: context.market, instrument: context.instrument, timeframe: context.timeframe,
    strategyId: input.context.strategyId, strategyVersion: input.context.strategyVersion,
    dataSource: input.context.dataSource || 'unknown', dataFrom: input.context.dataFrom, dataTo: input.context.dataTo,
    feeRate, slippage, seed: input.context.seed,
  });
  const startingBalance = 100000;
  const backtest = new BacktestEngine({
    marketId: context.market, rules: { maxOpenPositions: 1 }, feeRate, slippage,
    preventFutureData: true, useCache: true, startingBalance,
    experimentContext: {
      marketId: context.market, instrumentId: context.instrument, timeframe: context.timeframe,
      strategyId: input.context.strategyId, strategyVersion: input.context.strategyVersion, dataSource: input.context.dataSource,
      dataFrom: input.context.dataFrom, dataTo: input.context.dataTo, seed: input.context.seed,
    },
  });
  const result = backtest.run(input.prices, input.signals, experiment.id);
  const split = input.split || {};
  const folds = createWalkForwardFolds({
    length: input.prices.length, trainSize: split.trainSize ?? Math.max(1, Math.floor(input.prices.length / 2)),
    testSize: split.testSize ?? Math.max(1, Math.floor(input.prices.length / 4)), step: split.step,
    purge: split.purge, embargo: split.embargo,
  });
  const oos = outOfSampleMetrics(result, folds, startingBalance);
  const evidence: ExperimentEvidence = {
    summary: `研究实验 ${context.market}/${context.instrument || '未指定标的'} · ${context.timeframe || '未指定周期'} · ${result.trades.length} 笔交易`,
    checks: {
      futureData: { passed: !result.lookAheadBiasDetected, detail: result.lookAheadBiasDetected ? '发现超出数据范围的信号' : '未发现未来数据信号' },
      marketScope: { passed: true, detail: `已校验 ${context.market} 市场边界` },
      data: { passed: Boolean(input.context.dataSource), detail: input.context.dataSource ? `数据源：${input.context.dataSource}` : '未声明数据源' },
    },
    outOfSample: oos, generatedAt: experiment.createdAt,
  };
  const rules = input.promotion || {};
  const reasons: string[] = [];
  if (!evidence.checks.futureData.passed) reasons.push('未来数据检查未通过');
  if (!evidence.checks.data.passed) reasons.push('未声明数据源');
  if (oos.totalReturnPct < Number(rules.minOutOfSampleReturnPct ?? -Infinity)) reasons.push('样本外收益未达到门槛');
  if ((oos.tradesCount || 0) < Number(rules.minTrades ?? 0)) reasons.push('样本外交易数未达到门槛');
  const passed = reasons.length === 0;
  return { experiment, backtest: result, folds, evidence, gate: { passed, status: passed ? 'candidate' : 'draft', monitoringAllowed: false, reasons } };
}

import { createArtifactManifest, type ArtifactManifest } from './research-contracts';

export function generateExperimentArtifacts(jobId: string, result: ResearchExperimentResult): { manifests: ArtifactManifest[], files: Record<string, string> } {
  const jsonContent = JSON.stringify(result, null, 2);
  const csvContent = `timeIndex,direction,price,executionPrice,fee,slippage,pnl\n` + result.backtest.trades.map(t => `${t.timeIndex},${t.direction},${t.price},${t.executionPrice},${t.fee},${t.slippage},${t.pnl}`).join('\n');
  const mdContent = `# Experiment ${result.experiment.id}\n\n## Evidence\n${result.evidence.summary}\n\n## Metrics\nTotal Return: ${result.backtest.metrics.totalReturnPct}%\nWin Rate: ${result.backtest.metrics.winRatePct}%`;

  const hashString = (str: string) => {
    let hash = 2166136261;
    for (let index = 0; index < str.length; index += 1) hash = Math.imul(hash ^ str.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16);
  };

  const files = {
    'result.json': jsonContent,
    'trades.csv': csvContent,
    'report.md': mdContent
  };

  const manifests = [
    createArtifactManifest({ id: `art_${jobId}_json`, jobId, hash: hashString(jsonContent), uri: 'file://result.json', createdAt: result.experiment.createdAt }),
    createArtifactManifest({ id: `art_${jobId}_csv`, jobId, hash: hashString(csvContent), uri: 'file://trades.csv', createdAt: result.experiment.createdAt }),
    createArtifactManifest({ id: `art_${jobId}_md`, jobId, hash: hashString(mdContent), uri: 'file://report.md', createdAt: result.experiment.createdAt })
  ];

  return { manifests, files };
}
