(function () {
  'use strict';
  const manifest = __WORKSPACE_MANIFEST__;
  const pending = new Map();
  function ensure(group) {
    if (pending.has(group)) return pending.get(group);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = manifest[group];
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { script.remove(); pending.delete(group); reject(new Error('工作区加载失败，请重试')); };
      document.head.append(script);
    });
    pending.set(group, promise);
    return promise;
  }
  window.MoneyWorkspaceModules = {
    ensure,
    async invoke(group, name, args) {
      try { await ensure(group); return window[name](...args); }
      catch (error) { window.showToast?.(error.message || '工作区加载失败，请重试', 'error'); throw error; }
    },
  };
  window.addEventListener('mm-workspace-context', event => {
    const id = event.detail?.workspace || '';
    const group = id === 'guru-holdings' ? 'guru' : id === 'contracts' ? 'contracts'
      : ['research-lab', 'action-center', 'decision-intelligence'].includes(id) ? 'research' : null;
    if (group) ensure(group).catch(error => window.showToast?.(error.message, 'error'));
  });
})();
