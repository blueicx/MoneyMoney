import {createHash} from 'node:crypto';
import {buildOptionIvTermStructure,type OptionRow} from './options-market';

export interface SavedOptionsChainEvidence {
  id:string;
  market:'options';
  instrument:string;
  underlyingMarket:'stocks'|'crypto';
  source:'CBOE Delayed Quotes'|'Deribit Public API';
  fetchedAt:string;
  tradeDate:string;
  mode:string;
  contentHash:string;
  snapshot:{
    source:string;
    asset:string;
    market:string;
    fetchedAt:string;
    spot:number;
    expiries:Array<{
      expiryMs:number;
      rows:Array<OptionRow&{
        quoteTime?:string;
        contractCurrency?:string;
        multiplier?:number;
      }>;
    }>;
  };
}

export interface VolatilitySurfaceNode {
  id:string;
  expiryMs:number;
  expiry:string;
  daysToExpiry:number;
  strike:number;
  moneynessPct:number;
  optionType:'call'|'put';
  bid:number;
  ask:number;
  impliedVolPct:number;
  quoteTime:string;
  volume:number|null;
  openInterest:number|null;
  currency:string;
  multiplier:number|null;
}

export interface VolatilitySurfaceResult {
  status:'complete'|'partial'|'unavailable';
  market:'options';
  instrument:string;
  underlyingMarket:'stocks'|'crypto';
  source:string;
  fetchedAt:string;
  spot:number;
  currency:string|null;
  snapshotId:string;
  snapshotHash:string;
  nodes:VolatilitySurfaceNode[];
  expiries:Array<{
    expiryMs:number;
    expiry:string;
    daysToExpiry:number;
    nodes:number;
    callNodes:number;
    putNodes:number;
    missingIv:number;
    missingQuotes:number;
    skew:Array<{bucket:string;callIvPct:number|null;putIvPct:number|null;putMinusCallPp:number|null}>;
  }>;
  termStructure:ReturnType<typeof buildOptionIvTermStructure>;
  coverage:{validNodes:number;sourceNodes:number;expiries:number;coveredExpiries:number;coveragePct:number};
  missing:Array<{expiry:string;strike:number|null;optionType:string|null;reason:string}>;
  reason:string;
  interpolation:'none';
  executionEnabled:false;
  contentHash:string;
}

const hash=(value:unknown)=>{
  const encode=(item:any):string=>Array.isArray(item)?`[${item.map(encode).join(',')}]`:item&&typeof item==='object'?`{${Object.entries(item).sort(([a],[b])=>a.localeCompare(b)).map(([key,field])=>`${JSON.stringify(key)}:${encode(field)}`).join(',')}}`:JSON.stringify(item);
  return createHash('sha256').update(encode(JSON.parse(JSON.stringify(value)))).digest('hex');
};
const finitePositive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const expiryIso=(ms:number)=>new Date(ms).toISOString();

/**
 * Build a surface only from source IV and source quotes. Missing cells remain
 * holes; the function never interpolates across strikes, expiries or sources.
 */
export function buildOptionVolatilitySurface(chain:SavedOptionsChainEvidence):VolatilitySurfaceResult{
  if(!chain||chain.market!=='options'||!/^(option:cboe:[A-Z0-9.]+|option:deribit:(BTC|ETH))$/.test(chain.instrument)||!['stocks','crypto'].includes(chain.underlyingMarket))throw Error('期权快照市场或标的身份无效');
  if(!['CBOE Delayed Quotes','Deribit Public API'].includes(chain.source)||chain.snapshot?.source!==chain.source)throw Error('期权来源不可核验');
  if(!/^[a-f0-9]{64}$/.test(chain.contentHash)||hash(chain.snapshot)!==chain.contentHash)throw Error('期权快照内容Hash不一致');
  if(!Number.isFinite(Date.parse(chain.fetchedAt))||new Date(chain.snapshot.fetchedAt).getTime()!==Date.parse(chain.fetchedAt)||!finitePositive(chain.snapshot.spot))throw Error('期权快照时间或标的现价无效');
  if(String(chain.snapshot.asset).toUpperCase()!==chain.instrument.split(':').at(-1)!.toUpperCase())throw Error('期权快照资产与规范标的不一致');
  if(!Array.isArray(chain.snapshot.expiries)||!chain.snapshot.expiries.length)throw Error('期权快照没有到期数据');
  const currency=chain.source==='CBOE Delayed Quotes'?'USD':null;
  const fetched=Date.parse(chain.fetchedAt),nodes:VolatilitySurfaceNode[]=[],missing:VolatilitySurfaceResult['missing']=[],expiryResults:VolatilitySurfaceResult['expiries']=[];
  let sourceNodes=0,coveredExpiries=0;
  for(const expiry of chain.snapshot.expiries.slice(0,100)){
    const expiryMs=Number(expiry.expiryMs),expiryText=Number.isFinite(expiryMs)&&expiryMs>0?expiryIso(expiryMs):'unknown';
    if(!Number.isFinite(expiryMs)||expiryMs<=fetched||!Array.isArray(expiry.rows)||expiry.rows.length>5000){missing.push({expiry:expiryText,strike:null,optionType:null,reason:'到期时间位于过去、缺失或行数超过上限'});continue;}
    const validForExpiry:VolatilitySurfaceNode[]=[],seen=new Set<string>();let missingIv=0,missingQuotes=0;
    for(const row of expiry.rows){
      sourceNodes++;
      const key=`${row.optionType}:${row.strike}:${row.instrumentName}`;
      if(seen.has(key)){missing.push({expiry:expiryText,strike:Number.isFinite(row.strike)?row.strike:null,optionType:row.optionType||null,reason:'重复合约身份'});continue;}
      seen.add(key);
      const iv=Number(row.impliedVolPct);
      if(!Number.isFinite(iv)||iv<=0||iv>400){missingIv++;missing.push({expiry:expiryText,strike:Number.isFinite(row.strike)?row.strike:null,optionType:row.optionType||null,reason:'来源IV缺失或超出0–400%'});continue;}
      if(!finitePositive(row.bidPrice)||!finitePositive(row.askPrice)||row.askPrice<row.bidPrice||!['quoted','metrics-incomplete'].includes(row.quoteQuality?.status||'')){missingQuotes++;missing.push({expiry:expiryText,strike:Number.isFinite(row.strike)?row.strike:null,optionType:row.optionType||null,reason:'缺少有效双边报价或报价质量证据'});continue;}
      const quoteTime=row.quoteTime||chain.fetchedAt,quoteMs=Date.parse(quoteTime),multiplier=Number(row.multiplier);
      if(!Number.isFinite(quoteMs)||quoteMs>fetched+60000||quoteMs<fetched-5*60000||!Number.isFinite(row.strike)||row.strike<=0||!['call','put'].includes(row.optionType)){missing.push({expiry:expiryText,strike:Number.isFinite(row.strike)?row.strike:null,optionType:row.optionType||null,reason:'报价时间、行权价或合约类型不可核验'});continue;}
      if(row.contractCurrency!==undefined&&currency&&row.contractCurrency!==currency){missing.push({expiry:expiryText,strike:row.strike,optionType:row.optionType,reason:'合约币种与来源结算口径不一致'});continue;}
      validForExpiry.push({id:`surface_${hash({snapshot:chain.id,instrument:row.instrumentName,quoteTime,iv,bid:row.bidPrice,ask:row.askPrice}).slice(0,24)}`,
        expiryMs,expiry:expiryText,daysToExpiry:Math.max(0,(expiryMs-fetched)/86400000),strike:row.strike,moneynessPct:(row.strike/chain.snapshot.spot-1)*100,
        optionType:row.optionType,bid:row.bidPrice,ask:row.askPrice,impliedVolPct:iv,quoteTime:new Date(quoteMs).toISOString(),volume:row.volume??null,openInterest:row.openInterest??null,
        currency:currency||String(row.contractCurrency||chain.snapshot.asset),multiplier:Number.isFinite(multiplier)&&multiplier>0?multiplier:null});
    }
    validForExpiry.sort((a,b)=>a.strike-b.strike||a.optionType.localeCompare(b.optionType));
    nodes.push(...validForExpiry);
    if(validForExpiry.length)coveredExpiries++;
    const buckets=[{label:'<-5%',min:-Infinity,max:-5},{label:'-5%–0',min:-5,max:0},{label:'0–5%',min:0,max:5},{label:'>5%',min:5,max:Infinity}];
    const skew=buckets.map(bucket=>{
      const inBucket=validForExpiry.filter(row=>row.moneynessPct>=bucket.min&&row.moneynessPct<bucket.max);
      const average=(type:'call'|'put')=>{const rows=inBucket.filter(row=>row.optionType===type);return rows.length?rows.reduce((sum,row)=>sum+row.impliedVolPct,0)/rows.length:null;};
      const callIvPct=average('call'),putIvPct=average('put');
      return {bucket:bucket.label,callIvPct,putIvPct,putMinusCallPp:callIvPct!==null&&putIvPct!==null?putIvPct-callIvPct:null};
    });
    expiryResults.push({expiryMs,expiry:expiryText,daysToExpiry:Math.max(0,(expiryMs-fetched)/86400000),nodes:validForExpiry.length,callNodes:validForExpiry.filter(row=>row.optionType==='call').length,putNodes:validForExpiry.filter(row=>row.optionType==='put').length,missingIv,missingQuotes,skew});
  }
  const adapters=expiryResults.map(expiry=>{
    const suffix=chain.source==='CBOE Delayed Quotes'?`${expiry.expiryMs}`:`${expiry.expiryMs}`;
    const rows=nodes.filter(row=>row.expiryMs===expiry.expiryMs).map(row=>({
      instrumentName:chain.instrument.split(':').at(-1)+'-'+suffix+'-'+row.strike+'-'+(row.optionType==='call'?'C':'P'),
      strike:row.strike,optionType:row.optionType,bidPrice:row.bid,askPrice:row.ask,impliedVolPct:row.impliedVolPct,quoteTime:row.quoteTime,
      markPrice:null,premiumUsd:null,spreadPct:(row.ask-row.bid)/Math.max(row.bid,1e-12)*100,volume:row.volume,volumeUsd:null,openInterest:row.openInterest,
      quoteQuality:{status:'quoted' as const,label:'来源双边报价',referenceAsk:row.ask,referenceBid:row.bid},
    }));
    return {expiryMs:expiry.expiryMs,label:expiry.expiry.slice(0,10),daysToExpiry:expiry.daysToExpiry,rows,
      callOpenInterest:null,putOpenInterest:null,callVolume:null,putVolume:null,putCallOIRatio:null,putCallVolumeRatio:null,maxPainStrike:null,strategyIdeas:[],strategyIdeasStatus:{status:'unavailable' as const,reason:'曲面研究不生成策略建议'},dataQuality:{openInterest:{available:rows.filter(r=>r.openInterest!=null).length,total:rows.length,status:'partial' as const},volume:{available:rows.filter(r=>r.volume!=null).length,total:rows.length,status:'partial' as const},impliedVolatility:{available:rows.length,total:rows.length,status:'complete' as const},gammaExposure:{available:0,total:rows.length,status:'unavailable' as const}}};
  });
  const termStructure=buildOptionIvTermStructure(adapters,chain.snapshot.spot,chain.source,chain.fetchedAt);
  const status:VolatilitySurfaceResult['status']=nodes.length===0?'unavailable':missing.length?'partial':'complete';
  const data={status,market:'options' as const,instrument:chain.instrument,underlyingMarket:chain.underlyingMarket,source:chain.source,fetchedAt:chain.fetchedAt,spot:chain.snapshot.spot,currency,snapshotId:chain.id,snapshotHash:chain.contentHash,
    nodes,expiries:expiryResults,termStructure,coverage:{validNodes:nodes.length,sourceNodes,expiries:chain.snapshot.expiries.length,coveredExpiries,coveragePct:sourceNodes?nodes.length/sourceNodes*100:0},missing:missing.slice(0,2000),
    reason:status==='unavailable'?'没有同时具备来源IV、双边报价、合约身份和有效时点的曲面节点':status==='partial'?'部分节点或到期缺失；缺失区域保持空洞，未插值，也不从近期快照回填':'所有来源节点均满足同一快照、币种和报价证据要求',
    interpolation:'none' as const,executionEnabled:false as const};
  return {...data,contentHash:hash(data)};
}

export function findLatestSavedOptionChain(
  chains:SavedOptionsChainEvidence[],
  input:{instrument:string;asOf:string},
):SavedOptionsChainEvidence|null{
  const cut=Date.parse(input.asOf);if(!Number.isFinite(cut))throw Error('期权曲面截止时间无效');
  return chains.filter(chain=>chain.instrument===input.instrument&&Date.parse(chain.fetchedAt)<=cut).sort((a,b)=>Date.parse(b.fetchedAt)-Date.parse(a.fetchedAt)||a.id.localeCompare(b.id))[0]||null;
}
