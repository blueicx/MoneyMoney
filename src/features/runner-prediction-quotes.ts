import { createHash } from 'node:crypto';
import type { AiRunnerQuote } from './ai-paper-runner';

export interface PredictionOutcomeBookQuote {
  tokenId: string;
  bestBid: number;
  bestAsk: number;
  bestBidSize: number;
  bestAskSize: number;
  updatedAt: string;
  quoteBasis: 'source-yes-orderbook' | 'complement-from-yes-orderbook';
}

export interface PredictionExecutionContract {
  instrumentId: string;
  conditionId: string;
  decimalPrecision: 2 | 3;
  marketIdentityHash: string;
  bookSnapshotHash: string;
  verified: boolean;
  marketDescriptionEvidence: {
    kind: 'market-description';
    url: string;
    source: string;
    evidenceId: string;
    observedAt: string;
    description: string;
    descriptionHash: string;
  };
  outcomes: Record<'YES' | 'NO', PredictionOutcomeBookQuote>;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashMarketIdentity(input: {
  marketId: string;
  conditionId: string;
  decimalPrecision: number;
  descriptionHash: string;
  yesTokenId: string;
  noTokenId: string;
}): string {
  return sha256(JSON.stringify({
    marketId: input.marketId,
    conditionId: input.conditionId,
    decimalPrecision: input.decimalPrecision,
    descriptionHash: input.descriptionHash,
    outcomes: { YES: input.yesTokenId, NO: input.noTokenId },
  }));
}

function hashTopOfBook(input: {
  marketIdentityHash: string;
  updatedAt: string;
  yesBidTicks: number;
  yesAskTicks: number;
  yesBidSize: number;
  yesAskSize: number;
}): string {
  return sha256(JSON.stringify(input));
}

function outcomeName(value: unknown): 'YES' | 'NO' | null {
  const name = String(value ?? '').trim().toUpperCase();
  if (name === 'YES' || name === '是') return 'YES';
  if (name === 'NO' || name === '否') return 'NO';
  return null;
}

function sourceLevels(value: unknown, scale: number): Array<{ ticks: number; size: number }> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const levels: Array<{ ticks: number; size: number }> = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 2) return null;
    if (typeof item[0] !== 'number' || typeof item[1] !== 'number') return null;
    const price = item[0];
    const size = item[1];
    const scaled = price * scale;
    const ticks = Math.round(scaled);
    if (!Number.isFinite(price) || price < 0 || price > 1 || Math.abs(scaled - ticks) > 1e-7
      || !Number.isFinite(size) || size <= 0) return null;
    levels.push({ ticks, size });
  }
  return levels;
}

function rejectedQuote(
  status: string,
  reason: string,
  fetchedAt?: string,
): AiRunnerQuote {
  return {
    market: 'prediction', status, dataStatus: status, price: 0,
    source: 'Predict.fun 官方市场详情 + YES 订单簿',
    ...(fetchedAt ? { fetchedAt } : {}), reason,
  };
}

/**
 * Build paper-only YES/NO quotes from Predict.fun's documented YES market book.
 * NO is derived in integer market ticks from the opposite YES side; it is not a
 * separately sourced token book and the quote metadata says so explicitly.
 */
export function buildPredictFunExecutionQuote(
  marketInput: unknown,
  bookInput: unknown,
  retrievedAt = new Date(),
  maxAgeMs = 120_000,
  officialApiBaseUrl = 'https://api.predict.fun',
): AiRunnerQuote {
  const fetchedAtMs = retrievedAt.getTime();
  const fetchedAt = Number.isFinite(fetchedAtMs) ? retrievedAt.toISOString() : undefined;
  const market = record(marketInput);
  const book = record(bookInput);
  if (!Number.isFinite(fetchedAtMs) || !market || !book) return rejectedQuote('unavailable', '官方市场详情或订单簿结构无效', fetchedAt);

  const id = typeof market.id === 'number' ? market.id : Number.NaN;
  const instrumentId = `prediction:predictfun:${id}`;
  const description = typeof market.description === 'string' ? market.description.trim() : '';
  const conditionId = typeof market.conditionId === 'string' ? market.conditionId.trim() : '';
  const precision = typeof market.decimalPrecision === 'number' ? market.decimalPrecision : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0 || market.status !== 'REGISTERED' || market.tradingStatus !== 'OPEN'
    || market.isVisible !== true || !description || !conditionId || (precision !== 2 && precision !== 3)) {
    return rejectedQuote('unsupported', '市场未注册开放、官方 description、conditionId 或报价精度未通过核验', fetchedAt);
  }
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
  if (outcomes.length !== 2) return rejectedQuote('unsupported', '市场不是恰好包含 YES/NO 的二元合约', fetchedAt);
  const mapped = new Map<'YES' | 'NO', string>();
  for (const rawOutcome of outcomes) {
    const outcome = record(rawOutcome);
    const name = outcomeName(outcome?.name);
    const tokenId = typeof outcome?.onChainId === 'string' ? outcome.onChainId.trim() : '';
    if (!name || !tokenId || mapped.has(name)) return rejectedQuote('unsupported', 'YES/NO outcome 名称或链上 token 身份缺失/重复', fetchedAt);
    mapped.set(name, tokenId);
  }
  const yesTokenId = mapped.get('YES');
  const noTokenId = mapped.get('NO');
  if (!yesTokenId || !noTokenId || yesTokenId === noTokenId || ['0', '0x0', '0x' + '0'.repeat(64)].includes(yesTokenId.toLowerCase())
    || ['0', '0x0', '0x' + '0'.repeat(64)].includes(noTokenId.toLowerCase())) return rejectedQuote('unsupported', 'YES/NO token 身份不唯一或无效', fetchedAt);

  if (typeof book.marketId !== 'number' || !Number.isSafeInteger(book.marketId) || book.marketId !== id) return rejectedQuote('unsupported', '订单簿 marketId 与官方市场身份不匹配', fetchedAt);
  const timestamp = typeof book.updateTimestampMs === 'number' ? book.updateTimestampMs : Number.NaN;
  const ageMs = fetchedAtMs - timestamp;
  const sourceDate = new Date(timestamp);
  if (!Number.isSafeInteger(timestamp) || !Number.isFinite(sourceDate.getTime()) || timestamp <= 0 || ageMs < 0) return rejectedQuote('unavailable', '订单簿源时间缺失或晚于抓取时间', fetchedAt);
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return rejectedQuote('unsupported', '报价新鲜度配置无效', fetchedAt);
  const scale = 10 ** precision;
  if (!Array.isArray(book.bids) || !book.bids.length || !Array.isArray(book.asks) || !book.asks.length) {
    return rejectedQuote('empty', 'YES 订单簿缺少有效双边报价或可见数量', fetchedAt);
  }
  const bids = sourceLevels(book.bids, scale);
  const asks = sourceLevels(book.asks, scale);
  if (!bids || !asks) return rejectedQuote('unavailable', 'YES 订单簿价格精度、价格范围或可见数量无效', fetchedAt);
  const bestBid = bids.reduce((best, level) => level.ticks > best.ticks ? level : best);
  const bestAsk = asks.reduce((best, level) => level.ticks < best.ticks ? level : best);
  if (bestBid.ticks > bestAsk.ticks) return rejectedQuote('unavailable', 'YES 订单簿买卖价交叉，拒绝构造模拟报价', fetchedAt);

  const updatedAt = sourceDate.toISOString();
  const status = ageMs <= 15_000 ? 'live' : ageMs <= maxAgeMs ? 'delayed' : 'stale';
  const yesBid = bestBid.ticks / scale;
  const yesAsk = bestAsk.ticks / scale;
  const noBid = (scale - bestAsk.ticks) / scale;
  const noAsk = (scale - bestBid.ticks) / scale;
  const descriptionHash = sha256(description);
  const marketIdentityHash = hashMarketIdentity({
    marketId: String(id), conditionId, decimalPrecision: precision,
    descriptionHash, yesTokenId, noTokenId,
  });
  const bookSnapshotHash = hashTopOfBook({
    marketIdentityHash, updatedAt, yesBidTicks: bestBid.ticks, yesAskTicks: bestAsk.ticks,
    yesBidSize: bestBid.size, yesAskSize: bestAsk.size,
  });
  let officialMarketUrl: string;
  try {
    const base = new URL(officialApiBaseUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
      || !['api.predict.fun', 'api-testnet.predict.fun'].includes(base.hostname)
      || !['', '/'].includes(base.pathname)) throw new Error('untrusted host');
    officialMarketUrl = new URL(`/v1/markets/${id}`, base).toString();
  } catch {
    return rejectedQuote('unsupported', 'Predict.fun 官方 API 地址不受信任', fetchedAt);
  }
  const contract: PredictionExecutionContract = {
    instrumentId,
    conditionId,
    decimalPrecision: precision,
    marketIdentityHash,
    bookSnapshotHash,
    verified: true,
    marketDescriptionEvidence: {
      kind: 'market-description',
      url: officialMarketUrl,
      source: 'Predict.fun 官方市场详情 description（抓取快照，非发布时间）',
      evidenceId: `predictfun-market-${id}-${marketIdentityHash.slice(0, 16)}`,
      observedAt: fetchedAt!,
      description,
      descriptionHash,
    },
    outcomes: {
      YES: {
        tokenId: yesTokenId, bestBid: yesBid, bestAsk: yesAsk,
        bestBidSize: bestBid.size, bestAskSize: bestAsk.size, updatedAt,
        quoteBasis: 'source-yes-orderbook',
      },
      NO: {
        tokenId: noTokenId, bestBid: noBid, bestAsk: noAsk,
        bestBidSize: bestAsk.size, bestAskSize: bestBid.size, updatedAt,
        quoteBasis: 'complement-from-yes-orderbook',
      },
    },
  };
  const midpoint = (yesBid + yesAsk) / 2;
  return {
    market: 'prediction', status, dataStatus: status, price: midpoint,
    fetchedAt, updatedAt, source: 'Predict.fun 官方 YES 订单簿（NO 按官方精度互补推导）',
    bestBid: yesBid, bestAsk: yesAsk, bestBidSize: bestBid.size, bestAskSize: bestAsk.size,
    predictionContract: contract,
    ...(status === 'stale' ? { reason: 'Predict.fun 订单簿已过期，禁止触发模拟订单' } : {}),
  };
}

function tick(value: number, scale: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  const scaled = value * scale;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) <= 1e-7 ? rounded : null;
}

/** Only explicitly identified, current, market-bound outcome quotes can reach paper matching. */
export function predictionOutcomeQuote(
  quote: AiRunnerQuote,
  side: string | undefined,
  now = new Date(),
  maxAgeMs = 120_000,
): AiRunnerQuote {
  if (quote.market !== 'prediction') return quote;
  const reject = (reason: string, status = 'unsupported'): AiRunnerQuote => ({
    ...quote, status, dataStatus: status, reason,
    bestBid: undefined, bestAsk: undefined, bestBidSize: undefined, bestAskSize: undefined,
    outcome: undefined, tokenId: undefined,
  });
  const status = String(quote.dataStatus || quote.status || 'unavailable');
  if (!['live', 'delayed'].includes(status) || quote.status !== status || quote.dataStatus !== status) {
    return reject(quote.reason || '来源报价不可用于模拟成交，或状态字段互相矛盾', ['live', 'delayed'].includes(status) ? 'unsupported' : status);
  }
  const contract = quote.predictionContract;
  if (!['YES', 'NO'].includes(String(side)) || !contract || contract.verified !== true
    || !/^prediction:predictfun:\d+$/.test(contract.instrumentId) || !contract.conditionId?.trim()) {
    return reject('缺少已核验的预测事件及 YES/NO 合约身份');
  }
  const evidence = contract.marketDescriptionEvidence;
  const observedAt = Date.parse(evidence?.observedAt);
  const fetchedAt = Date.parse(String(quote.fetchedAt || ''));
  if (evidence?.kind !== 'market-description'
    || evidence.source !== 'Predict.fun 官方市场详情 description（抓取快照，非发布时间）'
    || !evidence.evidenceId?.trim()
    || !evidence.description?.trim() || !/^[a-f0-9]{64}$/.test(evidence.descriptionHash || '')
    || sha256(evidence.description.trim()) !== evidence.descriptionHash
    || !Number.isFinite(observedAt) || !Number.isFinite(fetchedAt) || observedAt > fetchedAt || fetchedAt > now.getTime()) {
    return reject('缺少可验证的官方市场 description 快照或抓取时间');
  }
  let rulesUrl: URL;
  try { rulesUrl = new URL(evidence.url); } catch { return reject('市场详情证据链接无效'); }
  const marketId = contract.instrumentId.slice('prediction:predictfun:'.length);
  const expectedIdentityHash = hashMarketIdentity({
    marketId, conditionId: contract.conditionId, decimalPrecision: contract.decimalPrecision,
    descriptionHash: evidence.descriptionHash,
    yesTokenId: contract.outcomes?.YES?.tokenId || '',
    noTokenId: contract.outcomes?.NO?.tokenId || '',
  });
  if (!/^[a-f0-9]{64}$/.test(contract.marketIdentityHash || '')
    || contract.marketIdentityHash !== expectedIdentityHash
    || evidence.evidenceId !== `predictfun-market-${marketId}-${expectedIdentityHash.slice(0, 16)}`) {
    return reject('预测市场身份、conditionId、precision 或 outcome token 与证据摘要不一致');
  }
  if (rulesUrl.username || rulesUrl.password || rulesUrl.protocol !== 'https:'
    || !['api.predict.fun', 'api-testnet.predict.fun'].includes(rulesUrl.hostname)
    || rulesUrl.pathname !== `/v1/markets/${marketId}` || rulesUrl.search || rulesUrl.hash) {
    return reject('市场详情证据未绑定当前 Predict.fun 官方记录');
  }
  if ((contract.decimalPrecision !== 2 && contract.decimalPrecision !== 3)) return reject('预测合约报价精度无效');
  const yes = contract.outcomes?.YES;
  const no = contract.outcomes?.NO;
  if (!yes?.tokenId?.trim() || !no?.tokenId?.trim() || yes.tokenId === no.tokenId
    || yes.quoteBasis !== 'source-yes-orderbook' || no.quoteBasis !== 'complement-from-yes-orderbook') {
    return reject('YES/NO token 身份或报价来源口径无效');
  }
  const scale = 10 ** contract.decimalPrecision;
  const yesBid = tick(yes.bestBid, scale), yesAsk = tick(yes.bestAsk, scale);
  const noBid = tick(no.bestBid, scale), noAsk = tick(no.bestAsk, scale);
  const sourceTimestamp = Date.parse(yes.updatedAt);
  if (yes.updatedAt !== no.updatedAt || !Number.isFinite(sourceTimestamp) || sourceTimestamp > fetchedAt
    || yesBid == null || yesAsk == null || noBid == null || noAsk == null
    || noBid !== scale - yesAsk || noAsk !== scale - yesBid
    || !Number.isFinite(yes.bestBidSize) || yes.bestBidSize <= 0 || !Number.isFinite(yes.bestAskSize) || yes.bestAskSize <= 0
    || no.bestBidSize !== yes.bestAskSize || no.bestAskSize !== yes.bestBidSize) {
    return reject('双边 outcome 报价、源时间或顶层数量无法相互核验');
  }
  const expectedBookSnapshotHash = hashTopOfBook({
    marketIdentityHash: expectedIdentityHash,
    updatedAt: yes.updatedAt,
    yesBidTicks: yesBid!, yesAskTicks: yesAsk!,
    yesBidSize: yes.bestBidSize, yesAskSize: yes.bestAskSize,
  });
  if (!/^[a-f0-9]{64}$/.test(contract.bookSnapshotHash || '')
    || contract.bookSnapshotHash !== expectedBookSnapshotHash) {
    return reject('当前 YES/NO 顶档报价、数量或源时间与盘口快照 Hash 不一致');
  }
  const book = contract.outcomes[side as 'YES' | 'NO'];
  if (!Number.isFinite(book.bestBid) || !Number.isFinite(book.bestAsk) || book.bestBid <= 0
    || book.bestAsk < book.bestBid || book.bestAsk >= 1
    || !Number.isFinite(book.bestBidSize) || book.bestBidSize <= 0
    || !Number.isFinite(book.bestAskSize) || book.bestAskSize <= 0) {
    return reject('所选 outcome 没有有效双边价格和可见深度');
  }
  const age = now.getTime() - sourceTimestamp;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || age < 0) return reject('所选 outcome 源时间无效');
  if (age > maxAgeMs) return reject('所选 outcome 盘口过期', 'stale');
  return {
    ...quote, price: (book.bestBid + book.bestAsk) / 2,
    bestBid: book.bestBid, bestAsk: book.bestAsk,
    bestBidSize: book.bestBidSize, bestAskSize: book.bestAskSize,
    updatedAt: book.updatedAt, outcome: side as 'YES' | 'NO', tokenId: book.tokenId,
  };
}

/**
 * Predict.fun's documented market-detail response currently exposes a free-form
 * description, not a separately verifiable resolution-criteria field. Keep the
 * orderbook usable for read-only marks and risk-reducing exits, but fail closed
 * for signals/model calls and new paper entries until this evidence is wired.
 */
export function predictionSettlementRulesGate(quote: AiRunnerQuote): { allowed: boolean; reason?: string } {
  if (quote.market !== 'prediction') return { allowed: true };
  return {
    allowed: false,
    reason: 'Predict.fun 官方详情没有独立、可验证的结算规则；description 仅供只读观察，禁止 AI 决策和新增开仓',
  };
}
