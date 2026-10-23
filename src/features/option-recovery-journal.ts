import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export interface RecoveryOperation {
 schemaVersion:1;id:string;market:string;instrument:string;snapshotId:string;backupId:string;
 state:'prepared'|'file-published'|'completed'|'rolled-back'|'review-required';
 createdAt:string;updatedAt:string;previewHash:string;previewedAt:number;beforeHash:string|null;candidateHash:string;manifestHash:string;recordHash:string;contentHash:string;evidenceId:string|null;
 resolutionHash?:string;resolutionAction?:'finalize'|'rollback';
}
export class OptionRecoveryJournal {
 constructor(private safe:(relative:string)=>string){}
 private folder(){return this.safe('recovery-operations');}
 syncDirectory(folder:string){let fd:number|undefined;try{fd=fs.openSync(folder,'r');fs.fsyncSync(fd);}catch(error:any){if(process.platform!=='win32'||!['EPERM','EISDIR','EINVAL','EACCES','ENOTSUP'].includes(error.code))throw error;}finally{if(fd!==undefined)fs.closeSync(fd);}}
 writeBytes(file:string,bytes:Buffer){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}this.syncDirectory(path.dirname(file));}
 readAll(){let files:string[];try{files=fs.readdirSync(this.folder()).filter(name=>name.endsWith('.json'));}catch(e:any){if(e.code==='ENOENT')return {operations:[] as RecoveryOperation[],unverifiable:0};throw e;}if(files.length>2000)throw Error('恢复操作日志超过核验上限');const operations:RecoveryOperation[]=[];let unverifiable=0;
  for(const file of files){try{if(!/^[a-f0-9-]{36}\.json$/.test(file))throw Error('invalid');const raw=fs.readFileSync(this.safe('recovery-operations/'+file),'utf8');if(raw.length>20000)throw Error('invalid');const row=JSON.parse(raw) as RecoveryOperation;
   if(row.schemaVersion!==1||file!==row.id+'.json'||!['prepared','file-published','completed','rolled-back','review-required'].includes(row.state)||row.market!=='options'||typeof row.instrument!=='string'||typeof row.snapshotId!=='string'||typeof row.backupId!=='string'||!Number.isSafeInteger(row.previewedAt)||!['previewHash','candidateHash','manifestHash','recordHash','contentHash'].every(key=>/^[a-f0-9]{64}$/.test(String((row as any)[key])))||row.beforeHash!==null&&!/^[a-f0-9]{64}$/.test(row.beforeHash)||row.evidenceId!==(row.beforeHash===null?null:row.id+'.damaged'))throw Error('invalid');
   operations.push(row);
  }catch{unverifiable++;}}
  return {operations,unverifiable};
 }
 read(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('操作ID无效');const op=this.readAll().operations.find(row=>row.id===id);if(!op)throw Error('操作日志不可核验');return op;}
 write(op:RecoveryOperation){const folder=this.folder();fs.mkdirSync(folder,{recursive:true});const target=this.safe('recovery-operations/'+op.id+'.json'),temp=this.safe('recovery-operations/'+op.id+'.'+randomUUID()+'.tmp');try{this.writeBytes(temp,Buffer.from(JSON.stringify(op)));fs.renameSync(temp,target);this.syncDirectory(folder);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
}
