const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');

const source=fs.readFileSync('src/web/public/professional-research.js','utf8');

function mount(instrument='stock:us:AAPL'){
  const dom=new JSDOM(
    '<div id="market-workspace-shell" data-market-scope="stocks" data-workspace="fundamentals" data-instrument="'+instrument+'">'+
      '<section data-workspace-id="fundamentals"><div class="collapse-body"></div></section>'+
    '</div>',
    {url:'https://test.invalid/',runScripts:'outside-only',pretendToBeVisual:true},
  );
  dom.window.mm_isLoggedIn=true;
  dom.window.mm_isGuest=false;
  dom.window.eval(source);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom;
}

test('filing context changes abort the old request and keep its late response out of the new panel',async()=>{
  const dom=mount('stock:us:AAPL'),w=dom.window;
  let finish,requestSignal;
  w.fetch=async(_url,options)=>{
    requestSignal=options.signal;
    return new Promise(resolve=>{finish=resolve;});
  };
  try{
    const oldPanel=w.document.getElementById('financial-text-research'),pending=oldPanel.querySelector('[data-filing-list]').onclick();
    const shell=w.document.getElementById('market-workspace-shell');
    shell.dataset.instrument='stock:us:MU';
    w.dispatchEvent(new w.Event('mm-workspace-context'));
    const newPanel=w.document.getElementById('financial-text-research');
    assert.equal(newPanel,oldPanel);
    assert.match(newPanel.textContent,/stock:us:MU/);
    assert.equal(requestSignal.aborted,true);
    finish({ok:true,json:async()=>({success:true,data:[{id:'stale',form:'10-K',accession:'STALE',publishedAt:'2025-01-01T00:00:00Z',retrievedAt:'2025-01-02T00:00:00Z',contentHash:'a'.repeat(64),sourceUrl:'https://www.sec.gov/stale.htm'}]})});
    await pending;
    await new Promise(resolve=>setImmediate(resolve));
    assert.doesNotMatch(newPanel.textContent,/STALE/);
    assert.doesNotMatch(newPanel.querySelector('[data-filing-results]').textContent,/stale/);
  }finally{dom.window.close();}
});

test('incomparable filing versions and hostile text are rendered as escaped, non-executable content',async()=>{
  const dom=mount(),w=dom.window;
  w.fetch=async url=>{
    if(String(url).endsWith('/sections'))return {ok:true,json:async()=>({success:true,data:[{sectionKey:'item-1a-risk-factors',heading:'Risk Factors',startParagraph:4,endParagraph:6}]})};
    if(String(url).includes('/compare?'))return {ok:true,json:async()=>({
      success:true,
      data:{
        status:'incomparable',
        baseDocument:{form:'10-K',publishedAt:'2024-01-01T00:00:00Z'},
        currentDocument:{form:'10-Q<img src=x onerror=alert(1)>',publishedAt:'2025-01-01T00:00:00Z'},
        reasons:['表单口径不同 <script>alert(1)</script>'],
        summary:{alignedSections:0,unchangedSections:0,baseOnlySections:0,currentOnlySections:0},
        contentHash:'b'.repeat(64),
        sections:[{heading:'<img src=x onerror=alert(2)>',status:'incomparable',changedParagraphs:1,reason:'<b>not comparable</b>',alignmentEvidence:[],changes:[{kind:'changed',baseParagraph:1,currentParagraph:1,baseText:'<svg onload=alert(3)>base',currentText:'current',baseCitation:'base',currentCitation:'current'}],truncated:false}],
      },
    })};
    return {ok:true,json:async()=>({success:true,data:[
      {id:'base',form:'10-K',accession:'BASE',publishedAt:'2024-01-01T00:00:00Z',retrievedAt:'2024-01-02T00:00:00Z',contentHash:'a'.repeat(64),sourceUrl:'https://www.sec.gov/base.htm'},
      {id:'current',form:'10-Q',accession:'CURRENT',publishedAt:'2025-01-01T00:00:00Z',retrievedAt:'2025-01-02T00:00:00Z',contentHash:'b'.repeat(64),sourceUrl:'https://www.sec.gov/current.htm'},
    ]})};
  };
  try{
    const panel=w.document.getElementById('financial-text-research');
    await panel.querySelector('[data-filing-list]').onclick();
    await panel.querySelector('[data-filing-compare]').onclick({target:panel.querySelector('[data-filing-compare]')});
    const output=panel.querySelector('[data-filing-compare-results]');
    assert.match(output.textContent,/不可比较/);
    assert.match(output.textContent,/表单口径不同 <script>alert\(1\)<\/script>/);
    assert.match(output.textContent,/<img src=x onerror=alert\(2\)>/);
    assert.equal(output.querySelector('img,script,svg,b'),null);
    assert.equal(w.document.querySelector('img,script,svg'),null);
  }finally{dom.window.close();}
});

test('annotation confirmation sends If-Match, a one-time write key and the confirmed revision',async()=>{
  const dom=mount(),w=dom.window,calls=[];
  w.fetch=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url).endsWith('/sections'))return {ok:true,json:async()=>({success:true,data:[{sectionKey:'item-1a-risk-factors',heading:'Risk Factors',startParagraph:4,endParagraph:6}]})};
    if(String(url).endsWith('/annotations')&&!options.method)return {ok:true,json:async()=>({success:true,instrument:'stock:us:AAPL',data:[{revision:2,citation:'prior'}]})};
    if(!options.method)return {ok:true,json:async()=>({success:true,data:[
      {id:'base',form:'10-K',accession:'BASE',publishedAt:'2024-01-01T00:00:00Z',retrievedAt:'2024-01-02T00:00:00Z',contentHash:'a'.repeat(64),sourceUrl:'https://www.sec.gov/base.htm'},
      {id:'current',form:'10-K',accession:'CURRENT',publishedAt:'2025-01-01T00:00:00Z',retrievedAt:'2025-01-02T00:00:00Z',contentHash:'b'.repeat(64),sourceUrl:'https://www.sec.gov/current.htm'},
    ]})};
    return {ok:true,json:async()=>({success:true,data:{revision:3,citation:'record:item-1a-risk-factors:p4-p4',citationHash:'c'.repeat(64)}})};
  };
  try{
    const panel=w.document.getElementById('financial-text-research');
    await panel.querySelector('[data-filing-list]').onclick();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual([...panel.querySelector('[data-filing-annotation-doc]').options].map(option=>option.value),['base','current']);
    panel.querySelector('[data-filing-annotation-doc]').value='current';
    await panel.querySelector('[data-filing-annotation-doc]').onchange();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(panel.querySelector('[data-filing-annotation-doc]').value,'current');
    assert.ok(panel.querySelector('[data-filing-annotation-section]').selectedOptions[0]);
    panel.querySelector('[data-filing-annotation-body]').value='Check <supplier> evidence';
    await panel.querySelector('[data-filing-annotation-save]').onclick({target:panel.querySelector('[data-filing-annotation-save]')});
    const write=calls.find(call=>call.options.method==='POST');
    assert.ok(write);
    assert.equal(write.options.headers['If-Match'],'"2"');
    assert.match(write.options.headers['Idempotency-Key'],/^filing-annotation:/);
    const body=JSON.parse(write.options.body);
    assert.equal(body.expectedVersion,2);
    assert.equal(body.sectionKey,'item-1a-risk-factors');
    assert.match(panel.querySelector('[data-filing-annotations]').textContent,/批注版本 3/);
  }finally{dom.window.close();}
});
