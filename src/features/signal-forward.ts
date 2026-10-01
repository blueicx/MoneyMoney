import { assertMarketContext } from './research-contracts';
import type { SignalOutcome } from './decision-intelligence';
export function observeForwardSignal(signal: Pick<SignalOutcome, 'id' | 'market' | 'instrument' | 'strategyId' | 'strategyVersion' | 'timeframe' | 'source' | 'triggeredAt' | 'entryPrice' | 'expiresAt' | 'experimentId' | 'evidenceRefs'>, bars: Array<{ time: number | string; high: number; low: number; close: number }>, now = Date.now()) {
  assertMarketContext({ market:signal.market, instrument:signal.instrument,workspace:'signal-forward' });
  const duration = ({ '1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000 } as Record<string,number>)[signal.timeframe];
  const base = { id:signal.id,market:signal.market,instrument:signal.instrument,strategyId:signal.strategyId,strategyVersion:signal.strategyVersion || '未关联',timeframe:signal.timeframe,source:signal.source,experimentId:signal.experimentId || null,evidenceRefs:signal.evidenceRefs || [] };
  if (!duration) return { ...base,points:[],dataStatus:'unsupported',reason:'当前周期无法可靠确定K线完成时间',mfePct:null,maePct:null,returnPct:null };
  if (!Number.isFinite(signal.entryPrice) || signal.entryPrice <= 0) throw new Error('信号入场价格无效');
  const until = Math.min(now,signal.expiresAt ?? now);
  const points = bars.map(bar => ({ ...bar,time:typeof bar.time === 'number' ? bar.time : Date.parse(bar.time) })).filter(bar =>
    Number.isFinite(bar.time) && bar.time > signal.triggeredAt && bar.time + duration <= until && [bar.high,bar.low,bar.close].every(value => Number.isFinite(value) && value > 0) && bar.high >= bar.low && bar.close >= bar.low && bar.close <= bar.high)
    .sort((a,b) => a.time - b.time).filter((bar,index,rows) => index === 0 || bar.time !== rows[index-1].time)
    .map(bar => ({ at:new Date(bar.time+duration).toISOString(),returnPct:Number(((bar.close / signal.entryPrice - 1)*100).toFixed(6)),high:bar.high,low:bar.low }));
  return { ...base,points,dataStatus:points.length ? 'historical' : 'empty',reason:points.length ? null : '缺少触发后已完成的真实K线，未生成前向结果',
    mfePct:points.length ? Number(((Math.max(...points.map(point => point.high)) / signal.entryPrice - 1)*100).toFixed(6)) : null,
    maePct:points.length ? Number(((Math.min(...points.map(point => point.low)) / signal.entryPrice - 1)*100).toFixed(6)) : null,
    returnPct:points.at(-1)?.returnPct ?? null,completedAt:new Date(until).toISOString(),warning:'单信号观察，样本量不足；不能据此判定策略有效。' };
}
