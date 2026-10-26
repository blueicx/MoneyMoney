import {createHash} from 'node:crypto';
import type {ResearchProject} from './research-projects';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface EvidenceGraphNode {id:string;kind:'project'|'conclusion'|'reference'|'parameter'|'snapshot';label:string;market:string;fixedHash:string|null;currentHash:string|null;status:'current'|'changed'|'missing'|'immutable'|'unknown';referenceId?:string;instrument?:string;values?:Record<string,unknown>}
export interface EvidenceGraphEdge {id:string;from:string;to:string;kind:'project-link'|'conclusion-evidence'|'experiment-parameter'|'experiment-snapshot';label:string}
export interface EvidenceGraph {projectId:string;market:string;projectVersion:number;nodes:EvidenceGraphNode[];edges:EvidenceGraphEdge[];affectedPaths:Array<{referenceLinkId:string;conclusionId:string;path:string[]}>;unknowns:string[]}
export function buildResearchEvidenceGraph(project:ResearchProject,states:Array<{linkId:string;pinnedHash:string;current:{hash:string;revisionHash?:string;market:string;instrument?:string}|null;changed:boolean|null;reason?:string}>,getSavedExperiment?:(id:string)=>any|null):EvidenceGraph{
 if(!project||!['stocks','crypto','options','prediction'].includes(project.market)||!Array.isArray(project.links)||!Array.isArray(project.conclusions))throw Error('研究项目格式或市场无效');
 const byLink=new Map(states.map(row=>[row.linkId,row])),nodes:EvidenceGraphNode[]=[],edges:EvidenceGraphEdge[]=[],affectedPaths:EvidenceGraph['affectedPaths']=[],unknowns:string[]=[];
 nodes.push({id:'project:'+project.id,kind:'project',label:project.title,market:project.market,fixedHash:null,currentHash:null,status:'immutable'});
 for(const link of project.links){
  if(link.market!==project.market)throw Error('证据图拒绝跨市场引用');
  if(!/^[a-f0-9]{64}$/i.test(link.hash)||!link.linkId)throw Error('项目引用缺少可核验的固定 Hash 或 ID');
  const state=byLink.get(link.linkId),currentHash=state?.current?(state.current.revisionHash||state.current.hash):null;
  if(state?.current&&(state.current.market!==project.market||state.current.instrument!==link.instrument))throw Error('证据图引用的当前市场或标的身份已变化');
  const status:EvidenceGraphNode['status']=!state||!state.current?'missing':state.changed===true||currentHash!==link.hash?'changed':'current';
  const nodeId='reference:'+link.linkId;
  nodes.push({id:nodeId,kind:['partition','evidence'].includes(link.kind)?'snapshot':'reference',label:`${link.kind} · ${link.id}`,market:link.market,fixedHash:link.hash,currentHash,status,referenceId:link.id,...(link.instrument?{instrument:link.instrument}:{})});
  edges.push({id:'project-reference:'+link.linkId,from:'project:'+project.id,to:nodeId,kind:'project-link',label:'项目显式固定引用'});
  if(link.kind==='experiment'&&getSavedExperiment){
   const saved=getSavedExperiment(link.id);
   if(saved?.experiment?.id===link.id&&saved.experiment.market===project.market&&saved.experiment.instrument===link.instrument&&hash(saved)===link.hash){
    const parameters=saved.experiment.parameters??saved.parameters??saved.input?.context?.parameters??saved.input?.parameters;
    if(parameters&&typeof parameters==='object'&&!Array.isArray(parameters)){
     const parameterHash=hash(parameters),parameterId='parameters:'+link.linkId;
     nodes.push({id:parameterId,kind:'parameter',label:`已保存实验参数 · ${link.id}`,market:project.market,fixedHash:parameterHash,currentHash:parameterHash,status:'immutable',referenceId:link.id,instrument:link.instrument,values:parameters});
     edges.push({id:'experiment-parameters:'+link.linkId,from:nodeId,to:parameterId,kind:'experiment-parameter',label:'Hash 匹配的已保存参数'});
    }else unknowns.push(`实验 ${link.id} 未保存可核验参数，未建立参数边`);
    const explicitRefs=new Set<string>();
    const addRefs=(value:unknown)=>{if(Array.isArray(value))for(const row of value){if(typeof row==='string')explicitRefs.add(row);else if(row&&typeof row==='object')for(const key of ['id','referenceId','snapshotId','partitionId','contentHash','hash'])if(typeof (row as any)[key]==='string')explicitRefs.add((row as any)[key]);}else if(typeof value==='string')explicitRefs.add(value);};
    addRefs(saved.snapshotRefs);addRefs(saved.partitionRefs);addRefs(saved.experiment.snapshotRefs);addRefs(saved.experiment.partitionRefs);addRefs(saved.input?.snapshotRefs);addRefs(saved.input?.partitionRefs);addRefs(saved.input?.context?.snapshotId);addRefs(saved.input?.context?.dataSnapshotHash);addRefs(saved.experiment.dataSnapshotHash);
    let linkedCount=0;
    for(const target of project.links){if(!['partition','evidence'].includes(target.kind)||target.market!==project.market||target.instrument!==link.instrument||(!explicitRefs.has(target.id)&&!explicitRefs.has(target.hash)))continue;
     const targetState=byLink.get(target.linkId);
     if(targetState?.current&&(targetState.current.market!==project.market||targetState.current.instrument!==target.instrument))throw Error('显式数据引用的市场或标的身份已变化');
     const targetNode='reference:'+target.linkId;
     edges.push({id:`experiment-snapshot:${link.linkId}:${target.linkId}`,from:nodeId,to:targetNode,kind:'experiment-snapshot',label:'实验记录中明确保存的数据引用'});linkedCount++;
    }
    if(!linkedCount)unknowns.push(`实验 ${link.id} 未找到项目中同身份且明确匹配的快照或分区引用`);
   }else unknowns.push(`实验 ${link.id} 已缺失或当前内容 Hash 与固定 Hash 不同；不以当前参数替代固定历史`);
  }
  if(status==='missing')unknowns.push(`${link.kind}:${link.id} 当前不可核验`);
  else if(status==='changed')unknowns.push(`${link.kind}:${link.id} 当前Hash与固定Hash不同，保留原引用`);
 }
 for(const conclusion of project.conclusions){
  const conclusionId='conclusion:'+conclusion.id;
  nodes.push({id:conclusionId,kind:'conclusion',label:conclusion.text,market:project.market,fixedHash:hash(conclusion),currentHash:null,status:'immutable'});
  for(const reference of conclusion.references){
   if(reference.market!==project.market)throw Error('证据图拒绝跨市场结论引用');
   const linked=project.links.find(link=>link.linkId===reference.linkId);
   if(!linked||linked.id!==reference.id||linked.kind!==reference.kind||linked.hash!==reference.hash)throw Error('结论只允许沿本项目中已保存且 Hash 一致的明确引用建边');
   const referenceId='reference:'+linked.linkId;
   edges.push({id:`conclusion-reference:${conclusion.id}:${linked.linkId}`,from:conclusionId,to:referenceId,kind:'conclusion-evidence',label:'结论使用的固定引用'});
   const visit=(nodeId:string,path:string[],seen:Set<string>)=>{
    if(seen.has(nodeId))return;
    const node=nodes.find(item=>item.id===nodeId);
    if(node&&['changed','missing'].includes(node.status)){const terminal=node.id.slice('reference:'.length);if(!affectedPaths.some(row=>row.conclusionId===conclusion.id&&row.referenceLinkId===terminal&&row.path.join('\0')===path.join('\0')))affectedPaths.push({referenceLinkId:terminal,conclusionId:conclusion.id,path});return;}
    const nextSeen=new Set(seen);nextSeen.add(nodeId);
    for(const edge of edges)if(edge.from===nodeId&&['experiment-snapshot','conclusion-evidence'].includes(edge.kind))visit(edge.to,[...path,edge.to],nextSeen);
   };
   visit(referenceId,[conclusionId,referenceId],new Set());
  }
 }
 return {projectId:project.id,market:project.market,projectVersion:project.version,nodes,edges,affectedPaths,unknowns};
}

const xml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
/** Minimal SVG for the same explicit graph; node names are escaped and have text equivalents in the API. */
export function renderResearchEvidenceGraphSvg(graph:EvidenceGraph){
 const width=1200,columnX:Record<EvidenceGraphNode['kind'],number>={project:40,conclusion:330,reference:620,parameter:910,snapshot:910},counts=new Map<string,number>(),positions=new Map(graph.nodes.map(node=>{const column=node.kind==='parameter'||node.kind==='snapshot'?'last':node.kind,row=counts.get(column)||0;counts.set(column,row+1);return [node.id,{x:columnX[node.kind],y:30+row*82}];})),height=Math.max(240,Math.max(0,...counts.values())*82+40);
 const edgeSvg=graph.edges.map(edge=>{const a=positions.get(edge.from)!,b=positions.get(edge.to)!;return `<path d="M ${a.x+250} ${a.y+28} C ${a.x+280} ${a.y+28}, ${b.x-20} ${b.y+28}, ${b.x} ${b.y+28}" fill="none" stroke="#64748b" stroke-width="2"><title>${xml(edge.label)}</title></path>`;}).join('');
 const nodeSvg=graph.nodes.map(node=>{const p=positions.get(node.id)!,color=node.status==='changed'?'#fef3c7':node.status==='missing'?'#fee2e2':'#e0f2fe',hashes=`固定 ${node.fixedHash||'未知'} · 当前 ${node.currentHash||'未知'}`;return `<g role="group" tabindex="0" aria-label="${xml(`${node.label}, ${node.status}, ${hashes}`)}"><rect x="${p.x}" y="${p.y}" width="250" height="56" rx="8" fill="${color}" stroke="#475569"/><text x="${p.x+12}" y="${p.y+23}" font-size="14">${xml(node.label.slice(0,34))}</text><text x="${p.x+12}" y="${p.y+43}" font-size="11">${xml(node.status)} · ${xml((node.fixedHash||'未知').slice(0,12))} / ${xml((node.currentHash||'未知').slice(0,12))}</text></g>`;}).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="graph-title graph-desc"><title id="graph-title">研究证据关系图</title><desc id="graph-desc">只包含研究项目显式固定的引用与结论引用。Hash 和状态请以旁边的结构化表格为准。</desc>${edgeSvg}${nodeSvg}</svg>`;
}
