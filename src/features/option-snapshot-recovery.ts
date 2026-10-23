import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {DataLakeCatalog} from '../storage/data-lake';
import type {SQLiteStateStore} from '../storage/sqlite-state';
import {OptionRecoveryJournal,type RecoveryOperation} from './option-recovery-journal';

const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const backupPattern=/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
type Input={market:string;instrument:string;snapshotId:string;backupId:string};
type OperationInput={market:string;instrument:string;operationId:string;action:'finalize'|'rollback'};
type RecoveryState=Pick<SQLiteStateStore,'transaction'|'appendAudit'|'getAudit'|'acquireLease'|'releaseLease'|'refreshLease'>;
/** Exact single-file recovery. Does not restore databases, rewrite catalog identities, or use upstream requests. */
export class OptionSnapshotRecovery {
 private journal:OptionRecoveryJournal;
 constructor(private root:string,private catalog:DataLakeCatalog,private state:RecoveryState,private now=Date.now,private checkpoint?:(stage:string,operation:RecoveryOperation)=>void){this.root=path.resolve(root);this.journal=new OptionRecoveryJournal(relative=>this.safe(relative,true));}
 private safe(relative:string,missing=false){
  if(!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))throw Error('恢复路径无效');
  const full=path.resolve(this.root,relative),rel=path.relative(this.root,full);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('恢复路径越界');
  let current=this.root;if(fs.lstatSync(current).isSymbolicLink())throw Error('恢复目录不可为链接');
  for(const part of rel.split(path.sep)){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw Error('恢复路径不可穿越链接');}catch(e:any){if(missing&&e.code==='ENOENT')continue;throw e;}}
  return full;
 }
 private bytes(file:string){try{const s=fs.lstatSync(file);if(!s.isFile()||s.size>16*1024**2)throw Error('快照类型或大小不可恢复');return fs.readFileSync(file);}catch(e:any){if(e.code==='ENOENT')return null;throw e;}}
 private scope(market:string,instrument:string){if(market!=='options'||!/^option:(cboe:[A-Z0-9.]+|deribit:(BTC|ETH))$/.test(instrument))throw Error('恢复仅支持身份明确的期权快照；其他数据不批量还原');}
 private inspect(input:Input,allowHealthy=false){
  this.scope(input.market,input.instrument);if(!backupPattern.test(input.backupId))throw Error('备份ID无效');
  const record=this.catalog.optionSnapshotRecord(input.snapshotId);if(!record||record.instrument!==input.instrument||record.market!=='options')throw Error('快照与市场身份不符');
  const relative=path.relative(this.root,path.resolve(record.path)).split(path.sep).join('/');
  if(!/^lake\/options-chain\/\d{4}\/\d{2}\/option_(?:cboe_[A-Z0-9.]+|deribit_(?:BTC|ETH))\/option_snapshot_[a-f0-9]{24}-[a-f0-9]{12}\.json$/.test(relative))throw Error('快照目录不在允许的恢复范围');
  const target=this.safe(relative,true),manifestFile=this.safe(`backups/${input.backupId}/manifest.json`),rawManifest=this.bytes(manifestFile);if(!rawManifest)throw Error('备份清单缺失');
  const manifest=JSON.parse(rawManifest.toString('utf8'));if(![1,2].includes(manifest.format)||!manifest.files||manifest.quarantinedFiles?.[relative])throw Error('备份清单无效或候选仍为损坏隔离原件');
  const expected=manifest.files[relative];if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))throw Error('备份未登记对应文件Hash');
  const candidateFile=this.safe(`backups/${input.backupId}/${relative}`),candidate=this.bytes(candidateFile);
  if(!candidate||sha(candidate)!==expected||!this.catalog.optionSnapshotMatches(input.snapshotId,candidate))throw Error('备份内容、Hash或快照身份不可核验');
  const before=this.bytes(target);if(!allowHealthy&&before&&this.catalog.optionSnapshotMatches(input.snapshotId,before))throw Error('当前文件已通过核验，不重复恢复');
  return {record,relative,target,candidate,before,candidateHash:sha(candidate),beforeHash:before?sha(before):null,manifestHash:sha(rawManifest)};
 }
 health(market:string,instrument:string){
  this.scope(market,instrument);const health=this.catalog.getOptionsSnapshotHealth({market:'options',instrument});
  let backups:string[]=[];try{const folder=this.safe('backups');backups=fs.readdirSync(folder).filter(id=>backupPattern.test(id)).sort().reverse().slice(0,90);}catch{/* No backups means no candidate, never a guessed source. */}
  const logs=this.journal.readAll(),pendingOperations=logs.operations.filter(op=>op.market===market&&op.instrument===instrument&&(!['completed','rolled-back'].includes(op.state)||op.state==='completed'&&!this.state.getAudit(op.id))).map(op=>{try{const observed=this.observe(op);return {id:op.id,snapshotId:op.snapshotId,backupId:op.backupId,state:op.state,observedState:observed.currentHash===op.candidateHash?'file-published-awaiting-confirmation':'prepared-awaiting-confirmation',actions:observed.actions,reason:'仅检查日志、文件及审计；管理员重新预览确认前不修改文件或补齐审计'};}catch{return {id:op.id,snapshotId:op.snapshotId,backupId:op.backupId,state:'review-required',observedState:'unverifiable',actions:[],reason:'文件、备份、目录或审计已变化，禁止继续；保留原始证据'};}});
  return {...health,pendingOperations,unverifiableOperations:logs.unverifiable,failures:health.failures.map(row=>({...row,candidates:backups.flatMap(backupId=>{try{const candidate=this.inspect({market,instrument,snapshotId:row.id,backupId});return [{backupId,contentHash:candidate.record.contentHash,bytes:candidate.candidate.length}];}catch{return [];}})})),reason:health.reason||'没有已登记的损坏快照；不表示来源覆盖完整'};
 }
 preview(input:Input,at=this.now()){
  if(!Number.isSafeInteger(at))throw Error('预览时间无效');const c=this.inspect(input),expiresAt=at+300000;
  const proof={...input,previewedAt:at,expiresAt,beforeHash:c.beforeHash,candidateHash:c.candidateHash,manifestHash:c.manifestHash,recordHash:sha(JSON.stringify(c.record))};
  return {...input,previewedAt:at,expiresAt,beforeHash:c.beforeHash,candidateHash:c.candidateHash,contentHash:c.record.contentHash,bytes:c.candidate.length,hash:sha(JSON.stringify(proof)),
   reason:'只预览此快照的已核验副本；确认前重新校验，保留损坏原件，不还原数据库或其他文件'};
 }
 confirm(input:Input&{hash:string;previewedAt:number}){
  this.scope(input.market,input.instrument);
  const logs=this.journal.readAll();if(logs.unverifiable)throw Error('存在不可核验操作日志，请先人工检查');
  const completed=logs.operations.find(op=>op.previewHash===input.hash&&op.previewedAt===input.previewedAt&&op.snapshotId===input.snapshotId&&op.backupId===input.backupId&&op.market===input.market&&op.instrument===input.instrument&&op.state==='completed');
  if(completed){const observed=this.observe(completed);if(observed.currentHash!==completed.candidateHash||!observed.audit)throw Error('已完成恢复的文件或审计已变化');return {...this.result(completed),idempotent:true};}
  return this.withLease(input.snapshotId,guard=>{
   const at=this.now();if(typeof input.hash!=='string'||!Number.isSafeInteger(input.previewedAt)||input.previewedAt>at||at-input.previewedAt>300000)throw Error('预览已过期，请重新预览');
   if(this.journal.readAll().operations.some(op=>op.snapshotId===input.snapshotId&&!['completed','rolled-back'].includes(op.state)))throw Error('此快照存在中断操作，请先重新预览待处理操作');
   const base={market:input.market,instrument:input.instrument,snapshotId:input.snapshotId,backupId:input.backupId},p=this.preview(base,input.previewedAt);if(p.hash!==input.hash)throw Error('文件、目录或备份已变化，请重新预览');
   const c=this.inspect(base),id=randomUUID(),evidenceId=c.before?`${id}.damaged`:null;
   fs.mkdirSync(this.safe('recovery-evidence',true),{recursive:true});if(c.before)this.journal.writeBytes(this.safe(`recovery-evidence/${evidenceId}`,true),c.before);
   let op:RecoveryOperation={schemaVersion:1,id,...base,state:'prepared',createdAt:new Date(at).toISOString(),updatedAt:new Date(at).toISOString(),previewHash:input.hash,previewedAt:input.previewedAt,beforeHash:c.beforeHash,candidateHash:c.candidateHash,manifestHash:c.manifestHash,recordHash:sha(JSON.stringify(c.record)),contentHash:p.contentHash,evidenceId};
   const temp=this.safe(`${c.relative}.${id}.tmp`,true);let published=false;
   try{
    this.journal.write(op);this.checkpoint?.('prepared',op);this.journal.writeBytes(temp,c.candidate);
    this.state.transaction(()=>{guard();fs.renameSync(temp,c.target);published=true;this.journal.syncDirectory(path.dirname(c.target));this.checkpoint?.('after-rename',op);op=this.transition(op,'file-published');this.checkpoint?.('file-published',op);this.audit(op);});
    this.checkpoint?.('audit-committed',op);guard();op=this.transition(op,'completed');this.checkpoint?.('completed',op);return this.result(op);
   }catch(error){
    try{guard();}catch{throw error;}
    if(this.state.getAudit(op.id)){try{this.transition(op,'review-required');}catch{/* Original durable journal remains for manual inspection. */}throw error;}
    try{if(published){const current=this.bytes(c.target);if(!current||sha(current)!==op.candidateHash)throw Error('恢复后文件已变化，不能回滚覆盖');this.restoreBefore(op,c.target,c.relative);}this.transition(op,'rolled-back');}catch{try{this.transition(op,'review-required');}catch{/* Preserve original journal. */}}
    throw error;
   }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  });
 }
 private withLease<T>(snapshotId:string,work:(guard:()=>void)=>T):T{const key='option-snapshot-recovery:'+snapshotId,owner=randomUUID();if(!this.state.acquireLease(key,owner,this.now(),30000))throw Error('该快照正在恢复或中断租约尚未过期，请稍后重新核验');try{return work(()=>{if(!this.state.refreshLease(key,owner,this.now(),30000))throw Error('恢复租约已被其他操作取得，停止写入');});}finally{this.state.releaseLease(key,owner);}}
 private transition(op:RecoveryOperation,state:RecoveryOperation['state'],extra:Partial<RecoveryOperation>={}){const next={...op,...extra,state,updatedAt:new Date(this.now()).toISOString()};this.journal.write(next);return next;}
 private auditDetail(op:RecoveryOperation){return JSON.stringify({snapshotId:op.snapshotId,backupId:op.backupId,beforeHash:op.beforeHash,contentHash:op.contentHash,candidateHash:op.candidateHash,evidenceId:op.evidenceId});}
 private audit(op:RecoveryOperation){const detail=this.auditDetail(op),prior=this.state.getAudit(op.id);if(prior&&(prior.action!=='option_snapshot_recovered'||prior.detail!==detail))throw Error('原审计内容冲突');this.state.appendAudit({id:op.id,action:'option_snapshot_recovered',detail});}
 private observe(op:RecoveryOperation){
  const c=this.inspect(op,true);if(c.candidateHash!==op.candidateHash||c.manifestHash!==op.manifestHash||sha(JSON.stringify(c.record))!==op.recordHash||c.record.contentHash!==op.contentHash)throw Error('备份或目录已变化');
  const currentHash=c.beforeHash;if(currentHash!==op.beforeHash&&currentHash!==op.candidateHash)throw Error('目标文件已被其他操作修改');
  const original=op.evidenceId?this.bytes(this.safe('recovery-evidence/'+op.evidenceId)):null;if((original?sha(original):null)!==op.beforeHash)throw Error('损坏原件证据不可核验');
  const audit=this.state.getAudit(op.id);if(audit&&(audit.action!=='option_snapshot_recovered'||audit.detail!==this.auditDetail(op)))throw Error('审计内容冲突');
  return {...c,currentHash,original,audit,actions:currentHash===op.candidateHash?['finalize','rollback']:['rollback']};
 }
 private restoreBefore(op:RecoveryOperation,target:string,relative:string){if(op.beforeHash===null){if(fs.existsSync(target))fs.unlinkSync(target);this.journal.syncDirectory(path.dirname(target));return;}
  const original=this.bytes(this.safe('recovery-evidence/'+op.evidenceId));if(!original||sha(original)!==op.beforeHash)throw Error('原件证据不可核验');const temp=this.safe(relative+'.'+randomUUID()+'.tmp',true);try{this.journal.writeBytes(temp,original);fs.renameSync(temp,target);this.journal.syncDirectory(path.dirname(target));}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 }
 private result(op:RecoveryOperation){return {operationId:op.id,state:op.state,restored:op.state==='completed',snapshotId:op.snapshotId,instrument:op.instrument,evidenceId:op.evidenceId,contentHash:op.contentHash,reason:op.state==='completed'?'单文件恢复及审计成功；文件及日志已核验，损坏原件保留':'操作已回滚；原件保留，不修改其他历史'};}
 previewOperation(input:OperationInput,at=this.now()){
  this.scope(input.market,input.instrument);if(!['finalize','rollback'].includes(input.action)||!Number.isSafeInteger(at))throw Error('操作或时间无效');
  const op=this.journal.read(input.operationId);if(op.market!==input.market||op.instrument!==input.instrument||op.state==='rolled-back'||op.state==='completed'&&this.state.getAudit(op.id))throw Error('操作身份或状态已变化');
  const observed=this.observe(op);if(!observed.actions.includes(input.action))throw Error('当前文件状态不支持此操作');
  const proof={...input,previewedAt:at,expiresAt:at+300000,journalHash:sha(JSON.stringify(op)),targetHash:observed.currentHash,manifestHash:observed.manifestHash,recordHash:sha(JSON.stringify(observed.record)),auditHash:observed.audit?sha(JSON.stringify(observed.audit)):null};
  return {...input,previewedAt:at,expiresAt:at+300000,hash:sha(JSON.stringify(proof)),observedState:observed.currentHash===op.candidateHash?'file-published':'prepared',reason:input.action==='finalize'?'确认后补齐同一操作审计并结束日志，不重新写入快照':'确认后恢复保留的原始状态并记录回滚；不修改其他历史'};
 }
 confirmOperation(input:OperationInput&{hash:string;previewedAt:number}){
  this.scope(input.market,input.instrument);const op=this.journal.read(input.operationId);if(op.market!==input.market||op.instrument!==input.instrument)throw Error('操作身份不匹配');
  if(op.state==='rolled-back'||op.state==='completed'&&this.state.getAudit(op.id)){const observed=this.observe(op),expected=input.action==='finalize'?op.candidateHash:op.beforeHash;if(op.resolutionHash!==input.hash||op.resolutionAction!==input.action||observed.currentHash!==expected)throw Error('操作已完成或内容已变化');return {...this.result(op),idempotent:true};}
  return this.withLease(op.snapshotId,guard=>{const at=this.now();if(!Number.isSafeInteger(input.previewedAt)||input.previewedAt>at||at-input.previewedAt>300000)throw Error('预览已过期');const preview=this.previewOperation({market:input.market,instrument:input.instrument,operationId:input.operationId,action:input.action},input.previewedAt);if(preview.hash!==input.hash)throw Error('操作文件、目录或审计已变化，请重新预览');const latest=this.journal.read(op.id),observed=this.observe(latest);
   this.state.transaction(()=>{guard();if(input.action==='finalize')this.audit(latest);else{if(observed.currentHash!==latest.beforeHash)this.restoreBefore(latest,observed.target,observed.relative);this.state.appendAudit({id:latest.id+'-rollback',action:'option_snapshot_recovery_rolled_back',detail:this.auditDetail(latest)});}});
   guard();const result=this.transition(latest,input.action==='finalize'?'completed':'rolled-back',{resolutionHash:input.hash,resolutionAction:input.action});return this.result(result);
  });
 }
}
