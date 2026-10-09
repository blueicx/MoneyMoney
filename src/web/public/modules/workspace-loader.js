(function () {
  'use strict';
  const manifest = __WORKSPACE_MANIFEST__;
  const modules = manifest.modules || manifest;
  const styles = manifest.styles || {};
  const pending = new Map();
  const pendingStyles = new Map();

  function ensureStyle(group) {
    const href = styles[group];
    if (!href) return Promise.resolve();
    if (pendingStyles.has(group)) return pendingStyles.get(group);
    const promise = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.workspaceStyle = group;
      link.onload = resolve;
      link.onerror = () => {
        link.remove();
        pendingStyles.delete(group);
        reject(new Error('工作区样式加载失败，请重试'));
      };
      document.head.append(link);
    });
    pendingStyles.set(group, promise);
    return promise;
  }

  function loadScript(group) {
    const src = modules[group];
    if (!src) return Promise.reject(new Error('没有配置此工作区资源'));
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.workspaceGroup = group;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(new Error('工作区加载失败，请重试'));
      };
      document.head.append(script);
    });
  }

  function ensure(group) {
    if (pending.has(group)) return pending.get(group);
    const promise = (async () => {
      if (group === 'contracts') await ensure('charts');
      await ensureStyle(group);
      await loadScript(group);
      window.dispatchEvent(new CustomEvent('mm-workspace-modules-ready', { detail: { group } }));
    })();
    pending.set(group, promise);
    promise.catch(() => { if (pending.get(group) === promise) pending.delete(group); });
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
    const market = event.detail?.market || '';
    const group = id === 'guru-holdings' ? 'guru' : id === 'contracts' ? 'contracts'
      : id === 'events' ? 'events'
      : (id === 'stock-quotes' && market === 'stocks') || (id === 'crypto-quotes' && market === 'crypto') ? 'charts'
        : ['research-lab', 'action-center', 'decision-intelligence', 'screener', 'backtest', 'risk'].includes(id) ? 'research' : null;
    if (group) ensure(group).catch(error => window.showToast?.(error.message, 'error'));
  });
})();
