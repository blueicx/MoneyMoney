import type { DataLakeCatalog, PointInTimeSnapshot } from '../storage/data-lake';
import type { MarketId } from './research-contracts';
import type { UnifiedPaperLedgerStore, UnifiedPaperPosition } from './unified-paper-trading';
import type { SavedOptionChain, StressSnapshot } from './saved-stress-scenarios';

const TYPE_TO_MARKET:Record<string,MarketId>={stock:'stocks',crypto:'crypto',option:'options',prediction:'prediction'};
const MAX_PRICE_REFS=100,MAX_OPTION_REFS=100,MAX_HOLDINGS=1000;
function marketForIdentity(identity:string):MarketId|null {const type=identity.split(':',1)[0].toLowerCase();return TYPE_TO_MARKET[type]||null;}
function canonical(catalog:DataLakeCatalog,market:MarketId,instrument:string):string|null {try{const ref=catalog.resolveInstrument(market,instrument);return ref?.id||null;}catch{return null;}}
function canonicalRef(catalog:DataLakeCatalog,market:MarketId,instrument:string){try{return catalog.resolveInstrument(market,instrument);}catch{return null;}}
function registeredOptionUnderlying(catalog:DataLakeCatalog,instrument:string):boolean {
  const asset=instrument.split(':').at(-1)||'';
  const chains=catalog.listOptionSnapshots({market:'options',instrument});
  return chains.length>0&&chains.every(chain=>{const underlying=chain.underlyingMarket==='stocks'?'stocks':'crypto',symbol=chain.underlyingMarket==='stocks'?asset:/^(BTC|ETH)$/.test(asset)?`${asset}USDT`:asset;return Boolean(canonical(catalog,underlying,symbol));});
}
function optionChain(catalog:DataLakeCatalog,id:string):SavedOptionChain|null {
  let row:Record<string,any>|null;try{row=catalog.optionSnapshotRecord(id);}catch{return null;}if(!row||row.market!=='options')return null;
  if(!registeredOptionUnderlying(catalog,String(row.instrument)))return null;
  const saved=catalog.listOptionSnapshots({market:'options',instrument:String(row.instrument)}).find(item=>item.id===id);
  if(!saved)return null;
  return {id:saved.id,instrument:saved.instrument,underlyingMarket:saved.underlyingMarket as 'stocks'|'crypto',source:saved.source,fetchedAt:saved.fetchedAt,contentHash:saved.contentHash,snapshot:saved.snapshot as SavedOptionChain['snapshot']};
}
function positionRows(ledger:ReturnType<UnifiedPaperLedgerStore['get']>,catalog:DataLakeCatalog):Array<Record<string,unknown>> {
  const result:Array<Record<string,unknown>>=[];
  const append=(accountId:string,positions:UnifiedPaperPosition[])=>positions.slice(0,MAX_HOLDINGS-result.length).forEach((position,index)=>{const market=TYPE_TO_MARKET[position.instrumentType],registered=market?canonicalRef(catalog,market,position.instrumentId):null,identity=registered?.id||null,kind=position.instrumentType==='stock'?'cash-stock':position.instrumentType==='crypto'?'crypto-spot':position.instrumentType==='option'?'option-group':'unsupported',timeframe='1d',snapshotRefs=identity&&market&&kind!=='unsupported'&&kind!=='option-group'?catalog.listSnapshots({market,instrument:registered!.symbol,timeframe,limit:20}).map(ref=>ref.id):[];result.push({id:`${accountId}:${index}:${position.instrumentId}`,positionId:`${accountId}:${index}:${position.instrumentId}`,accountId,identity:identity||position.instrumentId,kind,positionStatus:identity&&snapshotRefs.length&&kind!=='unsupported'?'saved':'unsupported',unsupportedReason:!identity?'账本标的无法映射至唯一规范身份':kind==='unsupported'?'该持仓类型未纳入已验证压力模型':kind==='option-group'?'期权持仓缺少已验证逐腿合约和已保存期权链引用':snapshotRefs.length?undefined:'没有该标的已保存的K线快照；未自动抓取行情',instrumentId:position.instrumentId,instrumentType:position.instrumentType,title:position.title,outcome:position.outcome,quantity:position.quantity,direction:'long',contractMultiplier:position.contractMultiplier,averageEntryPrice:position.averageEntryPrice,currentPrice:position.currentPrice,openedAt:position.openedAt,realizedPnl:position.realizedPnl,currency:position.currency,markUpdatedAt:position.markUpdatedAt,markStatus:position.markStatus,markSource:position.markSource,snapshotRefs,...(position.instrumentType==='option'?{optionSnapshotId:null,legs:[]}:{})});});
  append('unified-paper-ledger',Array.isArray(ledger.positions)?ledger.positions:[]);
  for(const account of Object.values(ledger.runnerAccounts||{}))if(account&&typeof account.accountId==='string'&&Array.isArray(account.positions))append(account.accountId,account.positions);
  return result.slice(0,MAX_HOLDINGS);
}

export function createSavedStressSourceAdapters(deps:{catalog:DataLakeCatalog;ledger:Pick<UnifiedPaperLedgerStore,'get'>}) {
  const loadSnapshot=async(id:string):Promise<StressSnapshot|null>=>{
    if(typeof id!=='string'||!id||id.length>240)return null;
    const ref=deps.catalog.getSnapshot(id);if(!ref||ref.dataset!=='bars')return null;
    const market=ref.market,canonicalId=canonical(deps.catalog,market,ref.instrument);if(!canonicalId)return null;
    let exact;try{exact=await deps.catalog.readSnapshotBarsExact(ref);}catch{return null;}if(exact.dataStatus!=='historical'||!exact.rows.length)return null;
    const last=exact.rows.at(-1)!,price=Number(last.close),priceAt=last.timestamp instanceof Date?last.timestamp.toISOString():new Date(String(last.timestamp)).toISOString();
    if(!Number.isFinite(price)||price<=0||!Number.isFinite(Date.parse(priceAt))||Date.parse(priceAt)>Date.parse(ref.asOf))return null;
    return {id:ref.id,contentHash:ref.contentHash,asOf:ref.asOf,identity:canonicalId,market,currency:exact.currency,price,stale:false};
  };
  const loadOptionSnapshot=(id:string)=>typeof id==='string'&&id.length<=240?optionChain(deps.catalog,id):null;
  const listPriceSnapshots=(_owner:string)=>deps.catalog.listSnapshots({limit:MAX_PRICE_REFS}).flatMap((ref:PointInTimeSnapshot)=>{const identity=canonical(deps.catalog,ref.market,ref.instrument);return identity?[{id:ref.id,contentHash:ref.contentHash,asOf:ref.asOf,identity,market:ref.market,source:ref.source}]:[];});
  const listSavedOptionSnapshots=(_owner:string)=>deps.catalog.listCoverage('options').slice(0,MAX_OPTION_REFS).flatMap(row=>{const instrument=row.instrument;if(!registeredOptionUnderlying(deps.catalog,instrument))return [];return deps.catalog.listOptionSnapshots({market:'options',instrument}).slice(-MAX_OPTION_REFS).map(snapshot=>({id:snapshot.id,instrument,underlyingMarket:snapshot.underlyingMarket,source:snapshot.source,fetchedAt:snapshot.fetchedAt,contentHash:snapshot.contentHash,snapshot:snapshot.snapshot}));}).slice(-MAX_OPTION_REFS);
  const loadPaperHoldings=(_owner:string)=>positionRows(deps.ledger.get(),deps.catalog);
  const isRegisteredIdentity=(identity:string)=>{const market=marketForIdentity(identity);if(market==='options')return registeredOptionUnderlying(deps.catalog,identity);return market!==null&&canonical(deps.catalog,market,identity)===identity;};
  return {loadSnapshot,loadOptionSnapshot,listPriceSnapshots,listSavedOptionSnapshots,loadPaperHoldings,isRegisteredIdentity};
}
