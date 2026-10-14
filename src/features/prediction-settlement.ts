import crypto from 'node:crypto';

export type SettlementPlatform = 'Kalshi' | 'Polymarket';
export type SettlementStatus = 'open' | 'closed' | 'disputed' | 'settled' | 'unknown' | 'unavailable' | 'unsupported';

export interface SettlementEvidence {
  market: 'prediction';
  instrument: string;
  platform: SettlementPlatform;
  marketId: string;
  status: SettlementStatus;
  platformStatus: string | null;
  announcedResult: 'YES' | 'NO' | null;
  disputeStatus: 'disputed' | 'arbitrated' | 'not-disputed' | 'unknown';
  result: 'YES' | 'NO' | null;
  rulesText: string | null;
  rulesHash: string | null;
  resolutionSourceUrl: string | null;
  closeAt: string | null;
  determinationAt: string | null;
  settlementAt: string | null;
  determinationSourceUrl: string | null;
  resolutionEvidence: {
    conditionId: string | null;
    status: string | null;
    payouts: number[] | null;
    transactionHash: string | null;
    reporter: string | null;
    wasDisputed: boolean | null;
    wasArbitrated: boolean | null;
    resolvedBlock: number | null;
  } | null;
  capturedAt: string;
  sourceUrl: string;
  evidenceHash: string;
  reason: string | null;
}

export interface SettlementTimelineStage { key:'close'|'announcement'|'dispute'|'final'; label:string; status:string; at:string|null; timeKind:'source'|'observed'|'unknown'; detail:string; sourceUrl:string|null; evidenceHash:string; }
export interface RuleComparison { beforeHash:string|null;afterHash:string|null;beforeAt:string;afterAt:string;status:'changed'|'unchanged'|'unavailable';textChange:{removed:string;added:string}|null;fields:Array<{field:string;before:string|null;after:string|null}>;reason:string;evidenceRefs:string[]; }
export function compareSettlementRules(evidence:SettlementEvidence,history:SettlementEvidence[]):RuleComparison[] {
  const cutoff=Date.parse(evidence.capturedAt);
  const records=history.filter(row=>row.market==='prediction'&&row.instrument===evidence.instrument&&row.platform===evidence.platform&&row.marketId===evidence.marketId&&Number.isFinite(Date.parse(row.capturedAt))&&Date.parse(row.capturedAt)<=cutoff).slice().sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt));
  const pairs:RuleComparison[]=[];
  for(let i=1;i<records.length;i++) {
    const before=records[i-1],after=records[i];
    if(before.capturedAt===after.capturedAt&&before.evidenceHash===after.evidenceHash)continue;
    const valid=(row:SettlementEvidence)=>typeof row.rulesText==='string'&&row.rulesText.length<=60000&&sha256(row.rulesText)===row.rulesHash;
    const fields=['closeAt','resolutionSourceUrl'].filter(field=>before[field as 'closeAt']!==after[field as 'closeAt']).map(field=>({field,before:before[field as 'closeAt'],after:after[field as 'closeAt']}));
    let textChange:RuleComparison['textChange']=null;
    if(valid(before)&&valid(after)) {
      const a=Array.from(before.rulesText!),b=Array.from(after.rulesText!);let prefix=0,suffix=0;
      while(prefix<Math.min(a.length,b.length)&&a[prefix]===b[prefix])prefix++;
      while(suffix<Math.min(a.length,b.length)-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
      textChange={removed:a.slice(prefix,a.length-suffix).join(''),added:b.slice(prefix,b.length-suffix).join('')};
    }
    const status=textChange===null?'unavailable':textChange.removed||textChange.added||fields.length?'changed':'unchanged';
    pairs.push({beforeHash:before.rulesHash,afterHash:after.rulesHash,beforeAt:before.capturedAt,afterAt:after.capturedAt,status,textChange,fields,reason:status==='unavailable'?'规则文本缺失、过大或Hash不匹配，不推测修改内容':'精确保存文本与来源字段差异；抓取时间不是规则实际生效时间，不作语义推断',evidenceRefs:[before.evidenceHash,after.evidenceHash]});
  }
  return pairs.slice(-50);
}
export function buildSettlementTimeline(evidence:SettlementEvidence,history:SettlementEvidence[]=[]):{stages:SettlementTimelineStage[];ruleRevisions:Array<{capturedAt:string|null;hash:string|null;sourceUrl:string|null}>;ruleComparisons:RuleComparison[]} {
  const time=(value:string|null)=>{if(!value)return null;const parsed=Date.parse(value);return Number.isFinite(parsed)?new Date(parsed).toISOString():null;};
  const sourceUrl=(value:string|null)=>safeHttpUrl(value);
  const closeAt=time(evidence.closeAt);
  const announced=!!evidence.announcedResult;
  const observedAt=announced?time(evidence.capturedAt):null;
  const disputeStatus=evidence.disputeStatus||'unknown';
  const finalStatus=evidence.status==='settled'&&evidence.result?'settled':evidence.status==='disputed'?'disputed':evidence.status==='open'?'pending':evidence.status==='unavailable'||evidence.status==='unsupported'?'unavailable':'unknown';
  const finalAt=finalStatus==='settled'?time(evidence.settlementAt):null;
  const stages:SettlementTimelineStage[]=[
    {key:'close',label:'市场关闭 / 截止',status:closeAt?'recorded':'unknown',at:closeAt,timeKind:closeAt?'source':'unknown',detail:closeAt?'平台来源记录的截止时间':'平台未提供可核验截止时间',sourceUrl:sourceUrl(evidence.sourceUrl),evidenceHash:evidence.evidenceHash},
    {key:'announcement',label:'平台公布 / 报告',status:announced?'announced':evidence.status==='open'?'pending':'unknown',at:observedAt,timeKind:observedAt?'observed':'unknown',detail:announced?`平台报告 ${evidence.announcedResult}；时间为系统首次观察时间，不代表来源发布时间`:'未取得平台明确 YES/NO 公布结果',sourceUrl:sourceUrl(evidence.sourceUrl),evidenceHash:evidence.evidenceHash},
    {key:'dispute',label:'争议 / 裁定',status:disputeStatus==='disputed'?'disputed':disputeStatus==='arbitrated'?'arbitrated':disputeStatus==='not-disputed'?'not-disputed':'unknown',at:time(evidence.determinationAt),timeKind:evidence.determinationAt?'source':'unknown',detail:disputeStatus==='disputed'?'官方证据显示争议未结束':disputeStatus==='arbitrated'?'官方证据标记已仲裁':disputeStatus==='not-disputed'?'官方记录未标记争议':'来源未提供明确争议/裁定状态',sourceUrl:sourceUrl(evidence.determinationSourceUrl),evidenceHash:evidence.evidenceHash},
    {key:'final',label:'最终结算',status:finalStatus,at:finalAt,timeKind:finalAt?'source':'unknown',detail:finalStatus==='settled'?`来源核验最终结果 ${evidence.result}`:finalStatus==='disputed'?'结果仍处于争议，不能视为最终结算':finalStatus==='pending'?'市场仍开放，尚无最终结算':finalStatus==='unavailable'?'结算来源不可用或平台不支持':evidence.status==='closed'?'市场已关闭，但最终结果未核验':'最终结果或结算时间未知',sourceUrl:sourceUrl(evidence.determinationSourceUrl)||sourceUrl(evidence.resolutionSourceUrl)||sourceUrl(evidence.sourceUrl),evidenceHash:evidence.evidenceHash},
  ];
  const ruleRevisions=history.filter(item=>item.instrument===evidence.instrument&&item.platform===evidence.platform&&item.marketId===evidence.marketId&&Date.parse(item.capturedAt)<=Date.parse(evidence.capturedAt)).map(item=>({capturedAt:time(item.capturedAt),hash:item.rulesHash||null,sourceUrl:safeHttpUrl(item.resolutionSourceUrl)||safeHttpUrl(item.sourceUrl)}));
  return {stages,ruleRevisions,ruleComparisons:compareSettlementRules(evidence,history)};
}

interface StateDocumentStore {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T, version?: number): void;
}

const STORE_KEY = 'prediction-settlement-evidence';

function sha256(value: string): string { return crypto.createHash('sha256').update(value).digest('hex'); }

function validIso(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return null;
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}

function explicitBinaryResult(payload: Record<string, unknown>): 'YES' | 'NO' | null {
  const raw = [payload.result, payload.resolutionResult, payload.winningOutcome, payload.resolvedOutcome]
    .find(value => typeof value === 'string');
  const normalized = String(raw || '').trim().toUpperCase();
  if (normalized === 'YES') return 'YES';
  if (normalized === 'NO') return 'NO';
  return null;
}

function parseStringArray(value: unknown): string[] | null {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed.map(item => item.trim()) : null;
}

function parsePayouts(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(item => typeof item === 'number' ? item : typeof item === 'string' && item.trim() ? Number(item) : NaN);
  return parsed.length > 0 && parsed.every(Number.isFinite) ? parsed : null;
}

function polymarketPayoutResult(outcomesValue: unknown, payoutsValue: unknown): 'YES' | 'NO' | null {
  const outcomes = parseStringArray(outcomesValue);
  const payouts = parsePayouts(payoutsValue);
  if (!outcomes || !payouts || outcomes.length !== 2 || payouts.length !== 2) return null;
  const yesIndex = outcomes.findIndex(value => value.toLowerCase() === 'yes');
  const noIndex = outcomes.findIndex(value => value.toLowerCase() === 'no');
  if (yesIndex < 0 || noIndex < 0 || yesIndex === noIndex) return null;
  if (payouts[yesIndex] === 1 && payouts[noIndex] === 0) return 'YES';
  if (payouts[yesIndex] === 0 && payouts[noIndex] === 1) return 'NO';
  return null;
}

function resolutionRow(payload: Record<string, unknown> | undefined, conditionId: string | null): Record<string, unknown> | null {
  if (!payload) return null;
  const rows = Array.isArray(payload.data) ? payload.data.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)) : [];
  const matching = rows.filter(row => typeof row.condition_id === 'string' && String(row.condition_id).toLowerCase() === String(conditionId || '').toLowerCase());
  return matching.length === 1 ? matching[0] : null;
}

export function buildSettlementEndpoint(platform: string, marketId: string): string {
  const id = String(marketId || '').trim();
  if (platform === 'Kalshi') {
    if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/i.test(id)) throw new Error('invalid Kalshi market id');
    return `https://external-api.kalshi.com/trade-api/v2/markets/${encodeURIComponent(id.toUpperCase())}`;
  }
  if (platform === 'Polymarket') {
    if (!/^\d{1,24}$/.test(id)) throw new Error('invalid Polymarket market id');
    return `https://gamma-api.polymarket.com/markets/${encodeURIComponent(id)}`;
  }
  throw new Error('unsupported prediction settlement venue');
}

export function buildPolymarketResolutionEndpoint(conditionId: string): string {
  const id = String(conditionId || '').trim();
  if (!/^0x[a-f\d]{64}$/i.test(id)) throw new Error('invalid Polymarket condition id');
  const url = new URL('https://data-api.polymarket.com/v2/resolutions');
  url.searchParams.set('condition', id);
  return url.toString();
}

export function settlementPayloadMatches(platform: SettlementPlatform, marketId: string, payload: Record<string, unknown>): boolean {
  if (platform === 'Kalshi') return typeof payload.ticker === 'string' && payload.ticker.toUpperCase() === marketId.trim().toUpperCase();
  return platform === 'Polymarket' && typeof payload.id === 'string' && payload.id === marketId.trim();
}

export function normalizeSettlementEvidence(input: {
  platform: SettlementPlatform;
  marketId: string;
  payload: Record<string, unknown>;
  resolutionPayload?: Record<string, unknown>;
  determinationSourceUrl?: string | null;
  resolutionReason?: string | null;
  capturedAt?: string;
}): SettlementEvidence {
  const requestedMarketId = String(input.marketId || '').trim();
  const marketId = input.platform === 'Kalshi' ? requestedMarketId.toUpperCase() : requestedMarketId;
  const sourceUrl = buildSettlementEndpoint(input.platform, marketId);
  const payload = input.payload || {};
  const rulesText = [payload.rules_primary, payload.description, payload.rules_secondary]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => String(value).trim())
    .filter((value, index, all) => all.indexOf(value) === index)
    .join('\n\n') || null;
  const rawStatus = String(payload.status || '').toLowerCase();
  const conditionId = typeof payload.conditionId === 'string' ? payload.conditionId : typeof payload.condition_id === 'string' ? payload.condition_id : null;
  const row = input.platform === 'Polymarket' ? resolutionRow(input.resolutionPayload, conditionId) : null;
  const resolutionStatus = String(row?.status || '').trim().toLowerCase() || null;
  const platformStatus = rawStatus || resolutionStatus;
  const wasDisputed = row?.was_disputed === true || ['disputed', 'challenged'].includes(resolutionStatus || '');
  const wasArbitrated = row?.was_arbitrated === true;
  const activeDispute = wasDisputed && !wasArbitrated;
  const payoutResult = input.platform === 'Polymarket' && row && ['resolved', 'settled'].includes(resolutionStatus || '')
    ? polymarketPayoutResult(payload.outcomes, row.payouts)
    : null;
  const explicitResult = explicitBinaryResult(payload);
  const explicitResolution = input.platform === 'Polymarket' && (payload.resolved === true || ['resolved', 'settled'].includes(rawStatus)) ? explicitResult : null;
  const result = input.platform === 'Kalshi' ? explicitResult : payoutResult || explicitResolution;
  const resolved = input.platform === 'Kalshi'
    ? rawStatus === 'settled'
    : !!((row && ['resolved', 'settled'].includes(resolutionStatus || '') && payoutResult) || explicitResolution);
  const isClosed = payload.closed === true || ['closed', 'settled', 'resolved'].includes(rawStatus) || ['resolved', 'settled'].includes(resolutionStatus || '');
  const status: SettlementStatus = activeDispute ? 'disputed' : resolved && result ? 'settled' : isClosed ? 'closed' : rawStatus === 'open' || payload.closed === false ? 'open' : 'unknown';
  const closeAt = validIso(payload.close_time, payload.closeTime, payload.endDate, payload.end_date);
  const determinationAt = validIso(row?.resolved_at, payload.determination_time, payload.determinationTime, payload.resolvedAt, payload.resolved_at, payload.resolutionTime);
  const settlementAt = validIso(payload.settlement_ts, payload.settlementTime, payload.settled_at, row?.settlement_at);
  const resolutionSourceUrl = safeHttpUrl(payload.resolutionSource || payload.resolution_source || payload.rules_primary_url || row?.resolution_source);
  const determinationSourceUrl = input.platform === 'Polymarket' && conditionId
    ? safeHttpUrl(input.determinationSourceUrl || buildPolymarketResolutionEndpoint(conditionId))
    : safeHttpUrl(input.determinationSourceUrl);
  const payouts = parsePayouts(row?.payouts);
  const resolutionEvidence = row ? {
    conditionId: typeof row.condition_id === 'string' ? row.condition_id : null,
    status: resolutionStatus,
    payouts,
    transactionHash: typeof row.transaction_hash === 'string' ? row.transaction_hash : null,
    reporter: typeof row.reporter === 'string' ? row.reporter : null,
    wasDisputed: typeof row.was_disputed === 'boolean' ? row.was_disputed : null,
    wasArbitrated: typeof row.was_arbitrated === 'boolean' ? row.was_arbitrated : null,
    resolvedBlock: Number.isSafeInteger(row.resolved_block) ? Number(row.resolved_block) : null,
  } : null;
  const reason = status === 'closed' && !result
    ? `未提供可核实的最终结果；不会根据概率或收盘价格推断结算。${input.resolutionReason ? ` ${input.resolutionReason}` : ''}`
    : status === 'disputed'
      ? '官方 resolution 记录存在未完成争议；当前 payout 不作为最终结算结果。'
      : status === 'settled'
      ? null
      : status === 'open'
        ? '市场仍开放，尚无最终结算结果。'
        : '来源未提供足够的结算状态与规则证据。';
  const evidenceCore = {
    platform: input.platform,
    marketId,
    status,
    platformStatus,
    announcedResult: explicitResult,
    disputeStatus: wasDisputed ? wasArbitrated ? 'arbitrated' : 'disputed' : row ? 'not-disputed' : 'unknown',
    result: status === 'settled' ? result : null,
    rulesText,
    resolutionSourceUrl,
    determinationSourceUrl,
    resolutionEvidence,
    closeAt,
    determinationAt,
    settlementAt,
    reason,
  };
  const capturedAt = validIso(input.capturedAt) || new Date().toISOString();
  return {
    market: 'prediction',
    instrument: `prediction:${input.platform.toLowerCase()}:${marketId}`,
    platform: input.platform,
    marketId,
    status,
    platformStatus,
    announcedResult: explicitResult,
    disputeStatus: wasDisputed ? wasArbitrated ? 'arbitrated' : 'disputed' : row ? 'not-disputed' : 'unknown',
    result: status === 'settled' ? result : null,
    rulesText,
    rulesHash: rulesText ? sha256(rulesText) : null,
    resolutionSourceUrl,
    closeAt,
    determinationAt,
    settlementAt,
    determinationSourceUrl,
    resolutionEvidence,
    capturedAt,
    sourceUrl,
    evidenceHash: sha256(JSON.stringify(evidenceCore)),
    reason,
  };
}

export class PredictionSettlementRepository {
  constructor(private readonly store: StateDocumentStore, private readonly key = STORE_KEY) {}

  save(input: SettlementEvidence): SettlementEvidence {
    if (input.market !== 'prediction') throw new Error('settlement evidence must belong to prediction market');
    buildSettlementEndpoint(input.platform, input.marketId);
    const expectedInstrument = `prediction:${input.platform.toLowerCase()}:${input.platform === 'Kalshi' ? input.marketId.toUpperCase() : input.marketId}`;
    if (input.instrument !== expectedInstrument) throw new Error('settlement evidence instrument identity does not match platform market id');
    const records = this.store.get<SettlementEvidence[]>(this.key) || [];
    const previous = [...records].reverse().find(item => item.platform === input.platform && item.marketId === input.marketId);
    if (previous?.evidenceHash === input.evidenceHash) return previous;
    const next = [...records, input].slice(-1000);
    this.store.set(this.key, next, 1);
    return input;
  }

  latest(platform: string, marketId: string): SettlementEvidence | null {
    const records = this.store.get<SettlementEvidence[]>(this.key) || [];
    return [...records].reverse().find(item => item.platform === platform && item.marketId === marketId) || null;
  }

  history(platform: string, marketId: string): SettlementEvidence[] {
    return (this.store.get<SettlementEvidence[]>(this.key) || []).filter(item => item.platform === platform && item.marketId === marketId);
  }
}
