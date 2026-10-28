/* Keeps admin PIN submission independent from the app's shared screen handlers. */
(() => {
  const path = window.location.pathname.replace(/\/$/, '');
  if (path !== '/admin' && path !== '/admin.') return;

  const form = document.querySelector('#adminLoginForm');
  const button = document.querySelector('#adminLoginButton');
  const password = document.querySelector('#adminPassword');
  const login = document.querySelector('#adminLogin');
  const panel = document.querySelector('#adminPanel');
  const content = document.querySelector('#adminContent');
  const loginError = document.querySelector('#adminLoginError');
  const panelError = document.querySelector('#adminPanelError');
  const panelErrorText = document.querySelector('#adminPanelErrorText');
  if (!form || !button || !password || !login || !panel || !content) return;

  let busy = false;
  const readJson = async response => {
    let value;
    try { value = await response.json(); }
    catch { value = { error: `The server returned an invalid response (${response.status}).` }; }
    if (!response.ok) throw new Error(value.error || 'The request could not be completed.');
    return value;
  };
  const request = async (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      return await readJson(await fetch(url, { ...options, signal: controller.signal }));
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The admin server did not respond within 15 seconds. Retry once the connection is available.');
      throw error;
    } finally { clearTimeout(timer); }
  };
  const escapeHtml = value => {
    const node = document.createElement('span');
    node.textContent = value == null ? '' : String(value);
    return node.innerHTML;
  };
  const showPanelError = message => {
    panelErrorText.textContent = message;
    panelError.classList.remove('hide');
  };
  const renderSummaryFallback = async token => {
    const summary = await request('/api/admin/summary', { headers: { Authorization: `Bearer ${token}` } });
    const cards = [
      ['customers', 'Customers'], ['helpers', 'House helps'], ['hires', 'Total hires'],
      ['pending_hires', 'Open hires'], ['completed_hires', 'Completed hires'],
      ['average_rating', 'Average rating'],
    ];
    content.innerHTML = `<h2>Admin centre</h2><p class="sub">Manage House Assist accounts, listings, hires, feedback, and site settings.</p><section class="admin-stats">${cards.map(([key, label]) => `<article class="card"><span class="price">${escapeHtml(summary[key])}</span><span class="mut">${label}</span></article>`).join('')}</section><section class="card"><h3>Latest account registrations</h3><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Type</th><th>Location</th></tr></thead><tbody>${summary.users.map(user => `<tr><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.role)}</td><td>${escapeHtml(user.location)}</td></tr>`).join('') || '<tr><td colspan="3">No accounts yet.</td></tr>'}</tbody></table></div></section>`;
  };

  const authenticateAndOpen = async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;
    busy = true;
    button.disabled = true;
    loginError.textContent = '';
    panelError.classList.add('hide');
    button.textContent = 'Opening dashboard…';
    try {
      const session = await request('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: password.value }),
      });
      login.classList.add('hide');
      panel.classList.remove('hide');
      content.innerHTML = '<div class="card admin-loading" role="status">Loading admin dashboard…</div>';

      if (typeof window.houseAssistRenderAdminSection === 'function') {
        await window.houseAssistRenderAdminSection('overview', session.token);
        if (content.textContent.includes('Loading admin dashboard')) await renderSummaryFallback(session.token);
      } else {
        await renderSummaryFallback(session.token);
      }
    } catch (error) {
      const message = error.message || 'The admin dashboard could not be loaded.';
      if (panel.classList.contains('hide')) loginError.textContent = message;
      else showPanelError(message);
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = 'Continue';
    }
  };

  // Capture the events first so no older handler can reveal the panel without loading it.
  button.addEventListener('click', authenticateAndOpen, true);
  form.addEventListener('submit', authenticateAndOpen, true);
})();
