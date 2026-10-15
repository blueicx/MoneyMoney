const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('backup refuses a full disk before creating any snapshot and preserves live database',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-backup-full-')),Database=require('better-sqlite3'),file=path.join(dir,'moneymoney.sqlite'),db=new Database(file);db.exec('CREATE TABLE sample(id INTEGER PRIMARY KEY)');db.close();
 const result=spawnSync(process.execPath,['-e',"require('node:fs').statfsSync=()=>({bavail:1,blocks:100000,bsize:4096});require('./scripts/state-backup.cjs')"],{cwd:process.cwd(),env:{...process.env,MONEYMONEY_DATA_DIR:dir},encoding:'utf8'});
 assert.notEqual(result.status,0);assert.match(result.stderr,/磁盘空间/);assert.ok(fs.existsSync(file));assert.ok(!fs.existsSync(path.join(dir,'backups'))||!fs.readdirSync(path.join(dir,'backups')).length);
});
