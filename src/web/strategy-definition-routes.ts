import express from 'express';
import {StrategyDefinitionStore,restrictedStrategy} from '../features/strategy-definitions';
import {assertMarketContext,MarketId} from '../features/research-contracts';
import {runRestrictedHistoricalExperiment} from '../features/restricted-experiment';
interface History {rows:Array<Record<string,any>>;dataStatus:string;source:string|null;updatedAt:string|null;reason?:string;snapshot?:{id:string;contentHash:string}}
export function createStrategyDefinitionRouter(store:StrategyDefinitionStore,history:(input:{market:MarketId;instrument:string;timeframe:string;asOf:string})=>Promise<History>,resolve?:(market:MarketId,instrument:string)=>{id:string;symbol:string}|null,experiments?:{get:(id:string)=>any;save:(id:string,result:any)=>any}){
 const router=express.Router();router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,dataStatus:'unavailable',reason:'策略定义与条件解释仅限管理员'});return;}next();});
 const fail=(res:express.Response,e:unknown)=>res.status(400).json({success:false,dataStatus:'failed',reason:e instanceof Error?e.message:'策略定义请求失败'});
 const wrap=(row:any)=>({success:true,market:row.market,instrument:null,dataStatus:'historical',source:'私人不可变策略定义',updatedAt:row.createdAt,reason:'仅研究定义；保存、预览不启动监控或创建订单',evidenceRefs:[],data:row});
 const scoped=(req:express.Request)=>{const row=store.read(String(req.params.id),String(req.method==='GET'?req.query.hash||'':req.body?.hash||'')||undefined);if(row.market!==(req.method==='GET'?req.query.market:req.body?.market))throw Error('策略定义市场上下文不匹配');return row;};
 router.get('/',(req,res)=>{try{const market=String(req.query.market||'');res.json({success:true,market,data:store.list(market),dataStatus:'historical',source:'私人策略定义目录',updatedAt:null,reason:'未启动任何策略',evidenceRefs:[]});}catch(e){fail(res,e);}});
 router.get('/capabilities',(req,res)=>res.json({success:true,data:restrictedStrategy.capabilities,interpreterVersion:restrictedStrategy.version}));
 router.post('/',(req,res)=>{try{res.json(wrap(store.save(req.body?.definition)));}catch(e){fail(res,e);}});
 router.get('/:id',(req,res)=>{try{res.json(wrap(scoped(req)));}catch(e){fail(res,e);}});
 router.get('/:id/versions',(req,res)=>{try{const row=scoped(req);res.json({...wrap(row),data:store.versions(row.id)});}catch(e){fail(res,e);}});
 router.post('/:id/versions',(req,res)=>{try{scoped(req);res.json(wrap(store.save(req.body?.definition,String(req.params.id),req.body?.hash)));}catch(e){fail(res,e);}});
 router.post(['/:id/preview','/:id/experiment'],async(req,res)=>{try{
  if(Object.keys(req.body||{}).some(k=>!['market','instrument','hash','asOf'].includes(k)))throw Error('预览仅读取服务端已发布分区，不接受客户端行情');const row=scoped(req),market=row.market as MarketId,instrument=String(req.body?.instrument||''),asOf=String(req.body?.asOf||'');assertMarketContext({market,workspace:'research-lab',instrument});if(!instrument||!Number.isFinite(Date.parse(asOf))||Date.parse(asOf)>Date.now())throw Error('需要明确标的和非未来时点');
  const identity=resolve?.(market,instrument);if(!identity){res.json({success:true,market,instrument,dataStatus:'unavailable',source:null,updatedAt:null,reason:'标的身份尚未核验，不能解释历史条件',evidenceRefs:[],data:null});return;}
  const execution=req.path.endsWith('/experiment');
  if(execution&&(!experiments||market!=='stocks')){res.json({success:true,market,instrument,dataStatus:'unsupported',source:null,updatedAt:null,reason:'当前成交研究仅支持已核验股票历史；其他市场不补位',evidenceRefs:[],data:null});return;}
  const result=await history({market,instrument,timeframe:row.definition.timeframe,asOf});const base={success:true,market,instrument,dataStatus:result.dataStatus,source:result.source,updatedAt:result.updatedAt,reason:result.reason||null,evidenceRefs:result.snapshot?[result.snapshot.id]:[],strategyHash:row.hash,interpreterVersion:row.interpreterVersion};
  if(result.dataStatus!=='historical'||!result.snapshot||!result.rows.length){res.json({...base,data:null,reason:result.reason||'缺少可核验的历史时点快照'});return;}
  if(!/^[a-f0-9]{64}$/.test(result.snapshot.contentHash))throw Error('历史数据Hash不可核验');
  if(result.rows.some(b=>b.market!==market||b.instrument!==identity.symbol||b.timeframe!==row.definition.timeframe||typeof b.source!=='string'||!b.source.trim()))throw Error('历史分区市场、标的、周期或来源身份不一致');
  const bars=result.rows.filter(b=>b.published_at==null||Date.parse(String(b.published_at))<=Date.parse(asOf)).map(b=>({time:b.timestamp instanceof Date?b.timestamp.getTime():Date.parse(String(b.timestamp)),open:b.open,high:b.high,low:b.low,close:b.close,closed:b.closed,publishedAt:b.published_at==null?null:Date.parse(String(b.published_at)),...(b.volume==null?{}:{volume:b.volume})}));
  if(execution){
   const study=runRestrictedHistoricalExperiment({version:row,market,instrument,asOf:Date.parse(asOf),source:result.source||'',snapshotId:result.snapshot.id,dataHash:result.snapshot.contentHash,bars});
   const existing=experiments!.get(study.experiment.id),saved=existing||experiments!.save(study.experiment.id,study)||study;
   if(saved.experiment?.market!==market||saved.experiment?.instrument!==instrument||saved.experiment?.strategyVersion!==row.hash||saved.experiment?.dataSnapshotHash!==result.snapshot.contentHash)throw Error('已保存实验身份或Hash不一致，不猜测修复');
   res.json({...base,dataHash:result.snapshot.contentHash,data:saved,reason:study.reason});return;
  }
  res.json({...base,dataHash:result.snapshot.contentHash,data:restrictedStrategy.evaluate(row.definition,bars,Date.parse(asOf)),reason:'只解释已完成K线，非回测收益或交易指令；缺失数据不补齐'});
 }catch(e){fail(res,e);}});
 return router;
}
