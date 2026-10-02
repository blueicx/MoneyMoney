/** Read-only Gate USDT linear contracts. No authenticated endpoint or execution adapter. */
type ContractKind = 'perpetual' | 'delivery';
type Json = Record<string, any>;
const numeric = (value: unknown): number | null => value === null || value === undefined || value === '' || typeof value === 'boolean' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const positive = (value: unknown) => { const n = numeric(value); return n != null && n > 0 ? n : null; };
export function contractIdentity(instrument: string) {
  const match = String(instrument).match(/^crypto:(gateio|gateio-delivery):([A-Z0-9]+_USDT(?:_\d{8})?)$/);
  if (!match || (match[1] === 'gateio-delivery') !== /_\d{8}$/.test(match[2])) throw new Error('请选择 Gate USDT 永续或交割规范合约身份；不使用现货、期权或其他市场回退');
  return { kind: match[1] === 'gateio' ? 'perpetual' as const : 'delivery' as const, contract: match[2], venue: match[1] };
}
export function contractScenario(input: { entryPrice: number; quantity: number; leverage: number; feeRate: number; fundingRate: number; fundingPeriods: number; shockPct: number; side: 'long' | 'short' }) {
  const {entryPrice,quantity,leverage,feeRate,fundingRate,fundingPeriods,shockPct,side}=input;
  if (![entryPrice,quantity,leverage,feeRate,fundingRate,fundingPeriods,shockPct].every(n=>typeof n === 'number' && Number.isFinite(n)) || entryPrice<=0 || quantity<=0 || leverage<1 || leverage>200 || feeRate<0 || feeRate>0.1 || Math.abs(fundingRate)>0.1 || !Number.isInteger(fundingPeriods) || fundingPeriods<0 || fundingPeriods>1000 || shockPct<=-100 || shockPct>1000 || !['long','short'].includes(side)) throw new Error('情景参数无效：填写正数价格、基础币数量、1–200倍杠杆及有限成本/冲击');
  const exitPrice=entryPrice*(1+shockPct/100),notional=entryPrice*quantity,initialMargin=notional/leverage,direction=side==='long'?1:-1;
  const pnl=(exitPrice-entryPrice)*quantity*direction,tradingFees=(notional+exitPrice*quantity)*feeRate,fundingCost=notional*fundingRate*fundingPeriods*direction,remainingMargin=initialMargin+pnl-tradingFees-fundingCost;
  return {exitPrice,notional,initialMargin,pnl,tradingFees,fundingCost,remainingMargin,marginReturnPct:(remainingMargin/initialMargin-1)*100,marginExhausted:remainingMargin<=0,
    assumptions:'USDT 线性合约；数量为基础币；入场/退出同一手续费假设，资金费率与名义本金固定。不含阶梯维持保证金、逐次资金结算和滑点，不是强平价、历史回测或交易指令。',executionEnabled:false};
}
async function gateRead(path: string) {
  const response=await fetch('https://api.gateio.ws/api/v4'+path,{signal:AbortSignal.timeout(8000),headers:{'X-Gate-Size-Decimal':'1'}});
  if(!response.ok)throw new Error('Gate 来源请求失败 HTTP '+response.status);
  return response.json();
}
export class ContractResearchService {
  private cache=new Map<string,{at:number;value:any}>();
  private pending=new Map<string,Promise<any>>();
  constructor(private read:(path:string)=>Promise<any>=gateRead,private now:()=>number=Date.now) {}
  private async cached(key:string,ttl:number,run:()=>Promise<any>) {
    const old=this.cache.get(key);if(old && this.now()-old.at<ttl)return {...old.value,dataStatus:old.value.dataStatus==='unavailable' ? 'unavailable':'cached',cachedAt:new Date(old.at).toISOString()};
    const inFlight=this.pending.get(key);if(inFlight)return inFlight;
    if(this.pending.size>=8)throw new Error('合约来源请求预算已满，请稍后重试');
    const work=run().then(value=>{if(this.cache.size>=64)this.cache.delete(this.cache.keys().next().value!);this.cache.set(key,{at:this.now(),value});return value;}).finally(()=>this.pending.delete(key));
    this.pending.set(key,work);return work;
  }
  catalog(kind:ContractKind,query='') {
    if(!['perpetual','delivery'].includes(kind) || query.length>80)throw new Error('合约类型或搜索词无效');
    return this.cached('catalog:'+kind,120000,async()=>{
      try {const data=await this.read('/'+(kind==='perpetual'?'futures':'delivery')+'/usdt/contracts');if(!Array.isArray(data))throw new Error('来源合约列表格式无效');
        return {market:'crypto',dataStatus:'delayed',source:'Gate public API · USDT '+kind,updatedAt:new Date(this.now()).toISOString(),reason:null,items:data.filter(row=>typeof row.name==='string' && !row.in_delisting).flatMap(row=>{const id='crypto:'+(kind==='perpetual'?'gateio':'gateio-delivery')+':'+row.name;try{contractIdentity(id);return [{instrument:id,name:row.name,kind,expiresAt:positive(row.expire_time)?new Date(Number(row.expire_time)*1000).toISOString():null}];}catch{return [];}})};
      }catch(error){return {market:'crypto',dataStatus:'unavailable',source:'Gate public API',updatedAt:new Date(this.now()).toISOString(),reason:(error as Error).message,items:[]};}
    }).then(result=>({...result,items:result.items.filter((row:any)=>row.name.includes(query.toUpperCase())).slice(0,100)}));
  }
  detail(instrument:string) {
    const identity=contractIdentity(instrument),root='/'+(identity.kind==='perpetual'?'futures':'delivery')+'/usdt';
    return this.cached(instrument,30000,async()=>{
      const sections:Record<string,{dataStatus:string;reason:string|null;source:string;updatedAt:string}>={};
      const updatedAt=new Date(this.now()).toISOString();
      const read=async(key:string,path:string):Promise<any>=>{try{const value=await this.read(path);sections[key]={dataStatus:'delayed',reason:null,source:'https://api.gateio.ws/api/v4'+path,updatedAt};return value;}catch(error){sections[key]={dataStatus:'unavailable',reason:(error as Error).message,source:'https://api.gateio.ws/api/v4'+path,updatedAt};return null;}};
      const [metadata,book,history,bars]=await Promise.all([read('quote',root+'/contracts/'+identity.contract),read('depth',root+'/order_book?contract='+identity.contract+'&limit=20'),identity.kind==='perpetual'?read('funding',root+'/funding_rate?contract='+identity.contract+'&limit=100'):Promise.resolve(null),read('bars',root+'/candlesticks?contract='+identity.contract+'&interval=1h&limit=100')]);
      if(identity.kind==='delivery')sections.funding={dataStatus:'unsupported',reason:'交割合约不收永续资金费率',source:'Gate delivery',updatedAt};
      const valid=metadata?.name===identity.contract && metadata?.type==='direct';
      if(metadata && !valid)sections.quote={...sections.quote,dataStatus:'unavailable',reason:'来源合约身份或线性类型不一致，未采用该数据'};
      const data:Json=valid?metadata:{};
      const markPrice=positive(data.mark_price),indexPrice=positive(data.index_price),multiplier=positive(data.quanto_multiplier),size=numeric(data.position_size);
      const levels=(list:unknown)=>Array.isArray(list)?list.slice(0,20).flatMap(row=>{const price=positive(row.p),quantity=positive(row.s);return price!=null && quantity!=null ? [{price,contracts:quantity,notional:multiplier==null?null:price*quantity*multiplier}]:[];}):[];
      const bids=valid?levels(book?.bids).sort((a,b)=>b.price-a.price):[],asks=valid?levels(book?.asks).sort((a,b)=>a.price-b.price):[];
      if(book && (!bids.length || !asks.length))sections.depth={...sections.depth,dataStatus:'empty',reason:'来源未提供双边有效盘口'};
      const funding=valid && Array.isArray(history)?history.flatMap(row=>{const rate=numeric(row.r),time=positive(row.t);return rate!=null && time && time*1000<=this.now()? [{at:new Date(time*1000).toISOString(),ratePct:rate*100}]:[];}).sort((a,b)=>a.at.localeCompare(b.at)):[];
      const candles=valid && Array.isArray(bars)?bars.flatMap(row=>{const time=positive(row.t),open=positive(row.o),high=positive(row.h),low=positive(row.l),close=positive(row.c);return time && time*1000+3600000<=this.now() && open && high && low && close && high>=Math.max(open,close) && low<=Math.min(open,close)?[{at:new Date(time*1000).toISOString(),open,high,low,close}]:[];}).sort((a,b)=>a.at.localeCompare(b.at)):[];
      if(history && !funding.length && identity.kind==='perpetual')sections.funding={...sections.funding,dataStatus:'empty',reason:'来源成功但暂无有效资金费率历史'};
      if(bars && !candles.length)sections.bars={...sections.bars,dataStatus:'empty',reason:'来源成功但暂无已完成小时 K 线'};
      const failures=Object.values(sections).filter(row=>['unavailable','empty'].includes(row.dataStatus));
      return {market:'crypto',instrument,...identity,source:'Gate public API · USDT 线性合约',updatedAt,dataStatus:!valid?'unavailable':failures.length?'partial':'delayed',reason:!valid?sections.quote.reason:failures.map(row=>row.reason).join('；') || null,sections,
        quote:{markPrice,indexPrice,lastPrice:positive(data.last_price),basisPct:markPrice && indexPrice ? markPrice/indexPrice*100-100:null,multiplier,openInterestUsd:markPrice && multiplier && size!=null && size>=0?markPrice*multiplier*size:null,
          fundingRatePct:identity.kind==='perpetual' && numeric(data.funding_rate)!=null?Number(data.funding_rate)*100:null,fundingIntervalSeconds:positive(data.funding_interval),nextFundingAt:positive(data.funding_next_apply)?new Date(Number(data.funding_next_apply)*1000).toISOString():null,
          expiresAt:positive(data.expire_time)?new Date(Number(data.expire_time)*1000).toISOString():null,leverageMax:positive(data.leverage_max),maintenanceRate:numeric(data.maintenance_rate),takerFeeRate:numeric(data.taker_fee_rate),makerFeeRate:numeric(data.maker_fee_rate),status:data.status || (valid?'来源未声明':'不可用')},
        depth:{bids,asks,spreadPct:bids.length && asks.length && asks[0].price>=bids[0].price?(asks[0].price/bids[0].price-1)*100:null},funding,candles,evidenceRefs:Object.values(sections).map(row=>row.source),executionEnabled:false};
    });
  }
}
