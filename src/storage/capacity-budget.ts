import fs from 'node:fs';

interface CapacityInput {freeBytes:number|null;totalBytes:number|null;expectedBytes?:number;reserveBytes?:number}
export function evaluateStorageCapacity(input:CapacityInput) {
  const {freeBytes,totalBytes}=input,expectedBytes=input.expectedBytes??0,reserveBytes=input.reserveBytes??512*1024**2;
  const valid=[freeBytes,totalBytes,expectedBytes,reserveBytes].every(value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)
    && totalBytes!>0 && freeBytes!<=totalBytes!;
  const remaining=valid?freeBytes!-expectedBytes:null;
  const state: 'unknown'|'blocked'|'warning'|'ok'=!valid?'unknown':remaining!<reserveBytes?'blocked':remaining!<reserveBytes*2?'warning':'ok';
  return {state,freeBytes:valid?freeBytes:null,totalBytes:valid?totalBytes:null,expectedBytes:valid?expectedBytes:null,reserveBytes,
    reason:state==='unknown'?'无法核验磁盘余量，暂停非必要归档':state==='blocked'?'写入后将低于磁盘安全预留，暂停非必要归档':state==='warning'?'磁盘接近安全预留，请检查容量；不自动删除业务数据':'磁盘预检通过；不保证其他进程不会同时占用空间'};
}
export function inspectStorageCapacity(directory:string,expectedBytes=0) {
  try {const value=fs.statfsSync(directory);return evaluateStorageCapacity({freeBytes:value.bavail*value.bsize,totalBytes:value.blocks*value.bsize,expectedBytes});}
  catch {return evaluateStorageCapacity({freeBytes:null,totalBytes:null,expectedBytes});}
}
export function assertStorageCapacity(directory:string,expectedBytes=0) {
  const budget=inspectStorageCapacity(directory,expectedBytes);
  if(['unknown','blocked'].includes(budget.state))throw Error(budget.reason);
  return budget;
}
