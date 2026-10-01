(() => {
  'use strict';

  const MARKETS = ['stocks', 'options', 'crypto', 'prediction'];
  const MARKET_LABELS = { stocks: '股票', options: '期权', crypto: '虚拟币', prediction: '预测市场' };
  const storage = {
    get(key, fallback) { try { const value = localStorage.getItem(key); return value == null ? fallback : JSON.parse(value); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const guest = () => window.mm_isGuest === true || window.mm_isLoggedIn !== true;
  const toast = (message, kind = 'info') => typeof window.showToast === 'function' && window.showToast(message, kind);
  function csrfHeaders(headers = {}) {
    const cookie = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith('mm_csrf='));
    const token = cookie ? decodeURIComponent(cookie.slice('mm_csrf='.length)) : '';
    return token ? { ...headers, 'x-csrf-token': token } : headers;
  }

  function marketScope() {
    const scope = document.getElementById('market-workspace-shell')?.dataset.marketScope;
    return MARKETS.includes(scope) ? scope : null;
  }

  function installLayoutControls() {
    const layout = document.querySelector('.layout');
    const shell = document.getElementById('market-workspace-shell');
    const main = document.getElementById('center-workspace');
    const library = document.getElementById('right-instrument-library');
    if (!layout || !shell || !main || !library) return;

    const saved = storage.get('mm-layout-widths-v1', {});
    const setWidth = (key, value, min, max, cssVar, target) => {
      const width = Math.max(min, Math.min(max, Math.round(value)));
      target.style.setProperty(cssVar, `${width}px`);
      saved[key] = width;
      storage.set('mm-layout-widths-v1', saved);
      return width;
    };
    if (Number.isFinite(Number(saved.left))) shell.style.setProperty('--mm-left-width', `${Math.max(180, Math.min(360, Number(saved.left)))}px`);
    if (Number.isFinite(Number(saved.right))) layout.style.setProperty('--mm-right-width', `${Math.max(300, Math.min(680, Number(saved.right)))}px`);

    const addSeparator = (host, before, side, label, min, max, cssVar, target) => {
      if (host.querySelector(`[data-mm-resize="${side}"]`)) return;
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'mm-resize-handle';
      handle.dataset.mmResize = side;
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', label);
      handle.setAttribute('aria-valuemin', String(min));
      handle.setAttribute('aria-valuemax', String(max));
      handle.setAttribute('tabindex', '0');
      handle.title = `${label}；拖动或用方向键调整`;
      host.insertBefore(handle, before);
      let dragging = false;
      const valueAt = clientX => side === 'left'
        ? clientX - host.getBoundingClientRect().left
        : window.innerWidth - clientX;
      const move = event => {
        if (!dragging) return;
        setWidth(side, valueAt(event.clientX), min, max, cssVar, target);
        handle.setAttribute('aria-valuenow', target.style.getPropertyValue(cssVar).replace('px', ''));
      };
      const stop = () => {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove('mm-layout-resizing');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
      handle.addEventListener('pointerdown', event => {
        if (window.matchMedia('(max-width: 768px)').matches || (side === 'right' && layout.classList.contains('sidebar-collapsed'))) return;
        dragging = true;
        document.body.classList.add('mm-layout-resizing');
        move(event);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
        window.addEventListener('pointercancel', stop);
      });
      handle.addEventListener('keydown', event => {
        const current = parseFloat(target.style.getPropertyValue(cssVar)) || (side === 'left' ? 224 : 450);
        const sign = side === 'right' ? -1 : 1;
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const amount = (event.key === 'ArrowRight' ? 1 : -1) * sign * (event.shiftKey ? 48 : 16);
          setWidth(side, current + amount, min, max, cssVar, target);
        } else if (event.key === 'Home') {
          event.preventDefault();
          setWidth(side, side === 'left' ? 224 : 450, min, max, cssVar, target);
        }
      });
    };

    addSeparator(shell, main, 'left', '调整左侧功能栏宽度', 180, 360, '--mm-left-width', shell);
    addSeparator(layout, library, 'right', '调整右侧标的库宽度', 300, 680, '--mm-right-width', layout);

    const header = document.querySelector('.header-right');
    if (header && !document.getElementById('mm-layout-menu')) {
      const wrap = document.createElement('div');
      wrap.className = 'mm-layout-menu-wrap';
      wrap.innerHTML = '<button id="mm-layout-menu-toggle" class="refresh-btn" type="button" aria-expanded="false" aria-controls="mm-layout-menu">▦ 布局</button><div id="mm-layout-menu" class="mm-layout-menu" hidden role="group" aria-label="布局密度"><span>界面密度</span><button type="button" data-mm-density-value="comfortable">舒适</button><button type="button" data-mm-density-value="compact">紧凑</button><button type="button" data-mm-density-value="wide">宽屏</button><button type="button" data-mm-layout-reset>恢复默认</button></div>';
      header.insertBefore(wrap, header.querySelector('.refresh-btn'));
      const menu = wrap.querySelector('#mm-layout-menu');
      const toggle = wrap.querySelector('#mm-layout-menu-toggle');
      toggle.addEventListener('click', () => { menu.hidden = !menu.hidden; toggle.setAttribute('aria-expanded', String(!menu.hidden)); });
      wrap.querySelectorAll('[data-mm-density-value]').forEach(button => button.addEventListener('click', () => {
        const value = button.dataset.mmDensityValue;
        document.documentElement.dataset.mmDensity = value;
        storage.set('mm-density-v1', value);
        if (value === 'wide' && window.innerWidth >= 1000) setWidth('right', 520, 300, 680, '--mm-right-width', layout);
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      }));
      wrap.querySelector('[data-mm-layout-reset]').addEventListener('click', () => {
        setWidth('left', 224, 180, 360, '--mm-left-width', shell);
        setWidth('right', 450, 300, 680, '--mm-right-width', layout);
        document.documentElement.dataset.mmDensity = 'comfortable';
        storage.set('mm-density-v1', 'comfortable');
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toast('布局已恢复默认', 'success');
      });
    }
    const density = storage.get('mm-density-v1', 'comfortable');
    document.documentElement.dataset.mmDensity = ['comfortable', 'compact', 'wide'].includes(density) ? density : 'comfortable';

    // Existing collapse control remains the single source of truth for the right library.
    if (typeof window.toggleRightLibrary !== 'function') window.toggleRightLibrary = () => window.toggleSidebar?.();
  }

  function installCommandPaletteActions() {
    const panel = document.querySelector('#global-search-overlay .global-search-panel');
    const results = document.getElementById('global-search-results');
    if (!panel || !results || document.getElementById('mm-command-actions')) return;
    const holder = document.createElement('section');
    holder.id = 'mm-command-actions';
    holder.className = 'mm-command-actions';
    holder.setAttribute('aria-label', '快捷命令');
    holder.innerHTML = '<div class="mm-command-actions-head"><strong>快捷操作</strong><span>Ctrl/⌘ K 打开 · 输入代码可搜索</span></div><div class="mm-command-actions-grid"></div>';
    panel.insertBefore(holder, results);
    const commands = [
      { label: '回到驾驶舱', icon: '⌂', run: () => window.openWorkspace?.('overview') },
      { label: '打开自选', icon: '☆', run: () => window.openWorkspace?.('watchlist') },
      { label: '当前市场筛选', icon: '⌕', run: () => window.openWorkspace?.('screener') },
      { label: '市场事件', icon: '▤', run: () => window.openWorkspace?.('events') },
      { label: '策略回测', icon: '↗', run: () => window.openWorkspace?.('backtest') },
      { label: '研究工作台', icon: '⌘', run: () => window.openWorkspace?.('decision-intelligence') },
      { label: '预警中心', icon: '♧', run: () => window.openWorkspace?.('alerts') },
      { label: '切换到股票', icon: 'S', market: 'stocks' },
      { label: '切换到期权', icon: 'O', market: 'options' },
      { label: '切换到虚拟币', icon: '₿', market: 'crypto' },
      { label: '切换到预测市场', icon: 'P', market: 'prediction' },
    ];
    const grid = holder.querySelector('.mm-command-actions-grid');
    commands.forEach(command => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mm-command-action';
      button.textContent = `${command.icon} ${command.label}`;
      button.addEventListener('click', () => {
        window.closeGlobalSearch?.();
        if (command.market) {
          window.setMarketScope?.(command.market, { openTab: false });
          window.openWorkspace?.(command.market === 'stocks' ? 'stock-quotes' : command.market === 'options' ? 'option-chain' : command.market === 'crypto' ? 'crypto-quotes' : 'prediction-radar');
        } else command.run?.();
      });
      grid.appendChild(button);
    });
    holder.addEventListener('keydown', event => {
      if (event.key === 'Escape') window.closeGlobalSearch?.();
    });
  }

  function installMobileLibraryDrawer() {
    const header = document.querySelector('.header-right');
    const library = document.getElementById('right-instrument-library');
    if (!header || !library || document.getElementById('mm-mobile-library-toggle')) return;
    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.id = 'mm-mobile-library-backdrop';
    backdrop.className = 'mm-mobile-library-backdrop';
    backdrop.setAttribute('aria-label', '关闭标的库');
    document.body.appendChild(backdrop);
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'mm-mobile-library-toggle';
    button.className = 'refresh-btn';
    button.textContent = '▤ 标的库';
    header.insertBefore(button, header.querySelector('.mm-layout-menu-wrap') || header.querySelector('.refresh-btn'));
    const close = () => document.body.classList.remove('mm-library-drawer-open');
    button.addEventListener('click', () => document.body.classList.toggle('mm-library-drawer-open'));
    backdrop.addEventListener('click', close);
    library.querySelector('.sidebar-header')?.insertAdjacentHTML('beforeend', '<button type="button" class="sidebar-collapse-btn mm-library-close" aria-label="关闭标的库">×</button>');
    library.querySelector('.mm-library-close')?.addEventListener('click', close);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  }

  function installOfflineBanner() {
    if (document.getElementById('mm-network-status')) return;
    const banner = document.createElement('div');
    banner.id = 'mm-network-status';
    banner.className = 'mm-network-status';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.hidden = navigator.onLine;
    document.body.appendChild(banner);
    const setOnline = () => {
      banner.hidden = navigator.onLine;
      banner.textContent = navigator.onLine ? '' : '当前离线 · 行情和研究操作已暂停，仅可查看最近的公开摘要缓存';
      if (!navigator.onLine && window.mm_isGuest === true) renderPublicDashboardSnapshot();
    };
    window.addEventListener('online', setOnline);
    window.addEventListener('offline', setOnline);
    const cards = document.getElementById('workspace-dashboard-cards');
    if (cards) new MutationObserver(() => {
      if (window.mm_isGuest !== true || !navigator.onLine) return;
      const snapshot = [...cards.querySelectorAll('.workspace-dashboard-card:not([data-dashboard-card="stock-guru-watchlist"]):not([data-dashboard-card^="watchlist"])')].map(card => ({
        title: card.querySelector('.workspace-dashboard-card-title')?.textContent?.trim() || '',
        state: card.querySelector('.workspace-dashboard-status-label')?.textContent?.trim() || '',
        source: card.querySelector('.workspace-dashboard-card-meta')?.textContent?.trim() || '',
        metrics: card.querySelector('.workspace-dashboard-card-metrics')?.textContent?.trim() || '',
        reason: card.querySelector('.workspace-dashboard-card-reason')?.textContent?.trim() || '',
        updated: card.querySelector('.workspace-dashboard-card-time')?.textContent?.trim() || '',
      })).filter(item => item.title);
      if (snapshot.length) storage.set('mm-public-dashboard-snapshot-v1', { savedAt: new Date().toISOString(), items: snapshot.slice(0, 20) });
    }).observe(cards, { childList: true, subtree: true, characterData: true });
    setOnline();
  }

  function renderPublicDashboardSnapshot() {
    const host = document.getElementById('workspace-dashboard-cards');
    const snapshot = storage.get('mm-public-dashboard-snapshot-v1', null);
    if (!host || !snapshot?.items?.length) return;
    host.replaceChildren();
    const note = document.createElement('div');
    note.className = 'mm-offline-snapshot-note';
    note.textContent = `只读公开快照 · ${snapshot.savedAt ? new Date(snapshot.savedAt).toLocaleString('zh-CN') : '保存时间未知'} · 数据可能已过期`;
    host.appendChild(note);
    for (const item of snapshot.items) {
      const card = document.createElement('article');
      card.className = 'workspace-dashboard-card';
      for (const [className, value] of [
        ['workspace-dashboard-card-title', item.title],
        ['workspace-dashboard-card-meta', `${item.source || '来源未记录'} · 离线缓存`],
        ['workspace-dashboard-card-reason', item.metrics || item.reason || '快照中没有可展示指标'],
        ['workspace-dashboard-card-time', item.updated || '更新时间未知'],
      ]) {
        const line = document.createElement('div');
        line.className = className;
        line.textContent = value;
        card.appendChild(line);
      }
      host.appendChild(card);
    }
  }

  const watchlistPins = new Set(storage.get('mm-watchlist-pins-v1', []));
  let watchlistUndoItems = [];
  let watchlistUndoTimer = 0;
  function installWatchlistToolbar() {
    const panel = document.getElementById('workspace-watchlist-panel');
    const host = document.getElementById('workspace-watchlist-groups');
    if (!panel || !host) return;
    if (!panel.querySelector('.mm-watchlist-toolbar')) {
      const toolbar = document.createElement('div');
      toolbar.className = 'mm-watchlist-toolbar';
      toolbar.innerHTML = '<input type="search" data-mm-watchlist-search aria-label="筛选自选" placeholder="筛选代码或名称"><select data-mm-watchlist-sort aria-label="自选排序"><option value="pinned">置顶优先</option><option value="name">名称 A-Z</option><option value="upcoming">临近事件优先（加载行动后）</option><option value="status">来源异常优先（加载行动后）</option><option value="pending">待处理数量（加载行动后）</option></select><button type="button" class="tab" data-mm-watchlist-collapse-all>折叠分组</button><button type="button" class="tab guest-admin-only" data-mm-watchlist-select-all>全选可见</button><button type="button" class="tab guest-admin-only" data-mm-watchlist-alert disabled>批量提醒（0）</button><button type="button" class="tab guest-admin-only" data-mm-watchlist-remove disabled>批量移出</button><span data-mm-watchlist-count aria-live="polite"></span>';
      const columns = panel.querySelector('#workspace-watchlist-columns');
      panel.insertBefore(toolbar, columns || host);
      const sort = toolbar.querySelector('[data-mm-watchlist-sort]');
      sort.value = storage.get('mm-watchlist-sort-v1', 'pinned');
      toolbar.querySelector('[data-mm-watchlist-search]').addEventListener('input', applyWatchlistView);
      sort.addEventListener('change', () => { storage.set('mm-watchlist-sort-v1', sort.value); applyWatchlistView(); });
      toolbar.querySelector('[data-mm-watchlist-collapse-all]').addEventListener('click', () => {
        const groups = [...host.querySelectorAll('.workspace-watchlist-group')];
        const shouldCollapse = groups.some(group => !group.dataset.mmCollapsed);
        groups.forEach(group => setWatchlistGroupCollapsed(group, shouldCollapse));
        toolbar.querySelector('[data-mm-watchlist-collapse-all]').textContent = shouldCollapse ? '展开分组' : '折叠分组';
      });
      toolbar.querySelector('[data-mm-watchlist-select-all]').addEventListener('click', () => {
        const checks = [...host.querySelectorAll('[data-mm-watchlist-select]')].filter(input => input.closest('[data-watchlist-instrument]')?.hidden !== true);
        const select = checks.some(input => !input.checked);
        checks.forEach(input => { input.checked = select; });
        updateWatchlistSelection();
      });
      toolbar.querySelector('[data-mm-watchlist-alert]').addEventListener('click', () => openBulkAlertComposer(selectedWatchlistIds()));
      toolbar.querySelector('[data-mm-watchlist-remove]').addEventListener('click', () => removeSelectedWatchlistItems(selectedWatchlistIds()));
      host.addEventListener('change', event => {
        if (event.target.matches('[data-mm-watchlist-select]')) updateWatchlistSelection();
      });
      host.addEventListener('click', event => {
        const pin = event.target.closest('[data-mm-watchlist-pin]');
        if (pin) {
          event.preventDefault(); event.stopPropagation();
          const id = pin.dataset.mmWatchlistPin;
          if (watchlistPins.has(id)) watchlistPins.delete(id); else watchlistPins.add(id);
          storage.set('mm-watchlist-pins-v1', [...watchlistPins]);
          decorateWatchlist(); applyWatchlistView();
          return;
        }
        const collapse = event.target.closest('[data-mm-watchlist-group-toggle]');
        if (collapse) {
          event.preventDefault(); event.stopPropagation();
          const group = collapse.closest('.workspace-watchlist-group');
          setWatchlistGroupCollapsed(group, !group.dataset.mmCollapsed);
        }
      });
      new MutationObserver(() => { decorateWatchlist(); applyWatchlistView(); }).observe(host, { childList: true, subtree: true });
    }
    decorateWatchlist();
    applyWatchlistView();
    if (window.mm_isGuest === true) panel.querySelector('.mm-watchlist-toolbar')?.classList.add('is-guest');
  }

  function decorateWatchlist() {
    const host = document.getElementById('workspace-watchlist-groups');
    if (!host) return;
    for (const group of host.querySelectorAll('.workspace-watchlist-group')) {
      const title = group.querySelector('.workspace-watchlist-group-title');
      const label = title?.querySelector('span')?.textContent?.trim() || title?.textContent?.trim() || '';
      const groupId = group.dataset.watchlistGroupId || (label.includes('模拟') ? 'paper' : 'watchlist');
      group.dataset.watchlistGroupId = groupId;
      if (title && !title.querySelector('[data-mm-watchlist-group-toggle]')) {
        const toggle = document.createElement('button');
        toggle.type = 'button'; toggle.className = 'tab mm-watchlist-group-toggle';
        toggle.dataset.mmWatchlistGroupToggle = 'true'; toggle.textContent = group.dataset.mmCollapsed ? '展开' : '折叠';
        toggle.setAttribute('aria-expanded', String(!group.dataset.mmCollapsed));
        title.appendChild(toggle);
      }
      for (const item of group.querySelectorAll('tr.workspace-watchlist-row[data-watchlist-instrument], .workspace-watchlist-card[data-watchlist-instrument]')) {
        const id = item.dataset.watchlistInstrument;
        if (!id) continue;
        const titleNode = item.querySelector('strong');
        if (titleNode) item.dataset.mmWatchlistName = titleNode.textContent.trim();
        if (groupId !== 'watchlist') continue;
        const firstCell = item.matches('tr') ? item.querySelector('td') : item;
        if (!firstCell) continue;
        if (!guest() && !item.querySelector('[data-mm-watchlist-select]')) {
          const check = document.createElement('input');
          check.type = 'checkbox'; check.dataset.mmWatchlistSelect = 'true'; check.value = id;
          check.setAttribute('aria-label', `选择 ${item.dataset.mmWatchlistName || id}`);
          check.addEventListener('click', event => event.stopPropagation());
          firstCell.prepend(check);
        }
        if (!item.querySelector('[data-mm-watchlist-pin]')) {
          const pin = document.createElement('button');
          pin.type = 'button'; pin.className = 'tab mm-watchlist-pin'; pin.dataset.mmWatchlistPin = id;
          pin.textContent = watchlistPins.has(id) ? '★ 已置顶' : '☆ 置顶';
          pin.setAttribute('aria-pressed', String(watchlistPins.has(id)));
          firstCell.appendChild(pin);
        }
      }
      setWatchlistGroupCollapsed(group, group.dataset.mmCollapsed === 'true', false);
    }
  }

  function setWatchlistGroupCollapsed(group, collapsed, persist = true) {
    if (!group) return;
    const key = group.dataset.watchlistGroupId || 'watchlist';
    const saved = storage.get('mm-watchlist-collapsed-v1', {});
    group.dataset.mmCollapsed = String(Boolean(collapsed));
    const content = group.querySelector('table, .workspace-watchlist-cards');
    if (content) content.hidden = Boolean(collapsed);
    const button = group.querySelector('[data-mm-watchlist-group-toggle]');
    if (button) {
      const label = collapsed ? '展开' : '折叠';
      if (button.textContent !== label) button.textContent = label;
      const expanded = String(!collapsed);
      if (button.getAttribute('aria-expanded') !== expanded) button.setAttribute('aria-expanded', expanded);
    }
    if (persist) { saved[key] = Boolean(collapsed); storage.set('mm-watchlist-collapsed-v1', saved); }
  }

  function applyWatchlistView() {
    const panel = document.getElementById('workspace-watchlist-panel');
    const host = document.getElementById('workspace-watchlist-groups');
    if (!panel || !host) return;
    const query = String(panel.querySelector('[data-mm-watchlist-search]')?.value || '').trim().toLocaleLowerCase();
    const sort = panel.querySelector('[data-mm-watchlist-sort]')?.value || 'pinned';
    const savedCollapsed = storage.get('mm-watchlist-collapsed-v1', {});
    for (const group of host.querySelectorAll('.workspace-watchlist-group')) {
      const groupId = group.dataset.watchlistGroupId || 'watchlist';
      setWatchlistGroupCollapsed(group, group.dataset.mmCollapsed === 'true' || savedCollapsed[groupId] === true, false);
      const selector = group.querySelector('table tbody') || group.querySelector('.workspace-watchlist-cards');
      if (selector) {
        const existingItems = [...selector.querySelectorAll('tr.workspace-watchlist-row, .workspace-watchlist-card')];
        const items = [...existingItems];
        items.sort((a, b) => {
          const aid = a.dataset.watchlistInstrument || ''; const bid = b.dataset.watchlistInstrument || '';
          const ap = groupId === 'watchlist' && watchlistPins.has(aid) ? 1 : 0;
          const bp = groupId === 'watchlist' && watchlistPins.has(bid) ? 1 : 0;
          if (sort === 'pinned' && ap !== bp) return bp - ap;
          const am=window.mmActionSortMeta?.[aid] || { pending:0,upcoming:Infinity,status:0 };
          const bm=window.mmActionSortMeta?.[bid] || { pending:0,upcoming:Infinity,status:0 };
          if (sort === 'pending' && am.pending !== bm.pending) return bm.pending-am.pending;
          if (sort === 'status' && am.status !== bm.status) return bm.status-am.status;
          if (sort === 'upcoming' && am.upcoming !== bm.upcoming) return am.upcoming-bm.upcoming;
          return (a.dataset.mmWatchlistName || '').localeCompare(b.dataset.mmWatchlistName || '', 'zh-CN', { numeric: true });
        });
        if (items.some((item, index) => item !== existingItems[index])) items.forEach(item => selector.appendChild(item));
        items.forEach(item => {
          item.hidden = query && !(item.dataset.mmWatchlistName || item.textContent).toLocaleLowerCase().includes(query);
        });
      }
    }
    updateWatchlistSelection();
  }

  window.addEventListener('mm-action-items-updated', applyWatchlistView);

  function selectedWatchlistIds() {
    return [...new Set([...document.querySelectorAll('#workspace-watchlist-groups [data-mm-watchlist-select]:checked')].map(input => input.value))].slice(0, 20);
  }

  function updateWatchlistSelection() {
    const panel = document.getElementById('workspace-watchlist-panel');
    if (!panel) return;
    const selected = selectedWatchlistIds();
    const alertButton = panel.querySelector('[data-mm-watchlist-alert]');
    const removeButton = panel.querySelector('[data-mm-watchlist-remove]');
    const count = panel.querySelector('[data-mm-watchlist-count]');
    if (alertButton) { alertButton.disabled = selected.length === 0; alertButton.textContent = `批量提醒（${selected.length}）`; }
    if (removeButton) { removeButton.disabled = selected.length === 0; removeButton.textContent = `批量移出（${selected.length}）`; }
    if (count) count.textContent = selected.length ? `已选 ${selected.length} 项` : '支持筛选、置顶、折叠与批量操作';
  }

  async function openBulkAlertComposer(ids) {
    if (guest()) return toast('登录后可创建提醒', 'error');
    if (!ids?.length) return;
    const scopes = new Set(ids.map(id => id.startsWith('stock:') ? 'stocks' : id.startsWith('crypto:') ? 'crypto' : id.startsWith('option:') ? 'options' : id.startsWith('prediction:') ? 'prediction' : ''));
    if (scopes.size !== 1 || !MARKETS.includes([...scopes][0])) return toast('批量提醒必须是同一市场的已识别标的', 'error');
    const scope = [...scopes][0];
    if (!['stocks', 'crypto'].includes(scope)) return toast('当前来源没有适用于该市场标的的可靠即时报价，暂不批量创建价格提醒', 'error');
    if (ids.length > 6) return toast('单次最多选择 6 个标的，避免请求过量', 'error');
    const overlay = createModal('批量价格提醒', '<div class="empty-tip">正在读取当前市场真实报价…</div>');
    try {
      const query = new URLSearchParams({ scope, ids: ids.join(',') });
      const response = await fetch(`/api/instruments/compare?${query}`, { credentials: 'include', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || '报价读取失败');
      const byId = new Map((body.data || []).map(item => [item.id, item]));
      const rows = ids.map(id => ({ id, row: byId.get(id) || null, price: Number(byId.get(id)?.quote?.price) }));
      if (rows.some(row => !Number.isFinite(row.price) || row.price <= 0)) throw new Error('部分标的当前没有有效报价；为避免创建错误提醒，本次未保存任何规则。');
      overlay.querySelector('.mm-modal-body').innerHTML = `<p>按最新来源报价预览阈值；所有规则都会绑定到各自的${MARKET_LABELS[scope]}标的。当前只支持股票与虚拟币。</p><label class="mm-alert-field">触发方向 <select data-mm-bulk-alert-direction><option value="above">上涨到</option><option value="below">下跌到</option></select></label><label class="mm-alert-field">偏离幅度 (%) <input type="number" min="0.1" max="90" step="0.1" value="5" data-mm-bulk-alert-pct></label><div class="mm-alert-preview-list">${rows.map(item => `<div data-mm-alert-row="${escapeHtml(item.id)}"><strong>${escapeHtml(item.row.title || item.row.symbol || item.id)}</strong><span>现价 ${escapeHtml(item.price.toLocaleString(undefined, { maximumFractionDigits: 6 }))}</span><span data-mm-alert-target>目标价待计算</span><small>${escapeHtml(item.row.freshness?.status || '状态未知')} · ${escapeHtml(item.row.freshness?.fetchedAt || '时间未知')}</small></div>`).join('')}</div><button type="button" class="tab active" data-mm-bulk-alert-save>创建 ${rows.length} 条提醒</button>`;
      const update = () => {
        const pct = Number(overlay.querySelector('[data-mm-bulk-alert-pct]').value);
        const direction = overlay.querySelector('[data-mm-bulk-alert-direction]').value;
        overlay.querySelectorAll('[data-mm-alert-row]').forEach((element, index) => {
          const target = rows[index].price * (1 + (direction === 'above' ? 1 : -1) * pct / 100);
          element.querySelector('[data-mm-alert-target]').textContent = `目标价 ${target.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
        });
      };
      overlay.querySelector('[data-mm-bulk-alert-direction]').addEventListener('change', update);
      overlay.querySelector('[data-mm-bulk-alert-pct]').addEventListener('input', update);
      update();
      overlay.querySelector('[data-mm-bulk-alert-save]').addEventListener('click', async event => {
        const button = event.currentTarget;
        const pct = Number(overlay.querySelector('[data-mm-bulk-alert-pct]').value);
        if (!Number.isFinite(pct) || pct <= 0 || pct > 90) return toast('偏离幅度需在 0.1% 到 90% 之间', 'error');
        const direction = overlay.querySelector('[data-mm-bulk-alert-direction]').value;
        button.disabled = true;
        const results = await Promise.allSettled(rows.map(item => {
          const value = Math.round(item.price * (1 + (direction === 'above' ? 1 : -1) * pct / 100) * 1e8) / 1e8;
          return fetch('/api/alert-rules', { method: 'POST', credentials: 'include', headers: csrfHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ instrumentId: item.id, scope, kind: 'price', condition: { direction, value }, channels: { web: true, telegram: true }, cooldownMinutes: 30 }) }).then(async response => { const body = await response.json(); if (!response.ok || !body.success) throw new Error(body.error || '保存失败'); return body; });
        }));
        const success = results.filter(result => result.status === 'fulfilled').length;
        overlay.remove();
        toast(`已创建 ${success}/${rows.length} 条价格提醒${success < rows.length ? '；失败项请在提醒中心复核' : ''}`, success === rows.length ? 'success' : 'info');
        if (typeof window.loadAlerts === 'function') window.loadAlerts();
      });
    } catch (error) {
      overlay.querySelector('.mm-modal-body').textContent = error.message || '无法创建提醒';
    }
  }

  async function removeSelectedWatchlistItems(ids) {
    if (guest() || !ids?.length) return;
    if (!window.confirm(`确定从自选中移出 ${ids.length} 个标的？可以在 8 秒内撤销。`)) return;
    const results = await Promise.allSettled(ids.map(id => fetch(`/api/watchlist/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include', headers: csrfHeaders() }).then(response => { if (!response.ok) throw new Error('移出失败'); return id; })));
    watchlistUndoItems = results.filter(result => result.status === 'fulfilled').map(result => result.value);
    for (const input of document.querySelectorAll('#workspace-watchlist-groups [data-mm-watchlist-select]:checked')) input.checked = false;
    if (typeof window.loadWorkspaceWatchlist === 'function') window.loadWorkspaceWatchlist(true);
    showUndo(`已移出 ${watchlistUndoItems.length} 项`, async () => {
      const restore = await Promise.allSettled(watchlistUndoItems.map(instrumentId => fetch('/api/watchlist', { method: 'POST', credentials: 'include', headers: csrfHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ instrumentId }) }).then(response => { if (!response.ok) throw new Error('恢复失败'); })));
      const count = restore.filter(item => item.status === 'fulfilled').length;
      if (typeof window.loadWorkspaceWatchlist === 'function') window.loadWorkspaceWatchlist(true);
      toast(`已恢复 ${count}/${watchlistUndoItems.length} 项自选`, count === watchlistUndoItems.length ? 'success' : 'info');
    });
  }

  function showUndo(message, action) {
    let host = document.getElementById('mm-undo-toast');
    if (!host) { host = document.createElement('div'); host.id = 'mm-undo-toast'; host.className = 'mm-undo-toast'; document.body.appendChild(host); }
    window.clearTimeout(watchlistUndoTimer);
    host.innerHTML = `<span>${escapeHtml(message)}</span><button type="button">撤销</button>`;
    host.hidden = false;
    host.querySelector('button').addEventListener('click', async () => { host.hidden = true; await action(); });
    watchlistUndoTimer = window.setTimeout(() => { host.hidden = true; }, 8000);
  }

  function createModal(title, bodyHtml) {
    const overlay = document.createElement('div');
    overlay.className = 'mm-modal-overlay';
    overlay.innerHTML = `<section class="mm-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header><strong>${escapeHtml(title)}</strong><button type="button" aria-label="关闭">×</button></header><div class="mm-modal-body">${bodyHtml}</div></section>`;
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelector('header button').addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
    overlay.querySelector('header button').focus();
    return overlay;
  }

  let screenerMonitorScope = '';
  async function refreshScreenerMonitor(force = false) {
    const market = marketScope();
    const results = document.getElementById('market-screener-results');
    const card = document.getElementById('market-screener');
    if (!market || !results || !card) return;
    let section = card.querySelector('#mm-screener-monitor');
    if (!section) {
      section = document.createElement('section');
      section.id = 'mm-screener-monitor';
      section.className = 'mm-screener-monitor';
      section.innerHTML = '<div class="mm-screener-monitor-head"><div><strong>持续筛选跟踪</strong><small>每日后台巡检 · 仅检查已建立有效基线的模板 · 来源为空或失败时保留上次结果</small></div><button type="button" class="tab" data-mm-screener-refresh>刷新模板</button></div><div data-mm-screener-content>读取已保存筛选模板…</div>';
      results.insertAdjacentElement('afterend', section);
      section.querySelector('[data-mm-screener-refresh]').addEventListener('click', () => { screenerMonitorScope = ''; refreshScreenerMonitor(); });
      section.addEventListener('click', event => {
        const button = event.target.closest('[data-mm-screen-action]');
        if (!button) return;
        const id = button.dataset.templateId;
        if (button.dataset.mmScreenAction === 'run') runTrackedScreen(id, button);
        if (button.dataset.mmScreenAction === 'stop') stopTrackedScreen(id);
      });
    }
    if (!force && screenerMonitorScope === market && !section.dataset.forceRefresh) return;
    section.dataset.forceRefresh = '';
    screenerMonitorScope = market;
    const target = section.querySelector('[data-mm-screener-content]');
    target.textContent = '读取已保存筛选模板…';
    if (guest()) { target.textContent = '筛选模板和持续监控是管理员私有内容；访客不会读取或缓存。'; return; }
    try {
      const [templateResponse, trackingResponse] = await Promise.all([
        fetch('/api/screener/templates', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/screener/tracking', { credentials: 'include', cache: 'no-store' }),
      ]);
      const templateBody = await templateResponse.json();
      const trackingBody = await trackingResponse.json();
      if (!templateResponse.ok || !templateBody.success) throw new Error(templateBody.error || '模板读取失败');
      const templates = (templateBody.data || []).filter(item => item.scope === market);
      const tracking = trackingResponse.ok && trackingBody.success ? trackingBody.data || [] : [];
      const tracked = new Map(tracking.map(item => [item.templateId, item]));
      if (!templates.length) { target.textContent = '当前市场还没有保存的筛选模板。先设置筛选条件并保存，再开启持续跟踪。'; return; }
      target.innerHTML = templates.map(template => {
        const record = tracked.get(template.id);
        const status = !record ? '未监控' : record.lastStatus === 'failed' ? `未更新 · ${record.reason || '来源不可用'}` : record.lastStatus === 'baseline' ? `基线已建立 · ${record.currentIds.length} 个` : `监控中 · 新进 ${record.entered.length} / 离开 ${record.exited.length}`;
        const changes = record && record.lastStatus === 'updated'
          ? `<div class="mm-screen-delta">${record.entered.length ? `新进入：${record.entered.map(id => escapeHtml(id.split(':').pop())).join('、')}` : '无新增'}${record.exited.length ? ` · 离开：${record.exited.map(id => escapeHtml(id.split(':').pop())).join('、')}` : ''}</div>` : '';
        const time = record?.attemptedAt ? new Date(record.attemptedAt).toLocaleString('zh-CN') : '尚未检查';
        const due = record?.lastRunAt ? new Date(new Date(record.lastRunAt).getTime() + 24 * 60 * 60_000).toLocaleString('zh-CN') : '';
        return `<article class="mm-screen-track-row"><div><strong>${escapeHtml(template.name)}</strong><span>${escapeHtml(status)}</span><small>上次检查 ${escapeHtml(time)} · 数据状态 ${escapeHtml(record?.dataStatus || '未运行')}${due && record.lastStatus !== 'failed' ? ` · 下次自动巡检不早于 ${escapeHtml(due)}` : ''}</small>${changes}</div><div><button type="button" class="tab" data-mm-screen-action="run" data-template-id="${escapeHtml(template.id)}">${record ? '立即检查' : '建立基线并开始跟踪'}</button>${record ? `<button type="button" class="tab" data-mm-screen-action="stop" data-template-id="${escapeHtml(template.id)}">停止跟踪</button>` : ''}</div></article>`;
      }).join('');
    } catch (error) { target.textContent = `筛选监控暂不可用：${error.message || '请求失败'}`; }
  }

  async function runTrackedScreen(id, button) {
    button.disabled = true;
    try {
      const response = await fetch(`/api/screener/tracking/${encodeURIComponent(id)}/run`, { method: 'POST', credentials: 'include', headers: csrfHeaders({ 'Content-Type': 'application/json' }), body: '{}' });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || '筛选巡检失败');
      toast(body.data.lastStatus === 'baseline' ? '持续筛选基线已建立' : `巡检完成：新进 ${body.data.entered.length}、离开 ${body.data.exited.length}`, 'success');
      screenerMonitorScope = '';
      refreshScreenerMonitor();
    } catch (error) { toast(error.message || '筛选巡检失败；原有效基线已保留', 'error'); screenerMonitorScope = ''; refreshScreenerMonitor(); }
    finally { button.disabled = false; }
  }

  async function stopTrackedScreen(id) {
    try {
      const response = await fetch(`/api/screener/tracking/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include', headers: csrfHeaders() });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || '停止跟踪失败');
      screenerMonitorScope = ''; refreshScreenerMonitor();
      toast('已停止该筛选模板的持续跟踪', 'success');
    } catch (error) { toast(error.message || '停止跟踪失败', 'error'); }
  }

  function installGuruHoldingsMatrix() {
    const host = document.getElementById('guru-holdings-content');
    if (!host || document.getElementById('mm-guru-matrix')) return;
    const parent = host.parentElement;
    if (!parent) return;
    const section = document.createElement('section');
    section.id = 'mm-guru-matrix'; section.className = 'mm-guru-matrix';
    section.innerHTML = '<div class="mm-guru-matrix-head"><div><strong>自选机构持仓变化矩阵</strong><small>逐机构展示 SEC 13F 同机构可比报告期变化；不汇总成市场总持仓</small></div><button type="button" class="tab guest-admin-only" data-mm-guru-matrix-load>加载矩阵</button></div><div data-mm-guru-matrix-content>点击加载；13F 为季度滞后披露，不代表实时持仓。</div>';
    const disclaimer = document.getElementById('guru-holdings-disclaimer');
    parent.insertBefore(section, disclaimer || null);
    section.querySelector('[data-mm-guru-matrix-load]').addEventListener('click', loadGuruMatrix);
  }

  async function loadGuruMatrix() {
    const host = document.querySelector('#mm-guru-matrix [data-mm-guru-matrix-content]');
    if (!host) return;
    if (guest()) { host.textContent = '大神持仓变化属于管理员自选数据；访客模式不读取。'; return; }
    host.textContent = '正在按各自选标的查询 SEC Form 13F…';
    try {
      const response = await fetch('/api/stocks/guru-holdings/watchlist/changes', { credentials: 'include', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.reason || body.error || 'SEC 来源请求失败');
      const symbols = Array.isArray(body.symbols) ? body.symbols : Array.isArray(body.data?.symbols) ? body.data.symbols : [];
      const names = [...new Set(symbols.map(item => String(item.symbol || '').toUpperCase()).filter(Boolean))].sort();
      const managers = new Map();
      for (const item of symbols) for (const holding of item.holders || []) {
        const cik = String(holding.cik || '').trim();
        const key = cik ? `cik:${cik}` : `unmapped:${item.symbol}:${managers.size}`;
        const row = managers.get(key) || { name: holding.managerName || holding.filingName || (cik ? `CIK ${cik}` : '未映射机构'), cik, cells: {} };
        row.cells[String(item.symbol).toUpperCase()] = holding;
        managers.set(key, row);
      }
      if (!names.length) { host.textContent = body.reason || '自选中暂无已核验的 13F 标的。'; return; }
      const cell = holding => {
        if (!holding) return '<span class="mm-guru-empty">—</span>';
        const delta = Number(holding.shareDelta);
        const change = String(holding.change || 'unknown');
        const label = change === 'new' ? '新进' : change === 'exited' ? '退出' : Number.isFinite(delta) ? `${delta > 0 ? '+' : ''}${delta.toLocaleString()} 股` : change;
        const color = ['new', 'increased'].includes(change) || delta > 0 ? 'var(--green)' : ['exited', 'decreased'].includes(change) || delta < 0 ? 'var(--red)' : 'var(--text-secondary)';
        const href = /^https:\/\//i.test(String(holding.sourceUrl || '')) ? `<a href="${escapeHtml(holding.sourceUrl)}" target="_blank" rel="noopener noreferrer">SEC</a>` : '来源缺失';
        return `<span style="color:${color};font-weight:700">${escapeHtml(label)}</span><small>${escapeHtml(holding.reportPeriod || '报告期未知')} · 申报 ${escapeHtml(holding.filedAt || '日期未知')}</small><small>${href}</small>`;
      };
      const status = Object.fromEntries(symbols.map(item => [String(item.symbol).toUpperCase(), item]));
      host.innerHTML = `<div class="mm-guru-table-wrap"><table class="mm-guru-table"><thead><tr><th>机构（独立行）</th>${names.map(name => `<th>${escapeHtml(name)}<small>${escapeHtml(status[name]?.dataStatus || 'unknown')}${status[name]?.reason ? ` · ${escapeHtml(status[name].reason)}` : ''}</small></th>`).join('')}</tr></thead><tbody>${[...managers.values()].map(row => `<tr><th>${escapeHtml(row.name)}<small>CIK ${escapeHtml(row.cik || '未核验')}</small></th>${names.map(name => `<td>${cell(row.cells[name])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${names.length + 1}">有可用标的，但没有已确认机构的可比报告</td></tr>`}</tbody></table></div><p class="mm-guru-caveat">${escapeHtml(body.reason || '')} 不同机构股数不会相加；报告缺失或身份映射不完整时显示为空，不做推断。</p>`;
    } catch (error) { host.textContent = `SEC 13F 来源不可用：${error.message || '请求失败'}`; }
  }

  function installDigestWorkflow() {
    const section = document.getElementById('market-change-digest');
    const list = document.getElementById('market-change-digest-list');
    if (!section || !list || section.querySelector('.mm-digest-filters')) return;
    const heading = section.querySelector('.market-change-digest-head strong');
    if (heading) heading.textContent = '🧭 今日待处理 · 自选变化';
    const status = document.getElementById('market-change-digest-status');
    const controls = document.createElement('div');
    controls.className = 'mm-digest-filters';
    controls.innerHTML = '<span data-mm-digest-count></span><button type="button" class="tab active" data-mm-digest-filter="all">全部</button><button type="button" class="tab" data-mm-digest-filter="event">事件/新闻</button><button type="button" class="tab" data-mm-digest-filter="price">行情</button><button type="button" class="tab" data-mm-digest-filter="signal">信号</button><button type="button" class="tab" data-mm-digest-filter="13f">13F</button><button type="button" class="tab" data-mm-digest-filter="source">数据源</button>';
    status?.insertAdjacentElement('afterend', controls);
    controls.addEventListener('click', event => {
      const button = event.target.closest('[data-mm-digest-filter]');
      if (!button) return;
      controls.querySelectorAll('[data-mm-digest-filter]').forEach(item => item.classList.toggle('active', item === button));
      filterDigest(button.dataset.mmDigestFilter);
    });
    new MutationObserver(() => filterDigest(controls.querySelector('.active')?.dataset.mmDigestFilter || 'all')).observe(list, { childList: true, subtree: true });
    filterDigest('all');
  }

  function filterDigest(kind) {
    const section = document.getElementById('market-change-digest');
    const controls = section?.querySelector('.mm-digest-filters');
    const records = [...(section?.querySelectorAll('.market-change-digest-item') || [])];
    const counts = { event: 0, price: 0, signal: 0, '13f': 0, source: 0 };
    records.forEach(record => { if (counts[record.dataset.digestKind] != null) counts[record.dataset.digestKind] += 1; record.hidden = kind !== 'all' && record.dataset.digestKind !== kind; });
    const visible = records.filter(record => !record.hidden).length;
    const count = controls?.querySelector('[data-mm-digest-count]');
    if (count) count.textContent = `待处理 ${records.length} 项 · 当前 ${visible} 项`;
    controls?.querySelectorAll('[data-mm-digest-filter]').forEach(button => {
      const key = button.dataset.mmDigestFilter;
      const base = button.dataset.mmBaseLabel || button.textContent.replace(/\s*\(\d+\)$/, '');
      button.dataset.mmBaseLabel = base;
      button.textContent = ({ all: `${base} (${records.length})`, event: `事件/新闻 (${counts.event})`, price: `行情 (${counts.price})`, signal: `信号 (${counts.signal})`, '13f': `13F (${counts['13f']})`, source: `数据源 (${counts.source})` })[key] || base;
    });
  }

  function installAlertHistoryPreview() {
    const button = document.querySelector('[data-mm-alert-history-preview]');
    const panel = document.getElementById('mm-alert-history-preview');
    if (!button || !panel || button.dataset.bound) return;
    button.dataset.bound = 'true';
    button.addEventListener('click', async () => {
      const market = marketScope();
      const symbol = String(document.getElementById('alert-symbol')?.value || '').trim().toUpperCase();
      const target = Number(document.getElementById('alert-price')?.value);
      const direction = document.getElementById('alert-direction')?.value === 'BELOW' ? 'below' : 'above';
      panel.hidden = false;
      if (!market || !symbol || !Number.isFinite(target) || target <= 0) { panel.textContent = '请先选择有效市场、填写标的代码和正数目标价。'; return; }
      if (market !== 'stocks') { panel.textContent = '历史预览目前只接入股票真实日K；其他市场不使用股票数据替代。'; return; }
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) { panel.textContent = '股票代码格式无效。'; return; }
      panel.textContent = '正在读取该股票真实历史日K…';
      try {
        const query = new URLSearchParams({ symbol: `us${symbol}`, api: symbol, period: '1d', interval: '1d' });
        const response = await fetch(`/api/stock/kline?${query}`, { credentials: 'include', cache: 'no-store' });
        const body = await response.json();
        const bars = Array.isArray(body.data) ? body.data : [];
        if (!response.ok || !body.success || !bars.length) throw new Error(body.reason || '历史K线来源没有返回记录');
        const hits = bars.filter(bar => direction === 'above' ? Number(bar.high) >= target : Number(bar.low) <= target);
        const sample = hits.slice(-8).reverse();
        const rows = sample.map(bar => `<tr><td>${escapeHtml(new Date(Number(bar.time)).toLocaleDateString('zh-CN'))}</td><td>${Number(bar.open).toFixed(2)}</td><td>${Number(bar.high).toFixed(2)}</td><td>${Number(bar.low).toFixed(2)}</td><td>${Number(bar.close).toFixed(2)}</td></tr>`).join('');
        panel.innerHTML = `<div><strong>${escapeHtml(symbol)} · ${direction === 'above' ? '高于' : '低于'} ${escapeHtml(target)}</strong><span>历史 OHLC 命中 ${hits.length}/${bars.length} 根日K · ${escapeHtml(body.source || '来源未提供')} · ${escapeHtml(body.dataStatus || '状态未知')}</span></div>${sample.length ? `<div class="mm-alert-history-table-wrap"><table><thead><tr><th>日期</th><th>开</th><th>高</th><th>低</th><th>收</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p>所载历史K线区间内没有达到阈值的日K。</p>'}<small>按日K最高/最低价统计历史触及，不代表触发顺序、成交或未来概率；不会自动创建提醒。</small>`;
      } catch (error) { panel.textContent = `历史触发预览不可用：${error.message || '请求失败'}`; }
    });
  }

  window.MoneyMoneyExperience = window.MoneyMoneyExperience || {};
  window.MoneyMoneyExperience.refreshScreenerMonitor = refreshScreenerMonitor;
  window.MoneyMoneyExperience.loadGuruMatrix = loadGuruMatrix;
  window.MoneyMoneyExperience.installDigestWorkflow = installDigestWorkflow;
  window.MoneyMoneyExperience.installAlertHistoryPreview = installAlertHistoryPreview;
  window.MoneyMoneyExperience.installGuruHoldingsMatrix = installGuruHoldingsMatrix;
  window.MoneyMoneyExperience.loadGuruMatrix = loadGuruMatrix;

  const MULTI_PERIODS = [
    { period: '5m', label: '5 分钟' }, { period: '15m', label: '15 分钟' },
    { period: '1h', label: '1 小时' }, { period: '1d', label: '日线' },
  ];
  let multiChartRequest = 0;
  function installMultiChartToggle() {
    const companion = document.querySelector('[data-stock-chart-companion]');
    const toolbar = companion?.querySelector('.stock-chart-companion-toolbar');
    if (!toolbar || toolbar.querySelector('[data-mm-multi-chart-toggle]')) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'tab'; button.dataset.mmMultiChartToggle = 'true';
    button.textContent = '四周期'; button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', openMultiChart);
    toolbar.appendChild(button);
  }

  function openMultiChart() {
    const panel = document.querySelector('[data-stock-chart-companion]');
    if (!panel || !window.MoneyMoneyChartBridge) return toast('多周期图表尚未准备好', 'error');
    let multi = panel.querySelector('#mm-stock-multi-chart');
    if (!multi) {
      multi = document.createElement('section');
      multi.id = 'mm-stock-multi-chart'; multi.className = 'mm-stock-multi-chart';
      multi.hidden = true;
      multi.innerHTML = `<div class="mm-stock-multi-head"><strong>同一标的 · 四周期</strong><span>点击任一周期日期，联动定位主日K</span><button type="button" class="tab" data-mm-multi-refresh>刷新</button></div><div class="mm-stock-multi-grid">${MULTI_PERIODS.map(item => `<article data-mm-multi-period="${item.period}"><header><strong>${item.label}</strong><span data-mm-multi-status>等待数据</span></header><canvas width="640" height="240" aria-label="${item.label} 股票K线图" tabindex="0"></canvas></article>`).join('')}</div>`;
      panel.appendChild(multi);
      multi.querySelector('[data-mm-multi-refresh]').addEventListener('click', () => loadMultiChart(true));
      multi.addEventListener('click', event => {
        const canvas = event.target.closest('canvas');
        if (!canvas) return;
        const card = canvas.closest('[data-mm-multi-period]');
        const bars = card?.__mmBars || [];
        if (!bars.length) return;
        const rect = canvas.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(0.99999, (event.clientX - rect.left - 55) / Math.max(1, rect.width - 67)));
        const bar = bars[Math.min(bars.length - 1, Math.floor(ratio * bars.length))];
        if (Number.isFinite(Number(bar?.time))) window.MoneyMoneyChartBridge.focusTimestamp(Number(bar.time));
      });
    }
    multi.hidden = !multi.hidden;
    if (!multi.hidden) loadMultiChart(false);
    panel.querySelector('[data-mm-multi-chart-toggle]')?.setAttribute('aria-expanded', String(!multi.hidden));
  }

  async function loadMultiChart() {
    const panel = document.getElementById('mm-stock-multi-chart');
    const bridge = window.MoneyMoneyChartBridge;
    if (!panel || !bridge) return;
    const context = bridge.getContext();
    if (!context?.symbol || !context?.apiSymbol) {
      panel.querySelectorAll('[data-mm-multi-status]').forEach(status => { status.textContent = '请先选择股票'; });
      return;
    }
    const revision = ++multiChartRequest;
    await Promise.all([...panel.querySelectorAll('[data-mm-multi-period]')].map(async card => {
      const period = card.dataset.mmMultiPeriod;
      const status = card.querySelector('[data-mm-multi-status]');
      const canvas = card.querySelector('canvas');
      status.textContent = '请求真实来源…';
      try {
        const query = new URLSearchParams({ symbol: context.symbol, api: context.apiSymbol, period, interval: period });
        if (context.asOf) query.set('asOf', context.asOf);
        const response = await fetch(`/api/stock/kline?${query}`, { credentials: 'include', cache: 'no-store' });
        const body = await response.json();
        if (revision !== multiChartRequest) return;
        if (!response.ok || !body.success || !Array.isArray(body.data) || !body.data.length) throw new Error(body.reason || '来源无可用K线');
        card.__mmBars = body.data;
        bridge.draw(canvas, body.data);
        status.textContent = `${body.data.length} 根 · ${body.dataStatus || '状态未知'} · ${body.source || '来源未知'}`;
      } catch (error) {
        if (revision !== multiChartRequest) return;
        card.__mmBars = [];
        status.textContent = `不可用：${error.message || '请求失败'}`;
        bridge.draw(canvas, []);
      }
    }));
  }

  window.MoneyMoneyExperience = window.MoneyMoneyExperience || {};
  window.MoneyMoneyExperience.installMultiChartToggle = installMultiChartToggle;
  window.MoneyMoneyExperience.loadMultiChart = loadMultiChart;
  window.MoneyMoneyExperience.installWatchlistToolbar = installWatchlistToolbar;
  window.MoneyMoneyExperience.showUndo = showUndo;
  window.MoneyMoneyExperience.createModal = createModal;

  window.MoneyMoneyExperience = window.MoneyMoneyExperience || {};
  window.MoneyMoneyExperience.installLayoutControls = installLayoutControls;
  window.MoneyMoneyExperience.installCommandPaletteActions = installCommandPaletteActions;
  window.MoneyMoneyExperience.renderPublicDashboardSnapshot = renderPublicDashboardSnapshot;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => {
    installLayoutControls(); installCommandPaletteActions(); installMobileLibraryDrawer(); installOfflineBanner();
    installWatchlistToolbar(); installDigestWorkflow(); installAlertHistoryPreview(); installGuruHoldingsMatrix(); installMultiChartToggle();
    refreshScreenerMonitor();
    const shell = document.getElementById('market-workspace-shell');
    if (shell) new MutationObserver(() => refreshScreenerMonitor()).observe(shell, { attributes: true, attributeFilter: ['data-market-scope'] });
  }, { once: true });
  else {
    installLayoutControls(); installCommandPaletteActions(); installMobileLibraryDrawer(); installOfflineBanner();
    installWatchlistToolbar(); installDigestWorkflow(); installAlertHistoryPreview(); installGuruHoldingsMatrix(); installMultiChartToggle();
    refreshScreenerMonitor();
    const shell = document.getElementById('market-workspace-shell');
    if (shell) new MutationObserver(() => refreshScreenerMonitor()).observe(shell, { attributes: true, attributeFilter: ['data-market-scope'] });
  }
})();
