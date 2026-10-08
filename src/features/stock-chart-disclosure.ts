export interface StockChartAdjustmentEvidence {
  forwardAvailable?: boolean;
  forwardReason?: string;
  volumeBasis?: 'source';
}

export function stockChartAdjustmentRequestReason(
  requested: string,
  context: { asOf?: boolean; tradingDate?: boolean; paginated?: boolean } = {},
): string | null {
  if (requested === 'source') return null;
  if (requested === 'backward') return '当前没有可核验的后复权口径';
  if (requested !== 'forward') return '不支持的股票K线价格口径';
  if (context.asOf) return '历史时点只允许读取当时已保存的来源价格；不能用当前 Adj Close 回算，否则会引入未来数据';
  if (context.tradingDate) return '指定交易日的日内数据没有完整可核验的 Adj Close 对齐序列，前复权不可用';
  if (context.paginated) return '来源历史分页无法保证所有分页使用同一 Adj Close 参考基准，前复权不可用';
  return null;
}

/** Adjustment disclosure is backed by stored source metadata or a complete, aligned Yahoo Adj Close series. */
export function stockChartDisclosure(
  rows: { time: number }[],
  requested = 'source',
  declared?: string,
  evidence: StockChartAdjustmentEvidence = {},
) {
  const sourceActual=declared?.trim()||'unknown';
  const available=sourceActual==='unknown'||sourceActual==='mixed'?['source']:['source',sourceActual];
  if (evidence.forwardAvailable) available.push('forward');
  if(!available.includes(requested))throw new Error('当前来源没有可核验的 '+requested+' 复权数据；保持来源口径，不猜测转换');
  const times=rows.map(row=>row.time).filter(Number.isFinite);
  const forwardSelected=requested==='forward';
  const reason=forwardSelected
    ? '前复权：'+(evidence.forwardReason||'按 Yahoo Adj Close 系数派生 OHLC；成交量保持来源原值')
    : sourceActual==='unknown'
      ? '来源未声明复权口径；'+(evidence.forwardReason||'前/后复权转换不可用')
      : sourceActual==='mixed'
        ? '历史分区口径混合，禁止复权转换'
        : '使用分区已声明口径；未进行额外转换'+(evidence.forwardAvailable?'；当前来源另提供可切换的 Yahoo Adj Close 系数派生前复权':'');
  return {
    adjustment: {
      requested,
      actual: forwardSelected ? 'yahoo-adjclose-factor-derived' : sourceActual,
      sourceActual,
      available,
      conversionEnabled: forwardSelected && Boolean(evidence.forwardAvailable),
      volumeBasis: forwardSelected ? (evidence.volumeBasis || 'source') : undefined,
      reason,
    },
    coverage:{from:times.length?Math.min(...times):null,to:times.length?Math.max(...times):null,records:times.length},
  };
}
