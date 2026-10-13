import express from 'express';
import { WatchlistMetadataStore } from '../features/watchlist-metadata';

export function createWatchlistMetadataRouter(store: WatchlistMetadataStore) {
  const router = express.Router();
  router.use((req,res,next) => {
    res.setHeader('Cache-Control','private, no-store');
    if ((req as any).user?.role !== 'admin') { res.status(403).json({success:false,reason:'仅管理员可访问自选分组与研究标签'}); return; }
    next();
  });
  const result = (data:unknown) => ({success:true,data,source:'管理员自选 / SQLite',dataStatus:'cached',updatedAt:new Date().toISOString(),reason:null,evidenceRefs:[]});
  router.get('/',(_req,res) => res.json(result(store.read())));
  for (const undo of [false,true]) router.post(undo?'/undo':'/',(req,res) => {
    try {
      const body=req.body;
      const allowed=undo?['revision','operationId']:['revision','changes','groups'];
      if(!body||Object.keys(body).some(key=>!allowed.includes(key))||!Number.isSafeInteger(body.revision)||body.revision<0) throw Error('无效版本或字段');
      if(undo && (typeof body.operationId!=='string'||body.operationId.length>64))throw Error('撤销身份无效');
      const data=undo?store.undo(body.operationId,body.revision):store.apply(body.revision,{changes:body.changes,groups:body.groups});
      res.json(result(data));
    } catch(error) {
      const reason=error instanceof Error?error.message:'保存失败';
      res.status(/版本已变化|后续修改/.test(reason)?409:400).json({success:false,dataStatus:'failed',reason});
    }
  });
  return router;
}
