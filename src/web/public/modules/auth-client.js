window.mm_isLoggedIn = false;
window.mm_isGuest = false;

function csrfToken() {
  const cookie = document.cookie.match(/(?:^|;\s*)mm_csrf=([^;]+)/);
  return cookie ? decodeURIComponent(cookie[1]) : (localStorage.getItem('mm_csrf') || '');
}

window.mmApplyGuestMode = function mmApplyGuestMode() {
  const apply = () => {
    document.body.classList.toggle('guest-mode', !!window.mm_isGuest);
    if (typeof window.renderNavGroups === 'function') window.renderNavGroups();
    if (typeof window.renderNavSubTabs === 'function') window.renderNavSubTabs();
  };
  if (document.body) apply(); else document.addEventListener('DOMContentLoaded', apply, { once: true });
};

const originalFetch = window.fetch.bind(window);
window.fetch = async function authenticatedFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  if (url.includes('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const token = csrfToken();
    if (token && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);
  }
  const response = await originalFetch(input, { ...init, headers, credentials: init.credentials || 'include' });
  if (response.status === 401 && url.includes('/api/')) {
    localStorage.removeItem('mm_token');
    localStorage.removeItem('mm_csrf');
    if (location.pathname !== '/login') location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
  }
  if (response.status === 403 && url.includes('/api/') && window.mm_isGuest) {
    response.clone().json().then((data) => {
      if (data?.code === 'GUEST_READ_ONLY' && typeof window.showToast === 'function') window.showToast(data.error || '访客模式仅支持只读浏览', 'error');
    }).catch(() => {});
  }
  return response;
};

// Remove legacy browser-readable session tokens. Authentication now uses only
// the HttpOnly session cookie; the readable CSRF token carries no authority.
localStorage.removeItem('mm_token');
const onLoginPage = location.pathname === '/login';
window.mm_authReady = window.fetch('/api/auth/status').then((response) => response.json()).then((payload) => {
  const loggedIn = !!payload?.data?.loggedIn;
  window.mm_isLoggedIn = loggedIn;
  window.mm_isGuest = loggedIn && payload.data.role === 'guest';
  if (payload?.data?.csrfToken) localStorage.setItem('mm_csrf', payload.data.csrfToken);
  window.mmApplyGuestMode();
  if (!loggedIn && !onLoginPage && location.pathname === '/') location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
  if (loggedIn && onLoginPage) {
    const next = new URLSearchParams(location.search).get('next');
    location.href = next ? decodeURIComponent(next) : '/';
  }
}).catch(() => {});

window.mmLogout = function mmLogout() {
  if (!confirm('确定退出登录？')) return;
  window.fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
    localStorage.removeItem('mm_token');
    localStorage.removeItem('mm_csrf');
    localStorage.removeItem('mm_user');
    localStorage.removeItem('mm_role');
    window.mm_isLoggedIn = false;
    window.mm_isGuest = false;
    location.href = '/login';
  });
};
window.mmIsLoggedIn = () => !!window.mm_isLoggedIn;
