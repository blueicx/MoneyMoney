import express from 'express';
import type {TimeSeriesConditionInput,TimeSeriesConditionStore} from '../features/time-series-conditions';
import type {EvidenceSnapshot} from '../features/decision-intelligence';
import {verifyEvidenceSnapshotHash} from '../features/decision-intelligence';

type EvidenceSource=Map<string,EvidenceSnapshot>|((id:string)=>EvidenceSnapshot|null);
type ProjectLinker={link:(projectId:string,version:number,reference:{kind:'condition-hit';id:string})=>unknown};

function requestFields(input:Record<string,unknown>,allowed:string[]){
  if(!input||Object.keys(input).some(key=>!allowed.includes(key)))throw Error('请求包含未允许字段');
}
function idempotencyKey(req:express.Request){
  const value=String(req.get('idempotency-key')||'').trim();
  if(!/^[A-Za-z0-9._:-]{8,128}$/.test(value))throw Error('写请求需要有效 Idempotency-Key');
  return value;
}
function expectedVersion(req:express.Request,body:Record<string,unknown>){
  const header=String(req.get('if-match')||'').trim().replace(/^W\//,'').replace(/^"|"$/g,'');
  if(!/^\d+$/.test(header))throw Error('写请求需要有效 If-Match 版本');
  const version=Number(header);
  if(body.expectedVersion!==undefined&&Number(body.expectedVersion)!==version)throw Error('If-Match 与请求版本不一致');
  return version;
}
function statusFor(error:unknown){
  const message=error instanceof Error?error.message:'';
  if(/不存在|未找到/.test(message))return 404;
  if(/版本已变化|幂等键已用于|不自动替换/.test(message))return 409;
  return 400;
}

export function createTimeSeriesConditionRouter(store:TimeSeriesConditionStore,deps:{
  projects:ProjectLinker;
  evidence:EvidenceSource;
  listEvidence?:(market:string,instrument:string)=>EvidenceSnapshot[];
  adminOnly:(req:express.Request,res:express.Response)=>boolean;
  csrfValid:(req:express.Request)=>boolean;
}){
  const router=express.Router();
  router.use((req,res,next)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!deps.adminOnly(req,res))return;
    if(req.method!=='GET'&&!deps.csrfValid(req)){res.status(403).json({success:false,dataStatus:'failed',reason:'CSRF 校验失败'});return;}
    next();
  });
  const fail=(res:express.Response,error:unknown)=>res.status(statusFor(error)).json({success:false,dataStatus:'failed',reason:error instanceof Error?error.message:'时间序列条件不可用'});
  const envelope=(data:unknown,dataStatus:string,reason:string|null,evidenceRefs:string[]=[],market='stocks',instrument:string|null=null)=>({
    success:true,
    market,
    instrument,
    data,
    dataStatus,
    reason,
    source:'已保存证据 / 有序条件规则',
    updatedAt:new Date().toISOString(),
    evidenceRefs,
    modelCalls:0,
    ordersCreated:0,
    readOnly:false,
  });
  const allEvidence=(market:string,instrument:string)=>deps.listEvidence?.(market,instrument)??(typeof deps.evidence==='function'?[]:[...deps.evidence.values()]);
  router.get('/',(req,res)=>{
    try{
      requestFields(req.query as Record<string,unknown>,['market','instrument']);
      const market=req.query.market===undefined?null:String(req.query.market),instrument=req.query.instrument===undefined?null:String(req.query.instrument);
      if(market!==null&&!['stocks','options','crypto','prediction'].includes(market))throw Error('条件规则市场无效');
      if(instrument!==null&&(!instrument.trim()||instrument.length>200))throw Error('条件规则标的无效');
      const data=store.list().filter(row=>(!market||row.market===market)&&(!instrument||row.instrument===instrument));
      res.json(envelope(data,data.length?'historical':'empty',data.length?null:'没有匹配的已保存时间序列条件',[],market||'stocks',instrument));
    }catch(error){fail(res,error);}
  });
  router.get('/evidence',(req,res)=>{
    try{
      requestFields(req.query as Record<string,unknown>,['market','instrument']);
      const market=String(req.query.market||''),instrument=String(req.query.instrument||'');
      if(!['stocks','options','crypto','prediction'].includes(market)||!instrument.trim()||instrument.length>200)throw Error('证据查询需要明确市场和标的');
      if(typeof deps.evidence==='function'&&!deps.listEvidence)throw Error('当前证据目录只支持按引用核验，不提供枚举');
      const data=allEvidence(market,instrument).filter(row=>row.market===market&&row.instrument===instrument&&verifyEvidenceSnapshotHash(row)).sort((left,right)=>right.observedAt.localeCompare(left.observedAt)).slice(0,200).map(row=>({
        id:row.id,
        hash:row.hash,
        market:row.market,
        instrument:row.instrument,
        workspace:row.workspace,
        dataStatus:row.dataStatus,
        observedAt:row.observedAt,
        fetchedAt:row.fetchedAt,
        source:row.source,
        fields:Object.keys(row.fields).sort(),
      }));
      res.json(envelope(data,data.length?'historical':'empty',data.length?null:'该市场与标的没有可核验的已保存证据',data.map(row=>row.id)));
    }catch(error){fail(res,error);}
  });
  router.get('/rules/:id/history',(req,res)=>{
    try{res.json(envelope(store.history(String(req.params.id)),'historical',null));}catch(error){fail(res,error);}
  });
  router.get('/rules/:id',(req,res)=>{
    try{
      const data=store.get(String(req.params.id));
      res.json(envelope(data,'historical',null,data.manifest.evidenceIds,data.manifest.market,data.manifest.instrument));
    }catch(error){fail(res,error);}
  });
  router.post('/rules/preview',(req,res)=>{
    try{
      requestFields(req.body||{},['market','instrument','name','asOf','evidenceIds','maxSpanMs','steps','exclusions']);
      const key=idempotencyKey(req),data=store.preview({...(req.body||{}),requestId:key} as TimeSeriesConditionInput);
      res.status(201).json(envelope(data,'historical','规则清单已校验并保存为预览；确认并手动运行前不计算命中',data.manifest.evidenceIds,data.manifest.market,data.manifest.instrument));
    }catch(error){fail(res,error);}
  });
  router.post('/rules/:id/confirm',(req,res)=>{
    try{
      requestFields(req.body||{},['expectedVersion','contentHash','acknowledge']);
      const body=req.body||{},version=expectedVersion(req,body),data=store.confirm(String(req.params.id),{expectedVersion:version,contentHash:String(body.contentHash||''),acknowledge:body.acknowledge===true,confirmationKey:idempotencyKey(req)});
      res.json(envelope(data,'historical','规则已确认；尚未运行，也不会自动创建或修改研究项目',data.manifest.evidenceIds,data.manifest.market,data.manifest.instrument));
    }catch(error){fail(res,error);}
  });
  router.post('/rules/:id/run',(req,res)=>{
    try{
      requestFields(req.body||{},['expectedVersion','contentHash']);
      const body=req.body||{},version=expectedVersion(req,body),rule=store.get(String(req.params.id)),data=store.run(String(req.params.id),{expectedVersion:version,contentHash:String(body.contentHash||''),runKey:idempotencyKey(req)});
      res.status(201).json(envelope(data,data.status==='calculated'?'historical':'empty',data.reason,data.evidenceIds,rule.manifest.market,rule.manifest.instrument));
    }catch(error){fail(res,error);}
  });
  router.post('/rules/:id/hits/:hitId/link',(req,res)=>{
    try{
      requestFields(req.body||{},['expectedVersion','projectId','projectVersion']);
      const body=req.body||{},version=expectedVersion(req,body),data=store.linkHit(String(req.params.id),String(req.params.hitId),{expectedVersion:version,projectId:String(body.projectId||''),projectVersion:Number(body.projectVersion),linkKey:idempotencyKey(req)},deps.projects);
      res.json(envelope(data,'historical','固定条件命中已由用户显式关联到研究项目；未执行交易或自动创建项目',[String(req.params.hitId)]));
    }catch(error){fail(res,error);}
  });
  return router;
}
