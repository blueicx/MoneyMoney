(function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function mount(host) {
    if (!host || window.mm_isGuest) return;
    if(host.dataset.metaMounted){host.refreshWatchMetadata?.();return;}
    host.dataset.metaMounted = 'true';
    host.innerHTML = '<details class="watch-meta"><summary>分组与研究标签 · 批量管理</summary><div data-meta-body></div></details>';
    const details=host.querySelector('details'),body=host.querySelector('[data-meta-body]');
    let state=null,controller=null,busy=false,generation=0;
    const status = message => {const node=body.querySelector('[role=status]');if(node)node.textContent=message;};
    async function request(path='',payload) {
      const signal=controller?.signal;
      const response=await fetch('/api/watchlist/metadata'+path,{credentials:'include',cache:'no-store',signal,
        ...(payload?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}:{})});
      const result=await response.json();if(signal?.aborted)throw new DOMException('上下文已切换','AbortError');if(!response.ok||!result.success)throw Error(result.reason||'保存失败');return result.data;
    }
    function render() {
      const groups=state.groups||[],items=Object.entries(state.items||{}).sort((a,b)=>Number(b[1].pinned)-Number(a[1].pinned)||a[1].order-b[1].order||a[0].localeCompare(b[0]));
      body.innerHTML=`<p class="watch-meta-note">网页与 Telegram 共用；批量修改仅影响自选元数据，不改变运行中实验的冻结范围。</p>
        <div class="watch-meta-controls"><label>筛选分组<select name="filter"><option value="*">全部</option><option value="">未分组</option>${groups.map(g=>`<option value="${escape(g.id)}">${escape(g.name)}</option>`).join('')}</select></label><button type="button" class="tab" data-meta-refresh>刷新</button></div>
        <div class="watch-meta-scroll"><table class="workspace-watchlist-table"><thead><tr><th><input type="checkbox" data-meta-all aria-label="选择当前列表全部标的"></th><th>标的 / 分组</th><th>标签与理由</th><th>观察日期 / 排序</th></tr></thead><tbody>${items.map(([id,m])=>`<tr data-meta-row data-group="${escape(m.groupId||'')}"><td><input type="checkbox" data-meta-id="${escape(id)}" aria-label="选择 ${escape(id)}"></td><td>${m.pinned?'★ ':''}${escape(id)}<small>${escape(groups.find(g=>g.id===m.groupId)?.name||'未分组')}</small></td><td>${escape((m.tags||[]).join(' · '))}<small>${escape(m.reason||'未填写关注理由')}</small></td><td>${escape(m.observeOn||'未设置')}<small>顺序 ${m.order}</small></td></tr>`).join('')||'<tr><td colspan="4">暂无自选，请先加入标的。</td></tr>'}</tbody></table></div>
        <fieldset><legend>对选中标的应用（仅勾选字段会替换，留空会清除）</legend><div class="watch-meta-controls">
        <label>移入分组<select name="groupId"><option value="__unchanged">不修改</option><option value="">未分组</option>${groups.map(g=>`<option data-meta-group="${escape(g.id)}" value="${escape(g.id)}">${escape(g.name)}</option>`).join('')}</select></label>
        <label>置顶<select name="pinned"><option value="__unchanged">不修改</option><option value="true">置顶</option><option value="false">取消置顶</option></select></label>
        <label><span><input type="checkbox" data-meta-enable="tags">替换标签</span><input name="tags" maxlength="400" placeholder="以逗号分隔，最多12个"></label>
        <label><span><input type="checkbox" data-meta-enable="reason">替换关注理由</span><input name="reason" maxlength="1000" placeholder="关注理由"></label>
        <label><span><input type="checkbox" data-meta-enable="observeOn">替换观察日期</span><input name="observeOn" type="date"></label>
        <label><span><input type="checkbox" data-meta-enable="order">替换排序</span><input name="order" type="number" min="0" max="10000" value="0"></label>
        <button type="button" class="tab" data-meta-save>保存选中项</button></div></fieldset>
        <div class="watch-meta-controls"><input name="groupName" maxlength="40" placeholder="新分组名称" aria-label="新分组名称"><button type="button" class="tab" data-meta-create>创建分组</button><button type="button" class="tab" data-meta-remove>删除筛选的分组</button><button type="button" class="tab" data-meta-undo ${state.history?.length?'':'disabled'}>撤销最近变更</button></div>
        <p role="status" aria-live="polite">版本 ${state.revision} · ${items.length} 个自选</p>`;
      body.querySelector('[name=filter]').addEventListener('change',event=>{
        for(const row of body.querySelectorAll('[data-meta-row]')){row.hidden=event.target.value!=='*'&&row.dataset.group!==event.target.value;if(row.hidden)row.querySelector('input').checked=false;}
      });
      body.querySelector('[data-meta-all]').addEventListener('change',event=>{for(const row of body.querySelectorAll('[data-meta-row]'))if(!row.hidden)row.querySelector('input').checked=event.target.checked;});
      body.querySelector('[data-meta-refresh]').onclick=load;
      body.querySelector('[data-meta-save]').onclick=()=>mutate(()=>{
        const changes=[...body.querySelectorAll('[data-meta-id]:checked')].map(input=>{
          const change={instrument:input.dataset.metaId};const value=name=>body.querySelector(`[name=${name}]`).value;
          if(value('groupId')!=='__unchanged')change.groupId=value('groupId')||null;
          if(value('pinned')!=='__unchanged')change.pinned=value('pinned')==='true';
          for(const name of ['tags','reason','observeOn','order'])if(body.querySelector(`[data-meta-enable=${name}]`).checked)change[name]=name==='tags'?value(name).split(/[,，]/).map(x=>x.trim()).filter(Boolean):name==='order'?Number(value(name)):name==='observeOn'?value(name)||null:value(name);
          if(Object.keys(change).length===1)throw Error('请选择要修改的字段');return change;
        });
        if(!changes.length)throw Error('请先选择标的');return {revision:state.revision,changes};
      });
      body.querySelector('[data-meta-create]').onclick=()=>mutate(()=>{const name=body.querySelector('[name=groupName]').value.trim();if(!name)throw Error('请输入分组名称');return {revision:state.revision,groups:[...groups,{id:'group-'+crypto.randomUUID().replace(/-/g,''),name}],changes:[]};});
      body.querySelector('[data-meta-remove]').onclick=()=>mutate(()=>{const id=body.querySelector('[name=filter]').value;if(!id||id==='*')throw Error('请先筛选要删除的分组');return {revision:state.revision,groups:groups.filter(g=>g.id!==id),changes:[]};});
      body.querySelector('[data-meta-undo]').onclick=()=>mutate(()=>({revision:state.revision,operationId:state.history.at(-1)?.id}),'/undo');
    }
    async function mutate(make,path='') {
      if(busy)return;busy=true;const token=generation;
      try {const payload=make();status('正在保存…');state=await request(path,payload);render();status('已保存，Telegram 使用相同状态');window.dispatchEvent(new Event('mm-watchlist-metadata-changed'));}
      catch(error){if(error.name!=='AbortError')status(error.message+'；可刷新后重试。');}
      finally{if(token===generation)busy=false;}
    }
    async function load() {
      if(busy)return;controller?.abort();controller=new AbortController();busy=true;const token=generation;body.innerHTML='<p role="status">正在读取分组与标签…</p>';
      try{state=await request();render();}catch(error){if(error.name!=='AbortError'){body.innerHTML='<p role="status"></p><button type="button" class="tab">重试</button>';status(error.message);body.querySelector('button').onclick=load;}}
      finally{if(token===generation)busy=false;}
    }
    details.addEventListener('toggle',()=>{if(details.open&&!state&&!busy)void load();});
    host.refreshWatchMetadata=()=>{if(details.open&&!state&&!busy)void load();};
    window.addEventListener('mm-workspace-context',()=>{generation++;controller?.abort();state=null;busy=false;body.innerHTML='<p role="status">工作区已切换，返回后重新读取。</p>';});
  }
  window.MoneyWatchMetadata={mount};
})();
