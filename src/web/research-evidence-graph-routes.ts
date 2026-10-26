import express from 'express';
import type {ResearchProjectStore} from '../features/research-projects';
import {buildResearchEvidenceGraph,renderResearchEvidenceGraphSvg} from '../features/research-evidence-graph';
const fail=(res:express.Response,error:unknown)=>res.status(400).json({success:false,reason:error instanceof Error?error.message:'证据图不可用'});
export function createResearchEvidenceGraphRouter(deps:{projects:Pick<ResearchProjectStore,'read'|'referenceStates'>;adminOnly:(req:express.Request,res:express.Response)=>boolean;getSavedExperiment?:(id:string)=>any|null}){
 const router=express.Router();router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if(!deps.adminOnly(req,res))return;next();});
 const graph=(req:express.Request)=>{if(Object.keys(req.query).some(k=>k!=='market')||!['stocks','crypto','options','prediction'].includes(String(req.query.market)))throw Error('证据图必须明确有效市场');const project=deps.projects.read(String(req.params.id));if(project.market!==String(req.query.market))throw Error('研究项目市场上下文不匹配');return buildResearchEvidenceGraph(project,deps.projects.referenceStates(project.id),deps.getSavedExperiment);};
 router.get('/:id/graph.svg',(req,res)=>{try{res.type('image/svg+xml').send(renderResearchEvidenceGraphSvg(graph(req)));}catch(e){fail(res,e);}});
 router.get('/:id/graph',(req,res)=>{try{const data=graph(req);res.json({success:true,market:data.market,dataStatus:data.unknowns.length?'partial':'historical',source:'项目显式固定引用与结论',reason:'只沿已保存链接、结论及明确引用建立边；未推断内嵌参数或快照关系',evidenceRefs:data.nodes.filter(n=>n.kind==='reference').map(n=>n.referenceId),data});}catch(e){fail(res,e);}});
 return router;
}
