import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {DataLakeCatalog} from '../storage/data-lake';
import type {SQLiteStateStore} from '../storage/sqlite-state';

const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const backupPattern=/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
type Input={market:string;instrument:string;snapshotId:string;backupId:string};
/** Exact single-file recovery. Does not restore databases, rewrite catalog identities, or use upstream requests. */
export class OptionSnapshotRecovery {
 constructor(private root:string,private catalog:DataLakeCatalog,private state:Pick<SQLiteStateStore,'transaction'|'appendAudit'>,private now=Date.now){this.root=path.resolve(root);}
 private safe(relative:string,missing=false){
  if(!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))throw Error('恢复路径无效');
  const full=path.resolve(this.root,relative),rel=path.relative(this.root,full);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('恢复路径越界');
  let current=this.root;if(fs.lstatSync(current).isSymbolicLink())throw Error('恢复目录不可为链接');
  for(const part of rel.split(path.sep)){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw Error('恢复路径不可穿越链接');}catch(e:any){if(missing&&e.code==='ENOENT')continue;throw e;}}
  return full;
 }
 private bytes(file:string){try{const s=fs.lstatSync(file);if(!s.isFile()||s.size>16*1024**2)throw Error('快照类型或大小不可恢复');return fs.readFileSync(file);}catch(e:any){if(e.code==='ENOENT')return null;throw e;}}
 private scope(market:string,instrument:string){if(market!=='options'||!/^option:(cboe:[A-Z0-9.]+|deribit:(BTC|ETH))$/.test(instrument))throw Error('恢复仅支持身份明确的期权快照；其他数据不批量还原');}
 private inspect(input:Input){
  this.scope(input.market,input.instrument);if(!backupPattern.test(input.backupId))throw Error('备份ID无效');
  const record=this.catalog.optionSnapshotRecord(input.snapshotId);if(!record||record.instrument!==input.instrument||record.market!=='options')throw Error('快照与市场身份不符');
  const relative=path.relative(this.root,path.resolve(record.path)).split(path.sep).join('/');
  if(!/^lake\/options-chain\/\d{4}\/\d{2}\/option_(?:cboe_[A-Z0-9.]+|deribit_(?:BTC|ETH))\/option_snapshot_[a-f0-9]{24}-[a-f0-9]{12}\.json$/.test(relative))throw Error('快照目录不在允许的恢复范围');
  const target=this.safe(relative,true),manifestFile=this.safe(`backups/${input.backupId}/manifest.json`),rawManifest=this.bytes(manifestFile);if(!rawManifest)throw Error('备份清单缺失');
  const manifest=JSON.parse(rawManifest.toString('utf8'));if(![1,2].includes(manifest.format)||!manifest.files||manifest.quarantinedFiles?.[relative])throw Error('备份清单无效或候选仍为损坏隔离原件');
  const expected=manifest.files[relative];if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))throw Error('备份未登记对应文件Hash');
  const candidateFile=this.safe(`backups/${input.backupId}/${relative}`),candidate=this.bytes(candidateFile);
  if(!candidate||sha(candidate)!==expected||!this.catalog.optionSnapshotMatches(input.snapshotId,candidate))throw Error('备份内容、Hash或快照身份不可核验');
  const before=this.bytes(target);if(before&&this.catalog.optionSnapshotMatches(input.snapshotId,before))throw Error('当前文件已通过核验，不重复恢复');
  return {record,relative,target,candidate,before,candidateHash:sha(candidate),beforeHash:before?sha(before):null,manifestHash:sha(rawManifest)};
 }
 health(market:string,instrument:string){
  this.scope(market,instrument);const health=this.catalog.getOptionsSnapshotHealth({market:'options',instrument});
  let backups:string[]=[];try{const folder=this.safe('backups');backups=fs.readdirSync(folder).filter(id=>backupPattern.test(id)).sort().reverse().slice(0,90);}catch{/* No backups means no candidate, never a guessed source. */}
  return {...health,failures:health.failures.map(row=>({...row,candidates:backups.flatMap(backupId=>{try{const candidate=this.inspect({market,instrument,snapshotId:row.id,backupId});return [{backupId,contentHash:candidate.record.contentHash,bytes:candidate.candidate.length}];}catch{return [];}})})),reason:health.reason||'没有已登记的损坏快照；不表示来源覆盖完整'};
 }
 preview(input:Input,at=this.now()){
  if(!Number.isSafeInteger(at))throw Error('预览时间无效');const c=this.inspect(input),expiresAt=at+300000;
  const proof={...input,previewedAt:at,expiresAt,beforeHash:c.beforeHash,candidateHash:c.candidateHash,manifestHash:c.manifestHash,recordHash:sha(JSON.stringify(c.record))};
  return {...input,previewedAt:at,expiresAt,beforeHash:c.beforeHash,candidateHash:c.candidateHash,contentHash:c.record.contentHash,bytes:c.candidate.length,hash:sha(JSON.stringify(proof)),
   reason:'只预览此快照的已核验副本；确认前重新校验，保留损坏原件，不还原数据库或其他文件'};
 }
 confirm(input:Input&{hash:string;previewedAt:number}){
  const at=this.now();if(typeof input.hash!=='string'||!Number.isSafeInteger(input.previewedAt)||input.previewedAt>at||at-input.previewedAt>300000)throw Error('预览已过期，请重新预览');
  const base={market:input.market,instrument:input.instrument,snapshotId:input.snapshotId,backupId:input.backupId};
  const p=this.preview(base,input.previewedAt);if(p.hash!==input.hash)throw Error('文件、目录或备份已变化，请重新预览');
  const c=this.inspect(base),id=randomUUID(),evidenceId=c.before?`${id}.damaged` :null;
  const evidenceDir=this.safe('recovery-evidence',true);fs.mkdirSync(evidenceDir,{recursive:true});if(c.before)fs.writeFileSync(this.safe(`recovery-evidence/${evidenceId}`,true),c.before,{flag:'wx',mode:0o600});
  const temp=this.safe(`${c.relative}.${id}.tmp`,true);let published=false;
  try{fs.writeFileSync(temp,c.candidate,{flag:'wx',mode:0o600});this.state.transaction(()=>{
    fs.renameSync(temp,c.target);published=true;
    this.state.appendAudit({id,action:'option_snapshot_recovered',detail:JSON.stringify({snapshotId:input.snapshotId,backupId:input.backupId,beforeHash:c.beforeHash,contentHash:p.contentHash,candidateHash:c.candidateHash,evidenceId})});
   });
  }catch(error){if(published){if(c.before){fs.writeFileSync(temp,c.before,{flag:'wx',mode:0o600});fs.renameSync(temp,c.target);}else fs.unlinkSync(c.target);}throw error;}
  finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  return {restored:true,snapshotId:input.snapshotId,instrument:input.instrument,evidenceId,contentHash:p.contentHash,reason:'单文件恢复及审计成功；原损坏字节保留，未还原数据库、改写目录身份或其他历史'};
 }
}
