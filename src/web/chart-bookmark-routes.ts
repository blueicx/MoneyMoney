import express from 'express';
import { createChartBookmark, readChartBookmark, chartBookmarkLink } from '../features/chart-bookmarks';
import type { SavedWorkspace } from '../features/decision-intelligence';
export function createChartBookmarkRouter(deps:{list(market?:string):SavedWorkspace[];get(id:string):SavedWorkspace|null;save(row:SavedWorkspace):unknown;base?():string|null}){
  const router=express.Router();router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'图表书签与研究批注仅管理员可读写'});return;}next();});
  const expose=(row:SavedWorkspace)=>({...row,deepLink:chartBookmarkLink(deps.base?.(),row)});
  const envelope=(data:unknown)=>({success:true,data,dataStatus:'historical',source:'私人SavedWorkspace / SQLite',updatedAt:new Date().toISOString(),reason:'书签不是行情或当时已知证据，不自动请求历史回补、不改变跑单或创建订单',evidenceRefs:[]});
  router.get('/',(req,res)=>{const market=String(req.query.market||''),instrument=String(req.query.instrument||''),timeframe=String(req.query.timeframe||'');
    if(!['stocks','crypto'].includes(market)||!instrument.startsWith(market==='stocks'?'stock:':'crypto:')||!/^\w+:[^\s:]{1,40}:[^\s]{1,180}$/.test(instrument)||!/^[A-Za-z0-9]{1,12}$/.test(timeframe)){res.status(400).json({success:false,reason:'需要同市场、规范标的与周期'});return;}
    res.json(envelope(deps.list(market).map(readChartBookmark).filter((row):row is SavedWorkspace=>!!row&&row.instrument===instrument&&row.timeframe===timeframe).map(expose)));
  });
  router.get('/:id',(req,res)=>{const row=readChartBookmark(deps.get(String(req.params.id)));if(!row){res.status(404).json({success:false,reason:'私人书签不存在或配置未经核验'});return;}res.json(envelope(expose(row)));});
  router.post('/',(req,res)=>{try{if(deps.list().length>=200)throw Error('已有工作区达到容量上限，未删除旧记录');const row=createChartBookmark(req.body);deps.save(row);res.status(201).json(envelope(expose(row)));}catch(error){res.status(400).json({success:false,reason:error instanceof Error?error.message:'书签保存失败'});}});
  return router;
}
