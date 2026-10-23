const {open}=require('./option-recovery-operation-fixture.cjs');
const data=process.argv[2],stage=process.argv[3],f=open(data,Date.now,value=>{if(value===stage)process.kill(process.pid,'SIGKILL');});
try{const preview=f.service.preview(f.input);f.service.confirm({...f.input,hash:preview.hash,previewedAt:preview.previewedAt});}finally{f.close();}
