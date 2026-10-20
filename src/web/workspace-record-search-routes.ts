import express from 'express';
import { assertMarketContext } from '../features/research-contracts';

type RecordSummary={id:string;market:string;instrument:string;strategyVersion?:string;status?:string;updatedAt?:string};
type ProjectSummary={id:string;market:string;title:string;updatedAt?:string};
/** Explicit user search only. Never fetch providers or return private record payloads. */
export function createWorkspaceRecordSearchRouter(deps:{experiments():RecordSummary[];orders():RecordSummary[];projects?:(market:string)=>ProjectSummary[]}){
  const router=express.Router();
  router.get('/',(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'仅管理员可搜索私人项目、实验和模拟订单'});return;}
    const market=String(req.query.market||''),q=String(req.query.q||'').trim().toLowerCase();
    if(!['stocks','options','crypto','prediction'].includes(market)||q.length<2||q.length>80){res.status(400).json({success:false,reason:'需要明确市场和2–80字符查询'});return;}
    try{
      const data=[['experiment',deps.experiments()],['order',deps.orders()]] as const;
      const projectRows=(deps.projects?.(market)||[]).slice(0,100).filter(row=>row.market===market&&row.id&&[row.id,row.title].join(' ').toLowerCase().includes(q)).map(row=>({kind:'project',id:String(row.id).slice(0,160),title:String(row.title).slice(0,160),market,instrument:null,strategyVersion:null,status:null,updatedAt:row.updatedAt||null}));
      const found=[...projectRows,...data.flatMap(([kind,rows])=>rows.slice(-200).flatMap(row=>{
        if(row.market!==market||!row.id||!row.instrument)return [];
        try{assertMarketContext({market:market as any,instrument:row.instrument,workspace:kind==='experiment'?'research-lab':'orders'});}catch{return [];}
        if(![row.id,row.instrument,row.strategyVersion||''].join(' ').toLowerCase().includes(q))return [];
        return [{kind,id:String(row.id).slice(0,160),market,instrument:String(row.instrument).slice(0,160),strategyVersion:row.strategyVersion?String(row.strategyVersion).slice(0,120):null,status:row.status?String(row.status).slice(0,60):null,updatedAt:row.updatedAt||null}];
      }))].slice(0,20);
      res.json({success:true,market,data:found,dataStatus:found.length?'historical':'empty',source:'已保存研究项目与统一模拟账本',updatedAt:new Date().toISOString(),reason:'搜索本市场最多100个项目及最近各200条保存记录，最多20项；不抓取上游或返回模型输入、预算和账户明细',evidenceRefs:[]});
    }catch{res.status(503).json({success:false,market,dataStatus:'unavailable',reason:'私人记录暂不可读，未回退其他市场'});}
  });return router;
}
