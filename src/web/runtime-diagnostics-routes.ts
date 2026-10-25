import express from 'express';
import type {createRuntimeObservability} from '../features/runtime-observability';
export function createRuntimeDiagnosticsRouter(runtime:ReturnType<typeof createRuntimeObservability>,build:()=>unknown){
 const router=express.Router();router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if((req as any).user?.role!=='admin'){res.status(403).json({success:false,reason:'运行诊断仅限管理员'});return;}next();});
 router.get('/',(req,res)=>{if(Object.keys(req.query).length){res.status(400).json({success:false,reason:'诊断不接受URL、路径或筛选参数'});return;}res.json({success:true,data:{...runtime.diagnostics(),summary:runtime.snapshot(),build:build()},reason:'只读进程内诊断；不修改网络、不发起模型或交易操作'});});return router;
}
