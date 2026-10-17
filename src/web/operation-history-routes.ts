import express from 'express';
import { assertMarketContext } from '../features/research-contracts';

interface Deps {actionHistory():any[];metadata():{revision:number;history:Array<{id:string;revision:number;at:string}>};undoAction(id:string,expectedUpdatedAt:string):unknown;undoMetadata(id:string,revision:number):unknown}
export function createOperationHistoryRouter(deps:Deps){
  const router=express.Router();router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'操作历史仅管理员可读写'});return;}next();});
  router.get('/',(req,res)=>{
    const market=req.query.market?String(req.query.market):null;
    if(market&&!['stocks','options','crypto','prediction'].includes(market)){res.status(400).json({success:false,reason:'市场无效'});return;}
    const actions=deps.actionHistory().slice(0,500).filter(row=>{try{assertMarketContext({market:row.market,instrument:row.instrument,workspace:'action-center'});return !market||row.market===market;}catch{return false;}});
    const latest=new Set<string>();const data:any[]=actions.map(row=>{const last=!latest.has(row.itemId);latest.add(row.itemId);return {kind:'action',id:row.id,market:row.market,instrument:row.instrument||null,at:row.updatedAt,summary:'行动处理：'+Object.keys(row.changes||{}).filter(key=>['read','pinned','snoozedUntil'].includes(key)).join(' / '),canUndo:last&&!!row.next?.updatedAt,expectedUpdatedAt:row.next?.updatedAt||null,undoOf:row.undoOf||null};});
    if(!market){const metadata=deps.metadata();data.push(...metadata.history.map((row,index)=>({kind:'metadata',id:row.id,market:null,instrument:null,at:row.at,summary:'全局自选分组 / 标签 / 排序变更（原范围未单独归档）',canUndo:index===metadata.history.length-1&&row.revision===metadata.revision,revision:metadata.revision})));}
    const rows=data.filter(row=>Number.isFinite(Date.parse(row.at))).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,200);
    res.json({success:true,market,data:rows,dataStatus:rows.length?'historical':'empty',source:'现有SQLite处理历史与自选版本',updatedAt:new Date().toISOString(),reason:'仅聚合已记录的行动处理与自选元数据。表格布局撤销保留在当前设备；账户、策略和订单操作不在此撤销，未记录的旧操作不重建。',evidenceRefs:[]});
  });
  router.post('/undo',(req,res)=>{
    const body=req.body||{};if(typeof body.id!=='string'||body.id.length>160||!['action','metadata'].includes(body.kind)||Object.keys(body).some(key=>!['id','kind','expectedUpdatedAt','revision'].includes(key))||body.kind==='action'&&typeof body.expectedUpdatedAt!=='string'||body.kind==='metadata'&&!Number.isSafeInteger(body.revision)){res.status(400).json({success:false,reason:'只能撤销已记录处理或自选元数据，必须提供当前版本；不接受订单、账户或任意状态'});return;}
    try{const data=body.kind==='action'?deps.undoAction(body.id,body.expectedUpdatedAt):deps.undoMetadata(body.id,body.revision);res.json({success:true,data,reason:'已记录撤销；没有创建或撤销订单、改变策略或AI配置'});}catch{res.status(409).json({success:false,reason:'记录已变化、存在后续修改或不可恢复，请刷新历史；未覆盖新状态'});}
  });return router;
}
