import type { InstrumentRef } from './unified-instruments';
import type { AiRunnerInstrumentRef } from './ai-paper-runner';
import type { ComparisonMarket } from './ai-comparison-scheduler';
import { parseDeribitOptionInstrumentName } from './runner-deribit-options';

export function selectComparisonWatchlist(market: ComparisonMarket, watchlist: string[], pinned: string[], resolve: (id: string) => InstrumentRef | null | undefined) {
  const pins = new Set(pinned), ids = [...new Set(watchlist)].sort((a, b) => Number(pins.has(b)) - Number(pins.has(a)));
  const instruments: AiRunnerInstrumentRef[] = [], excluded: Array<{ instrument: string; reason: string }> = [];
  const identities = new Set<string>();
  for (const id of ids) {
    let ref: InstrumentRef | null | undefined;
    try { ref = resolve(id); } catch { excluded.push({ instrument: id, reason: '标的身份有歧义，需选择交易场所' }); continue; }
    if (!ref) { excluded.push({ instrument: id, reason: '自选身份未核验，不猜测市场或交易场所' }); continue; }
    const ownMarket = ({ stock: 'stocks', option: 'options', crypto: 'crypto', prediction: 'prediction' } as const)[ref.type];
    if (ownMarket !== market) continue;
    if (identities.has(ref.id)) { excluded.push({ instrument: id, reason: '重复规范身份；别名不重复加入冻结标的' }); continue; }
    identities.add(ref.id);
    const venue = ref.type === 'stock' && ref.venue === 'us' ? 'Stocks'
      : ref.type === 'crypto' && ref.venue === 'binance' && /^[A-Z0-9]+USDT$/.test(ref.symbol) ? 'Binance'
      : ref.type === 'prediction' && ['predict.fun', 'predictfun'].includes(ref.venue) && /^\d+$/.test(ref.symbol) ? 'Predict.fun'
      : ref.type === 'option' && ref.venue === 'deribit' && parseDeribitOptionInstrumentName(ref.symbol) ? 'Options'
      : null;
    if (!venue) { excluded.push({ instrument: id, reason: ref.type === 'option' ? '期权仅接受完整的 Deribit BTC/ETH 到期合约身份；其他来源尚未通过模拟撮合校验' : '当前模拟撮合未支持此交易场所；不切换其他来源补位' }); continue; }
    if (instruments.length === 5) { excluded.push({ instrument: id, reason: '冻结自选容量最多5个；未加入本实验' }); continue; }
    instruments.push({ venue, symbolOrMarketId: ref.symbol, title: ref.title });
  }
  return { instruments, excluded };
}
