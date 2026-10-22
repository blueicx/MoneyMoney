export interface PaperCorporateActionEvidence {
  id: string;
  market: 'stocks';
  instrument: string;
  kind: 'split' | 'dividend' | 'symbol-change' | 'delisting';
  effectiveAt: string;
  paymentAt?: string;
  factor?: number;
  currency?: string;
  oldSymbol?: string;
  newSymbol?: string;
  source: string;
}

export interface PaperLifecycleEvent {
  id: string;
  actionId: string;
  kind: PaperCorporateActionEvidence['kind'];
  instrument: string;
  effectiveAt: string;
  source: string;
  factor?: number;
  status: 'applied' | 'pending-review' | 'receivable-created' | 'cash-paid';
  reason: string;
}

export interface PaperCorporateReceivable {
  id: string;
  corporateActionId: string;
  instrumentId: string;
  amount: number;
  currency: string;
  effectiveAt: string;
  source: string;
  perShare?: number;
  entitledShares?: number;
  paymentAt?: string;
  paidAt?: string;
  status: 'awaiting-payment-date' | 'awaiting-payment' | 'paid';
  reason: string;
}

type LifecycleLedger = {
  cash: number;
  positions: Array<Record<string, any>>;
  orders: Array<Record<string, any>>;
  lifecycleEvents?: PaperLifecycleEvent[];
  corporateReceivables?: PaperCorporateReceivable[];
  [key: string]: any;
};

function stockIdentity(value: unknown): { venue: string; symbol: string } | null {
  const id = String(value || '').trim();
  const canonical = id.match(/^stock:([a-z0-9-]+):(.+)$/i);
  if (canonical) return { venue: canonical[1].toLowerCase(), symbol: canonical[2].toUpperCase() };
  if (/^(?:SH|SZ|BJ)\d{6}$/i.test(id)) return { venue: 'cn', symbol: id.toUpperCase() };
  // Only the app's legacy lowercase `us` prefix is stripped. Uppercase USAR is a real ticker.
  if (/^us(?=[A-Z])[A-Z][A-Z0-9.-]{0,14}$/.test(id)) return { venue: 'us', symbol: id.slice(2).toUpperCase() };
  if (/^[A-Z][A-Z0-9.-]{0,14}$/i.test(id)) return { venue: 'us', symbol: id.toUpperCase() };
  return null;
}

function sameStock(left: unknown, right: unknown): boolean {
  const a = stockIdentity(left), b = stockIdentity(right);
  return Boolean(a && b && a.venue === b.venue && a.symbol === b.symbol);
}

function heldSharesAt(ledger: LifecycleLedger, instrument: string, asOf: number): number | null {
  const orders = ledger.orders.filter(order => order.instrumentType === 'stock' && sameStock(order.instrumentId, instrument)
    && Number.isFinite(Date.parse(String(order.timestamp || ''))) && Date.parse(String(order.timestamp)) <= asOf)
    .reverse().sort((a, b) => Date.parse(String(a.timestamp)) - Date.parse(String(b.timestamp)));
  if (!orders.length) return null;
  const priorSplits = (ledger.lifecycleEvents || []).filter(event => event.kind === 'split' && Date.parse(event.effectiveAt) <= asOf && sameStock(event.instrument, instrument));
  if(priorSplits.some(event=>event.status!=='applied'))return null;
  let quantity = 0;
  for (const order of orders) {
    let amount = Number(order.quantity);
    if (!Number.isFinite(amount) || amount <= 0 || !['BUY','SELL'].includes(order.side)) return null;
    const orderAt = Date.parse(String(order.timestamp));
    for (const split of priorSplits) {
      const splitAt = Date.parse(split.effectiveAt), factor = Number((split as any).factor);
      if (splitAt > orderAt && splitAt <= asOf && Number.isFinite(factor) && factor > 0) amount *= factor;
    }
    quantity += order.side === 'SELL' ? -amount : order.side === 'BUY' ? amount : 0;
    if(quantity < -1e-8)return null;
  }
  return Math.max(0, quantity);
}

/** Reconcile only source-backed events; ambiguous symbol identity and payment timing remain pending. */
export function reconcilePaperCorporateActions<T extends LifecycleLedger>(source: T, actions: PaperCorporateActionEvidence[], now = Date.now()): {
  ledger: T;
  applied: number;
  pending: number;
  alreadyApplied: number;
  updated: number;
} {
  const ledger = { ...source, positions: source.positions.map(position => ({ ...position })), orders: source.orders.map(order => ({ ...order })),
    lifecycleEvents: (source.lifecycleEvents || []).map(event=>({...event})), corporateReceivables: (source.corporateReceivables || []).map(row=>({...row})) } as T;
  let applied = 0, pending = 0, alreadyApplied = 0, updated=0;
  const sorted = [...(Array.isArray(actions) ? actions : [])].filter(action => action.market === 'stocks'
    && action.id && typeof action.source==='string' && action.source.trim() && Number.isFinite(Date.parse(action.effectiveAt)) && Date.parse(action.effectiveAt) <= now)
    .sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt));
  for (const action of sorted) {
    const prior=ledger.lifecycleEvents!.find(event=>event.actionId===action.id);
    if(prior){alreadyApplied+=1;if(action.kind!=='dividend'||prior.kind!=='dividend')continue;}
    if (!stockIdentity(action.instrument)) continue;
    const matchingPositions = ledger.positions.filter(position => position.instrumentType === 'stock' && sameStock(position.instrumentId, action.instrument));
    const effectiveAt = Date.parse(action.effectiveAt);
    if (action.kind === 'split') {
      const factor = Number(action.factor);
      if (!Number.isFinite(factor) || factor <= 0) { pending += 1; continue; }
      const eligible = matchingPositions.filter(position => Date.parse(String(position.openedAt || '')) <= effectiveAt);
      if (!eligible.length) continue;
      if(ledger.orders.some(order=>order.instrumentType==='stock'&&sameStock(order.instrumentId,action.instrument)&&Date.parse(String(order.timestamp))>=effectiveAt)){
        ledger.lifecycleEvents!.push({id:`corporate:${action.id}`,actionId:action.id,kind:action.kind,instrument:action.instrument,effectiveAt:action.effectiveAt,source:action.source,status:'pending-review',factor,reason:'拆股生效后已有成交，需核验历史重放和成本归因；未直接缩放整笔当前仓位'});
        pending+=1;continue;
      }
      for (const position of eligible) {
        position.quantity = roundQuantity(Number(position.quantity) * factor);
        position.averageEntryPrice = Number(position.averageEntryPrice) / factor;
        position.currentPrice = Number(position.currentPrice) / factor;
      }
      ledger.lifecycleEvents!.push({ id: `corporate:${action.id}`, actionId: action.id, kind: action.kind, instrument: action.instrument,
        effectiveAt: action.effectiveAt, source: action.source, status: 'applied', factor, reason: `按来源拆股比例 ${factor}:1 调整持仓数量与单位成本` });
      applied += 1;
      continue;
    }
    if (action.kind === 'dividend') {
      const perShare = Number(action.factor);
      const shares = heldSharesAt(ledger, action.instrument, effectiveAt);
      const currency = String(action.currency || '').trim().toUpperCase();
      if (!Number.isFinite(perShare) || perShare < 0 || shares == null || !/^[A-Z]{3}$/.test(currency)) {
        if (matchingPositions.length && !prior) {
          ledger.lifecycleEvents!.push({ id: `corporate:${action.id}`, actionId: action.id, kind: action.kind, instrument: action.instrument,
            effectiveAt: action.effectiveAt, source: action.source, status: 'pending-review', reason: !/^[A-Z]{3}$/.test(currency) ? '来源未提供可核验的 ISO 币种；未创建应收或换算现金' : shares == null ? '缺少可核验的除息日持仓订单历史；未推算股数或入账' : '来源股息数值无效' });
          pending += 1;
        }
        continue;
      }
      if (shares <= 0) continue;
      const identity = stockIdentity(action.instrument)!;
      let receivable=ledger.corporateReceivables!.find(row=>row.corporateActionId===action.id);
      if(!receivable&&prior){pending+=1;continue;}
      if(!receivable){receivable = { id: `dividend:${action.id}`, corporateActionId: action.id,
        instrumentId: `stock:${identity.venue}:${identity.symbol}`, amount: roundMoney(shares * perShare), currency, effectiveAt: action.effectiveAt,
        perShare,entitledShares:shares,
        source: action.source, status: 'awaiting-payment-date', reason: '来源只提供除息日，未提供可核验付款日；暂记应收，不增加现金余额' };
      ledger.corporateReceivables!.push(receivable);
      ledger.lifecycleEvents!.push({ id: `corporate:${action.id}`, actionId: action.id, kind: action.kind, instrument: action.instrument,
        effectiveAt: action.effectiveAt, source: action.source, status: 'receivable-created', reason: receivable.reason });
      applied += 1;
      }
      if(receivable.instrumentId!==`stock:${identity.venue}:${identity.symbol}`||receivable.source!==action.source||receivable.currency!==currency||receivable.effectiveAt!==action.effectiveAt||receivable.perShare!==perShare||receivable.entitledShares!==shares||receivable.amount!==roundMoney(shares*perShare)){
        pending+=1;continue;
      }
      if(receivable.status==='paid')continue;
      if(!action.paymentAt)continue;
      const payAt=Date.parse(action.paymentAt);
      if(!Number.isFinite(payAt)||payAt<effectiveAt){pending+=1;continue;}
      if(receivable.paymentAt&&Date.parse(receivable.paymentAt)!==payAt){pending+=1;continue;}
      if(receivable.paymentAt!==new Date(payAt).toISOString()||receivable.status!=='awaiting-payment')updated+=1;
      receivable.paymentAt=new Date(payAt).toISOString();
      receivable.status='awaiting-payment';receivable.reason='已保存来源付款日，未到付款日或币种尚不能核验；现金未增加';
      if(payAt>now)continue;
      // The existing unified ledger is USD-denominated; no FX conversion is implied.
      if(currency!=='USD'||!Number.isFinite(ledger.cash)){pending+=1;continue;}
      ledger.cash=roundMoney(ledger.cash+receivable.amount);
      receivable.status='paid';receivable.paidAt=new Date(now).toISOString();receivable.reason='按已核验除息权益及来源付款日计入USD模拟现金，非真实到账证明';
      ledger.lifecycleEvents!.push({id:`payment:${action.id}`,actionId:`payment:${action.id}`,kind:action.kind,instrument:action.instrument,effectiveAt:receivable.paymentAt,source:action.source,status:'cash-paid',reason:receivable.reason});
      applied+=1;
      continue;
    }
    if (matchingPositions.length) {
      ledger.lifecycleEvents!.push({ id: `corporate:${action.id}`, actionId: action.id, kind: action.kind, instrument: action.instrument,
        effectiveAt: action.effectiveAt, source: action.source, status: 'pending-review', reason: action.kind === 'symbol-change'
          ? '代码变更缺少经核验的同一证券身份映射；持仓代码未自动修改'
          : '退市事件没有官方现金/证券处置结果；持仓保持不变，等待人工对账' });
      pending += 1;
    }
  }
  return { ledger, applied, pending, alreadyApplied, updated };
}

function roundQuantity(value: number): number { return Math.round(value * 1e8) / 1e8; }
function roundMoney(value: number): number { return Math.round(value * 1e8) / 1e8; }

export function pendingOptionSettlements(positions: Array<Record<string, any>>, now = Date.now()) {
  return (positions || []).filter(position => position.instrumentType === 'option').flatMap(position => {
    const identity = String(position.instrumentId || '');
    const iso = identity.match(/^option:(?:us|cboe|deribit):[^:]+:(\d{4}-\d{2}-\d{2}):/i)?.[1];
    const deribit = identity.match(/^option:deribit:[A-Z]+-(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})-/i);
    const months: Record<string, string> = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
    const date = iso || (deribit ? `20${deribit[3]}-${months[deribit[2].toUpperCase()]}-${deribit[1].padStart(2, '0')}` : null);
    if (!date || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || Date.parse(`${date}T00:00:00Z`) >= now) return [];
    return [{ instrument: identity, expiredAt: date, quantity: position.quantity, status: 'pending-evidence', reason: '尚无与该合约身份、到期日匹配的官方结算证据；未虚构结算价、现金流或自动平仓' }];
  });
}
