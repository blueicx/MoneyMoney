// Explicitly loaded only by the isolated forward browser harness, never by application startup.
const fs=require('node:fs'),path=require('node:path');const file=process.env.MONEYMONEY_TEST_CLOCK_FILE;
if(!file||path.basename(file)!=='clock.json'||!/^mm-restricted-forward-browser-[A-Za-z0-9]+$/.test(path.basename(path.dirname(file))))throw Error('Isolated forward clock requires its exact fresh harness directory');
Date.now=()=>{const value=Number(fs.readFileSync(file,'utf8'));if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid isolated forward clock');return value;};
