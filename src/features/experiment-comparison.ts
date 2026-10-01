import { assertMarketContext } from './research-contracts';
import type { ResearchExperimentResult } from './experiment-runner';

export function compareExperiments(input: ResearchExperimentResult[]) {
  if (input.length < 2 || input.length > 6) throw new Error('请选择2–6个实验');
  const ids = input.map(row => row.experiment.id);
  if (new Set(ids).size !== ids.length) throw new Error('实验选择重复');
  if (new Set(input.map(row => row.experiment.market)).size !== 1) throw new Error('仅允许比较同一市场的实验');
  for (const row of input) assertMarketContext({ ...row.experiment, workspace: 'experiment-comparison' });
  const fields = ['instrument', 'timeframe', 'strategyId', 'strategyVersion', 'dataFrom', 'dataTo', 'dataSource', 'dataSnapshotHash', 'feeRate', 'slippage', 'seed'] as const;
  const differences = fields.flatMap(field => {
    const values = input.map(row => ({ id: row.experiment.id, value: row.experiment[field] ?? null }));
    return new Set(values.map(row => JSON.stringify(row.value))).size > 1 ? [{ field, values }] : [];
  });
  return {
    market: input[0].experiment.market,
    experiments: input.map(row => {
      let peak = 0;
      const equityCurve = row.backtest.equityCurve;
      return { ...row.experiment, metrics: row.backtest.metrics, equityCurve,
        drawdownCurve: equityCurve.map(value => { peak = Math.max(peak, value); return peak > 0 ? Number(((value / peak - 1) * 100).toFixed(6)) : null; }),
        trades: row.backtest.trades, totalFees: row.backtest.totalFees ?? null, totalSlippage: row.backtest.totalSlippage ?? null,
        outOfSample: row.evidence.outOfSample, folds: row.folds,
        freshnessReason: row.experiment.dataTo ? '历史实验；数据时间不代表当前行情' : '未声明数据截止时间' };
    }), differences, ranking: null,
    warnings: differences.some(row => ['dataFrom', 'dataTo', 'feeRate', 'slippage'].includes(row.field)) ? ['区间或成本模型不同，不可直接按收益排名'] : [],
    reason: '展示原始实验结果；未对不同配置自动排名',
  };
}
