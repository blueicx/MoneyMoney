const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('disk budget preserves reserve, rejects unknown/invalid capacity and includes expected staging bytes',()=>{
 const {evaluateStorageCapacity}=require('../src/storage/capacity-budget');
 assert.equal(evaluateStorageCapacity({freeBytes:2e9,totalBytes:10e9,expectedBytes:1e8,reserveBytes:5e8}).state,'ok');
 assert.equal(evaluateStorageCapacity({freeBytes:6e8,totalBytes:10e9,expectedBytes:2e8,reserveBytes:5e8}).state,'blocked');
 assert.equal(evaluateStorageCapacity({freeBytes:8e8,totalBytes:10e9,expectedBytes:0,reserveBytes:5e8}).state,'warning');
 for(const freeBytes of [null,NaN,-1,11e9])assert.equal(evaluateStorageCapacity({freeBytes,totalBytes:10e9}).state,'unknown');
 assert.equal(evaluateStorageCapacity({freeBytes:2e9,totalBytes:10e9,expectedBytes:NaN}).state,'unknown');
});
test('all three lake publishers enforce filesystem capacity before writing staged files',()=>{
 const fs=require('node:fs'),source=fs.readFileSync('src/storage/data-lake.ts','utf8');
 assert.ok(source.includes('assertStorageCapacity(this.lakeRoot'),'lake write paths must check actual filesystem, not only catalog quota');
 assert.ok((source.match(/assertStorageCapacity\(this\.lakeRoot/g)||[]).length>=3);
 assert.ok(source.includes('filesystem:inspectStorageCapacity(this.lakeRoot)'));
});
test('first bars partition on a full disk creates neither staged files nor published catalog rows',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DataLakeCatalog}=require('../src/storage/data-lake');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-disk-budget-')),lake=new DataLakeCatalog({lakeRoot:path.join(dir,'lake'),databasePath:path.join(dir,'state.sqlite')}),original=fs.statfsSync;
 try{
  fs.statfsSync=()=>({bavail:1,blocks:10000,bsize:4096});
  await assert.rejects(lake.stageBars({market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',source:'fixture',publishedAt:'2026-10-01T00:00:00Z',rows:[{timestamp:'2026-09-30T00:00:00Z',open:10,high:11,low:9,close:10,volume:1}]}),/安全预留/);
  assert.equal(lake.listPartitions().length,0);assert.deepEqual(fs.readdirSync(path.join(dir,'lake','.staging')),[]);
 }finally{fs.statfsSync=original;lake.close();}
});
