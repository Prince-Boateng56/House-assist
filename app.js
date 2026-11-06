/* Connects the existing House Assist screens to the API. */
(() => {
  const API = '/api';
  const TOKEN_KEY = 'house-assist-token';
  const SESSION_TOKEN_KEY = 'house-assist-session-token';
  const safeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const requestedPath = window.location.pathname.replace(/\/$/, '');
  const isAdminPath = requestedPath === '/admin.' || requestedPath === '/admin';
  let token = isAdminPath ? '' : (localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(SESSION_TOKEN_KEY) || '');
  const request = async (path, options = {}) => {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(API + path, { ...options, headers });
    let value = null;
    if (response.status !== 204) {
      try { value = await response.json(); }
      catch { value = { error: `The server returned an invalid response (${response.status}).` }; }
    }
    if (!response.ok) {
      const requestError = new Error(value?.error || 'The request could not be completed.');
      requestError.code = value?.code;
      requestError.email = value?.email;
      requestError.status = response.status;
      throw requestError;
    }
    return value;
  };
  const reportError = (element, err) => { if (element) element.textContent = err.message; else toast(err.message); };
  const storeToken = value => {
    token = value || '';
    if (isAdminPath) return;
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    if (!token) return;
    const remember = S.mode === 'signup' || $('#rememberMe')?.checked;
    (remember ? localStorage : sessionStorage).setItem(remember ? TOKEN_KEY : SESSION_TOKEN_KEY, token);
  };
  const showError = err => toast(err.message);
  const GOOGLE_PENDING_KEY = 'house-assist-google-pending';
  const RESET_PENDING_KEY = 'house-assist-password-reset-pending';
  let supabaseClient;
  let recoverySession = false;

  const createSupabaseClient = config => window.supabase.createClient(config.url, config.publishable_key, {
    auth: {
      // Keep the browser callback format predictable and use the code exchange
      // supported by this app's existing callback handler.
      flowType: 'pkce',
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  const googleDetails = () => ({
    username: $('#u').value.trim(),
    role: S.role,
    location: $('#loc').value.trim(),
    services: [...document.querySelectorAll('#svcBox input:checked')].map(input => input.value),
    price: Number($('#pr').value),
  });

  async function continueWithGoogle() {
    localStorage.removeItem(RESET_PENDING_KEY);
    const details = googleDetails();
    $('#em').readOnly = false;
    $('#googleAuth').textContent = 'Continue with Google';
    const signup = S.mode === 'signup';
    if (signup && !details.location) return reportError($('#aErr'), new Error('Select your region before continuing with Google.'));
    if (signup && S.role === 'helper' && (!details.services.length || !Number.isFinite(details.price) || details.price < 1)) {
      return reportError($('#aErr'), new Error('Choose your services and add your daily price before continuing with Google.'));
    }
    try {
      const config = await request('/auth/config');
      if (!window.supabase) throw new Error('The Google sign-in library could not be loaded.');
      supabaseClient = createSupabaseClient(config);
      // The installed PWA may return from Google in a different tab or browser
      // context, where sessionStorage is unavailable. Keep the intended role
      // with the OAuth state in localStorage until the callback is handled.
      localStorage.setItem(GOOGLE_PENDING_KEY, JSON.stringify({ ...details, username: '', mode: S.mode, timestamp: Date.now() }));
      const { error: oauthError } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + window.location.pathname,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (oauthError) throw oauthError;
    } catch (err) { reportError($('#aErr'), err); }
  }

  async function finishGoogleSignIn() {
    const callbackUrl = new URL(window.location.href);
    const callbackCode = callbackUrl.searchParams.get('code');
    const fragment = new URLSearchParams(callbackUrl.hash.replace(/^#/, ''));
    const fragmentAccessToken = fragment.get('access_token');
    const fragmentRefreshToken = fragment.get('refresh_token');
    const recoveryType = callbackUrl.searchParams.get('type') === 'recovery' || fragment.get('type') === 'recovery';
    const pendingReset = (() => {
      try { return JSON.parse(localStorage.getItem(RESET_PENDING_KEY) || 'null'); }
      catch { return null; }
    })();
    const resetCallback = recoveryType || Boolean(pendingReset && (callbackCode || fragmentAccessToken));
    const callbackError = callbackUrl.searchParams.get('error_description') ||
      callbackUrl.searchParams.get('error') || fragment.get('error_description') || fragment.get('error');
    const oauthCallback = Boolean(callbackCode || callbackError || fragmentAccessToken);
    if (callbackError) {
      window.history.replaceState({}, document.title, window.location.pathname);
      if (resetCallback || pendingReset) {
        localStorage.removeItem(RESET_PENDING_KEY);
        showAuth('login', pendingReset?.role || 'customer');
        $('#aErr').textContent = 'This password reset link is invalid or has expired. Request a new one.';
        return true;
      }
      throw new Error('Google sign-in was rejected by Supabase: ' + callbackError.replace(/\+/g, ' '));
    }
    if (!oauthCallback) return false;
    if (oauthCallback) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    const config = await request('/auth/config');
    if (!window.supabase) throw new Error('The Google sign-in library could not be loaded.');
    supabaseClient = createSupabaseClient(config);
    let session;
    if (callbackCode) {
      const { data, error } = await supabaseClient.auth.exchangeCodeForSession(callbackCode);
      if (error) throw error;
      session = data.session;
    } else if (fragmentAccessToken) {
      // Support callbacks created by older clients using the implicit flow.
      // The URL is cleaned above, so restore the fragment tokens explicitly.
      if (!fragmentRefreshToken) throw new Error('Google returned an incomplete sign-in session. Please try again.');
      const { data, error } = await supabaseClient.auth.setSession({
        access_token: fragmentAccessToken,
        refresh_token: fragmentRefreshToken,
      });
      if (error) throw error;
      session = data.session;
    } else {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      session = data.session;
    }
    if (!session) throw new Error('Google sign-in did not complete. Please try again.');
    if (resetCallback) {
      recoverySession = true;
      const callbackEmail = session.user?.email || '';
      const matchingPending = pendingReset?.email?.toLowerCase() === callbackEmail.toLowerCase() ? pendingReset : {};
      localStorage.setItem(RESET_PENDING_KEY, JSON.stringify({
        ...matchingPending,
        email: callbackEmail || matchingPending.email || '',
        role: matchingPending.role || 'customer',
      }));
      $('#auth').classList.add('hide'); $('#land').classList.add('hide'); $('#learn').classList.add('hide');
      $('#passwordResetRequestPage').classList.add('hide');
      $('#passwordResetPage').classList.remove('hide');
      $('#resetPasswordMsg').textContent = '';
      $('#newPassword').focus();
      return true;
    }
    let details = {};
    try { details = JSON.parse(localStorage.getItem(GOOGLE_PENDING_KEY) || '{}'); }
    catch { /* handled below as a missing or invalid sign-in state */ }
    if (!['customer', 'helper'].includes(details.role) || !['login', 'signup'].includes(details.mode)) {
      throw new Error('Your Google sign-in details expired. Choose your account type and try again.');
    }
    const result = await request('/auth/google', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(details),
    });
    localStorage.removeItem(GOOGLE_PENDING_KEY);
    storeToken(result.token);
    applyUser(result.user);
    await refreshHelpers();
    go('home');
    return true;
  }

  $('#googleAuth').onclick = continueWithGoogle;

  function showPasswordResetRequest() {
    $('#aErr').textContent = '';
    $('#resetRequestMsg').textContent = '';
    $('#resetEmail').value = $('#em').value.trim();
    $('#auth').classList.add('hide'); $('#land').classList.add('hide'); $('#learn').classList.add('hide');
    $('#passwordResetPage').classList.add('hide');
    $('#passwordResetRequestPage').classList.remove('hide');
    $('#resetEmail').focus();
  }

  $('#fg').onclick = event => { event.preventDefault(); showPasswordResetRequest(); };
  $('#backToLogin').onclick = event => {
    event.preventDefault();
    $('#passwordResetRequestPage').classList.add('hide');
    $('#passwordResetPage').classList.add('hide');
    showAuth('login', S.role);
    $('#em').value = $('#resetEmail').value.trim();
  };

  $('#sendResetEmail').onclick = async () => {
    const button = $('#sendResetEmail');
    const email = $('#resetEmail').value.trim();
    const message = $('#resetRequestMsg');
    message.style.color = '#A3B3CC';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      message.style.color = '#FF8A80';
      message.textContent = 'Enter a valid email address.';
      return;
    }
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const config = await request('/auth/config');
      if (!window.supabase) throw new Error('The password reset service could not be loaded. Refresh the page and try again.');
      supabaseClient = createSupabaseClient(config);
      const pending = { email, username: $('#u').value.trim(), role: S.role, timestamp: Date.now() };
      localStorage.setItem(RESET_PENDING_KEY, JSON.stringify(pending));
      const redirectTo = window.location.origin + window.location.pathname;
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      message.style.color = '#A3B3CC';
      message.textContent = 'If an account exists for that email, a password reset link has been sent. Check your inbox.';
    } catch (err) {
      localStorage.removeItem(RESET_PENDING_KEY);
      message.style.color = '#FF8A80';
      message.textContent = err.message || 'Could not send the reset email. Please try again.';
    } finally {
      button.disabled = false;
      button.textContent = 'Send reset link';
    }
  };

  $('#saveNewPassword').onclick = async () => {
    const password = $('#newPassword').value;
    const confirmation = $('#confirmPassword').value;
    const message = $('#resetPasswordMsg');
    message.textContent = '';
    if (password.length < 10 || password.length > 128) { message.textContent = 'Your password must contain 10 to 128 characters.'; return; }
    if (password !== confirmation) { message.textContent = 'The passwords do not match.'; return; }
    if (!recoverySession || !supabaseClient) { message.textContent = 'This reset session is no longer valid. Request a new reset link.'; return; }
    const button = $('#saveNewPassword');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const { error } = await supabaseClient.auth.updateUser({ password });
      if (error) throw error;
      const { data: recovery, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (!recovery.session?.access_token) throw new Error('The password changed, but its session could not be verified. Sign in again and contact support if this keeps happening.');
      await request('/auth/password-reset-complete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${recovery.session.access_token}` },
        body: '{}',
      });
      let pending = {};
      try { pending = JSON.parse(localStorage.getItem(RESET_PENDING_KEY) || '{}'); } catch { /* ignore invalid local state */ }
      localStorage.removeItem(RESET_PENDING_KEY);
      recoverySession = false;
      await supabaseClient.auth.signOut().catch(() => {});
      $('#passwordResetPage').classList.add('hide');
      showAuth('login', pending.role || S.role || 'customer');
      $('#u').value = pending.username || '';
      $('#em').value = pending.email || '';
      $('#pw').value = '';
      $('#aErr').style.color = '#A3B3CC';
      $('#aErr').textContent = 'Password reset successfully. Sign in with your new password.';
    } catch (err) {
      message.textContent = err.message || 'Could not update your password. Request a new reset link and try again.';
    } finally {
      button.disabled = false;
      button.textContent = 'Save new password';
    }
  };

  async function refreshHelpers() {
    try { helpers = await request('/helpers'); }
    catch (err) { console.warn('House Assist API is not available:', err.message); }
  }
  async function refreshGuide() {
    try {
      const rows = await request('/guide');
      const max = Math.max(1, ...rows.map(row => row.high));
      H($('#lp'), rows.length ? rows.map(row => `<div class="row"><span class="stars">${stars(row.stars)}</span><div class="track"><div class="fill" style="left:${row.low / max * 100}%;width:${Math.max((row.high - row.low) / max * 100, 2)}%"></div></div><b>GH₵ ${row.low}${row.high > row.low ? ' – ' + row.high : ''}</b></div>`).join('') : '<p class="mut">Price ranges will appear as house helps join.</p>');
    } catch (err) { console.warn('Could not load price guide:', err.message); }
  }
  const applyUser = user => {
    S.user = { ...user, id: user.id, name: user.name, loc: user.loc };
    S.role = user.role;
    $('#who').textContent = `${user.name} · ${user.role === 'helper' ? 'House help' : 'Customer'}`;
    $('#auth').classList.add('hide'); $('#land').classList.add('hide'); $('#app').classList.remove('hide');
  };
  const applyBranding = brand => {
    if (!brand) return;
    S.site = brand.name;
    document.querySelectorAll('.sn').forEach(x => x.textContent = brand.name);
    document.querySelectorAll('.ha-brand b, .auth-brand b').forEach(x => x.textContent = brand.name.toUpperCase());
    document.querySelectorAll('.mark, .ha-mark, .auth-brand-mark').forEach(x => x.textContent = brand.mark);
    document.title = brand.name;
    document.querySelector('link[rel="icon"]')?.remove();
    const icon = document.createElement('link'); icon.rel = 'icon';
    icon.href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${brand.favicon || '🏠'}</text></svg>`)}`;
    document.head.append(icon);
  };

  $('#cs').onclick = async () => {
    const button = $('#cs');
    if (button.disabled) return;
    button.disabled = true;
    try {
      await request('/contact', { method: 'POST', body: JSON.stringify({
        name: $('#cn').value.trim(), email: $('#ce').value.trim(), message: $('#cm').value.trim(),
      }) });
      $('#cm').value = '';
      toast('Your message was sent to House Assist.');
    } catch (err) { showError(err); }
    finally { button.disabled = false; }
  };

  $('#go').onclick = async () => {
    $('#em').readOnly = false;
    const username = $('#u').value.trim(), email = $('#em').value.trim(), password = $('#pw').value;
    const signup = S.mode === 'signup';
    $('#aErr').style.color = '#FF8A80';
    $('#aErr').textContent = '';
    if (!username) return reportError($('#aErr'), new Error('Enter your username.'));
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reportError($('#aErr'), new Error('Enter a valid email address.'));
    if (signup && (password.length < 10 || password.length > 128)) return reportError($('#aErr'), new Error('Password must contain 10 to 128 characters.'));
    if (!signup && (!password || password.length > 128)) return reportError($('#aErr'), new Error('Enter a password of 1 to 128 characters.'));
    const details = { username, email, password, role: S.role };
    if (signup) {
      details.location = $('#loc').value.trim();
      if (S.role === 'helper') {
        details.services = [...document.querySelectorAll('#svcBox input:checked')].map(input => input.value);
        details.service = details.services[0];
        details.price = Number($('#pr').value);
      }
    }
    try {
      const result = await request(signup ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(details) });
      localStorage.removeItem(RESET_PENDING_KEY);
      storeToken(result.token); applyUser(result.user); await refreshHelpers();
      const me = await request('/me');
      S.lay = me.layout || 'grid'; S.dense = Boolean(me.compact);
      S.theme = me.theme || 'Ocean';
      if (THEMES[S.theme]) setTheme(THEMES[S.theme]);
      (me.colors || []).forEach((value, i) => document.documentElement.style.setProperty(['--bg', '--sf', '--ink', '--ac'][i], value));
      document.body.classList.toggle('dense', S.dense);
      go('home');
    } catch (err) { reportError($('#aErr'), err); }
  };

  // Revoke the server session before leaving the dashboard.
  document.addEventListener('click', async e => {
    if (!e.target.closest('#drawer [data-k="out"]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const old = token;
    storeToken('');
    if (old) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try { await fetch(API + '/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${old}` }, signal: controller.signal }); }
      catch { /* The local session is already cleared; continue if the API is offline. */ }
      finally { clearTimeout(timeout); }
    }
    window.location.assign('/');
  }, true);

  const originalHome = home;
  home = function () {
    originalHome();
    if (S.role === 'helper') loadIncomingHires();
  };
  async function loadIncomingHires() {
    try {
      const hires = await request('/helper/hires');
      const box = document.createElement('section');
      box.className = 'helper-requests dash-section';
      box.innerHTML = `<h2 style="margin-top:28px">Hire requests</h2><p class="sub">Confirm receipt after you have received payment.</p><div class="grid">${hires.map(h => `<div class="card"><b>${safeHtml(h.customer)}</b><div class="mut">${safeHtml(h.location)} · GH₵ ${Number(h.price)||0}/day</div><div class="mut" style="margin:8px 0">${h.customer_paid ? 'Customer marked payment as sent' : 'Waiting for customer payment confirmation'} · ${safeHtml(h.payment_method)}</div>${h.customer_paid && !h.helper_received ? `<button class="btn" data-received="${Number(h.id)}">Confirm received</button>` : h.helper_received ? '<span class="pill">Confirmed</span>' : ''}</div>`).join('') || '<p class="mut">No hire requests yet.</p>'}</div>`;
      $('#view').append(box);
      box.onclick = async e => {
        const button = e.target.closest('[data-received]'); if (!button) return;
        button.disabled = true;
        try { await request(`/hires/${button.dataset.received}/received`, { method: 'PATCH', body: '{}' }); toast('Receipt confirmed'); home(); }
        catch (err) { button.disabled = false; showError(err); }
      };
    } catch (err) { if (err.message !== 'Please log in to continue.') showError(err); }
  }

  let messageRefreshTimer = null;
  let messageRenderRun = 0;
  const messageTime = value => new Date(Number(value) * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  openChat = async function (helper) {
    try {
      const thread = await request('/threads', { method: 'POST', body: JSON.stringify({ helper_id: helper.id }) });
      S.chat = thread.id;
      go('messages');
    } catch (err) { showError(err); }
  };
  messages = async function () {
    clearTimeout(messageRefreshTimer);
    const run = ++messageRenderRun;
    const root = $('#view');
    const previousConversation = root.querySelector('#persistentMessages');
    const previousThread = Number(previousConversation?.dataset.thread || 0);
    const previousScrollTop = previousConversation?.scrollTop || 0;
    const wasAtBottom = previousConversation && previousConversation.scrollHeight - previousScrollTop - previousConversation.clientHeight < 48;
    root.innerHTML = '<h2>Messages</h2><p class="sub">Your conversations with House Assist customers and house helps.</p><div class="card" role="status">Loading conversations…</div>';
    try {
      const threads = await request('/threads');
      if (run !== messageRenderRun || S.view !== 'messages') return;
      let selected = threads.find(thread => Number(thread.id) === Number(S.chat));
      if (!selected && threads.length) { selected = threads[0]; S.chat = selected.id; }
      const items = selected ? await request(`/threads/${selected.id}/messages`) : [];
      if (run !== messageRenderRun || S.view !== 'messages') return;
      root.innerHTML = `<h2>Messages</h2><p class="sub">Your conversations with House Assist customers and house helps.</p>
        <div class="chat ${selected ? 'open' : ''}"><aside class="cl">${threads.length ? threads.map((thread,index) => `<button type="button" class="crow ${selected && Number(thread.id)===Number(selected.id) ? 'on' : ''}" data-thread="${Number(thread.id)}"><span class="av" style="background:${['#d8eaf0','#b9d9e2','#eaf4f6','#a6cbd7'][index%4]};width:44px;height:44px;font-size:16px;flex:none">${safeHtml(String(thread.peer_name||'?').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase())}</span><span><b>${safeHtml(thread.peer_name)}</b><small>${safeHtml(thread.last_message)}</small></span></button>`).join('') : '<p class="mut" style="padding:20px">No conversations yet. Open a house help profile and choose Text to start one.</p>'}</aside>
        <section class="ct">${selected ? `<div class="cth"><span class="av" style="background:#d8eaf0;width:42px;height:42px;font-size:15px">${safeHtml(String(selected.peer_name||'?').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase())}</span><b>${safeHtml(selected.peer_name)}</b></div>
          <div class="ms" id="persistentMessages" data-thread="${Number(selected.id)}">${items.length ? items.map(item => `<div class="bub ${item.mine?'me':'them'}">${safeHtml(item.body)}<small>${safeHtml(messageTime(item.created_at))}</small></div>`).join('') : `<div class="empty">Say hello to ${safeHtml(String(selected.peer_name||'your contact').split(' ')[0])}.</div>`}</div>
          <form class="cmp" id="messageCompose"><input id="messageInput" maxlength="2000" placeholder="Type a message" autocomplete="off" aria-label="Message"><button type="submit" class="btn">Send</button></form>` : '<div class="empty">Select a conversation or open a house help profile to start one.</div>'}</section></div>`;
      const list = root.querySelector('.cl');
      if (list) list.onclick = event => {
        const button = event.target.closest('[data-thread]');
        if (!button) return;
        S.chat = Number(button.dataset.thread);
        messages();
      };
      const conversation = root.querySelector('#persistentMessages');
      if (conversation) {
        if (previousThread === Number(conversation.dataset.thread) && !wasAtBottom) conversation.scrollTop = previousScrollTop;
        else conversation.scrollTop = conversation.scrollHeight;
      }
      const form = root.querySelector('#messageCompose');
      if (form) form.onsubmit = async event => {
        event.preventDefault();
        const input = root.querySelector('#messageInput');
        const button = form.querySelector('button');
        const text = input.value.trim();
        if (!text || button.disabled) return;
        button.disabled = true;
        try {
          await request(`/threads/${selected.id}/messages`, { method: 'POST', body: JSON.stringify({ body: text }) });
          await messages();
        } catch (err) { showError(err); button.disabled = false; }
      };
      messageRefreshTimer = setTimeout(() => { if (S.view === 'messages') messages(); }, 15000);
    } catch (err) {
      if (run === messageRenderRun) root.innerHTML = `<h2>Messages</h2><p class="card" role="alert">${safeHtml(err.message||'Messages could not be loaded.')}</p><button class="btn" id="retryMessages">Retry</button>`;
      root.querySelector('#retryMessages')?.addEventListener('click', messages, { once: true });
    }
  };

  hired = async function () {
    try {
      const items = await request('/hires');
      S.hired = items.filter(x => x.helper_received).map(x => x.helper);
    } catch (err) { S.hired = []; }
    H($('#view'), `<h2>Hired before</h2><p class="sub">House helps you have worked with.</p><div class="grid">${S.hired.map(card(true)).join('') || '<p class="mut">You haven’t hired anyone yet. Browse house helps to get started.</p>'}</div>`);
  };

  let activeHireId = null;
  hire = function (helper) { P = { h: helper, m: '', b: '', cp: 0, hp: 0 }; activeHireId = null; pay(); };
  pay = function () {
    const { h, m, b } = P;
    const banks = ['GCB Bank', 'Ecobank Ghana', 'Stanbic Bank', 'Absa Ghana', 'Fidelity Bank'];
    const networks = ['MTN MoMo', 'Telecel Cash', 'AT Money'];
    let content = `<h3 style="font-size:24px">Hire ${safeHtml(h.n)}</h3><p class="mut">GH₵ ${Number(h.p)||0} per day · call ${safeHtml(h.ph||'the house help')} to agree the details.</p><label>How will you pay?</label><button class="opt ${m === 'cash' ? 'on' : ''}" data-method="cash">Cash</button><button class="opt ${m === 'bank' ? 'on' : ''}" data-method="bank">Bank payment</button><button class="opt ${m === 'momo' ? 'on' : ''}" data-method="momo">Mobile money</button>`;
    if (m === 'bank') content += `<label>Choose your bank<select id="payDetail">${banks.map(x => `<option ${b === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`;
    if (m === 'momo') content += `<label>Choose a network<select id="payDetail">${networks.map(x => `<option ${b === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`;
    if (m) content += `<div class="step"><span class="dot ${P.cp ? 'ok' : ''}">${P.cp ? '✓' : ''}</span>You confirm you have paid</div><div class="step"><span class="dot ${P.hp ? 'ok' : ''}">${P.hp ? '✓' : ''}</span>${safeHtml(h.n.split(' ')[0])} confirms they received it</div>${P.cp && P.hp ? '<button class="btn" id="rateHire" style="width:100%">Rate & recommend</button>' : `<button class="btn" id="paid" style="width:100%" ${P.cp ? 'disabled' : ''}>I have paid</button>`}<p class="mut" style="font-size:13px;margin-bottom:0">This records confirmations only; it does not process or verify a payment.</p>`;
    modal(content + '<button class="btn alt" style="width:100%;margin-top:12px" id="cl">Close</button>');
    $('#cl').onclick = () => modal(0);
    document.querySelectorAll('[data-method]').forEach(button => button.onclick = () => { if (!P.cp) { P.m = button.dataset.method; P.b = ''; pay(); } });
    if ($('#payDetail')) { $('#payDetail').onchange = e => P.b = e.target.value; enh($('#modal')); P.b = $('#payDetail').value; }
    if ($('#paid')) $('#paid').onclick = async () => {
      const select = $('#payDetail'); if (select) P.b = select.value;
      const button = $('#paid'); button.disabled = true;
      try {
        const hireResult = await request('/hires', { method: 'POST', body: JSON.stringify({ helper_id: h.id, payment_method: P.m, payment_detail: P.b }) });
        activeHireId = hireResult.id;
        await request(`/hires/${activeHireId}/payment`, { method: 'PATCH', body: '{}' });
        P.cp = 1; toast('Payment marked as done. The house help can confirm receipt from their account.'); pay();
      } catch (err) { button.disabled = false; showError(err); }
    };
    if ($('#rateHire')) $('#rateHire').onclick = rate;
  };
  rate = function () {
    let stars = 0;
    modal(`<h3 style="font-size:24px">How was ${safeHtml(P.h.n.split(' ')[0])}?</h3><p class="mut">Give a rating, a recommendation, or both.</p><div class="rate" id="rs">${[1,2,3,4,5].map(i => `<span data-i="${i}">★</span>`).join('')}</div><label>Recommendation (optional)<input id="rv" placeholder="What went well?"></label><button class="btn" id="sb" style="width:100%">Submit</button>`);
    $('#rs').onclick = e => { if (e.target.dataset.i) { stars = Number(e.target.dataset.i); document.querySelectorAll('#rs span').forEach((s, i) => s.classList.toggle('on', i < stars)); } };
    $('#sb').onclick = async () => {
      const recommendation = $('#rv').value.trim();
      if (!stars && !recommendation) return toast('Add a rating or a recommendation first');
      try { await request(`/hires/${activeHireId}/rating`, { method: 'POST', body: JSON.stringify({ stars: stars || null, recommendation }) }); modal(0); toast('Thanks, your feedback is saved'); await refreshHelpers(); }
      catch (err) { showError(err); }
    };
  };

  const originalProfile = profile;
  const saveProfilePatch = async (button, payload, successMessage) => {
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      const updated = await request('/me', { method: 'PATCH', body: JSON.stringify(payload) });
      S.user = { ...S.user, ...updated };
      $('#who').textContent = `${S.user.name} · ${S.role === 'helper' ? 'House help' : 'Customer'}`;
      if (payload.password) $('#profilePassword').value = '';
      await refreshHelpers();
      toast(successMessage);
    } catch (err) { showError(err); }
    finally { button.disabled = false; }
  };
  profile = function () {
    originalProfile();
    const profileSave = $('#psave');
    if (profileSave) profileSave.onclick = () => saveProfilePatch(profileSave, {
      bio: $('#pb').value.trim(),
      ...(S.role === 'helper' ? {
        phone: $('#pph').value.trim(),
        experience: $('#px').value.trim(),
        availability: $('#pav').value.trim(),
        languages: $('#plg').value.trim(),
        price: Number($('#ppr').value),
      } : {}),
      theme: S.theme || 'Ocean', layout: S.lay, compact: S.dense,
      colors: [...$('#view').querySelectorAll('[data-c]')].map(x => x.value),
    }, 'Profile saved');
    const accountSave = $('#saveAccountDetails');
    if (accountSave) accountSave.onclick = () => saveProfilePatch(accountSave, {
      username: $('#profileUsername').value.trim(),
      location: $('#profileLocation').value.trim(),
      password: $('#profilePassword').value,
    }, 'Account details saved');
    $('#view').querySelectorAll('[data-t]').forEach(button => button.onclick = async () => {
      S.theme = button.dataset.t; setTheme(THEMES[S.theme]); profile();
      try { await request('/me', { method: 'PATCH', body: JSON.stringify({ theme: S.theme, layout: S.lay, compact: S.dense, colors: [] }) }); } catch (err) { showError(err); }
    });
    $('#view').querySelectorAll('[data-c]').forEach(input => input.onchange = async () => {
      const custom = [...$('#view').querySelectorAll('[data-c]')].map(x => x.value);
      custom.forEach((value, i) => document.documentElement.style.setProperty(['--bg', '--sf', '--ink', '--ac'][i], value));
      try { await request('/me', { method: 'PATCH', body: JSON.stringify({ theme: 'Custom', layout: S.lay, compact: S.dense, colors: custom }) }); } catch (err) { showError(err); }
    });
    $('#lay').onclick = async e => { if (e.target.dataset.l) { S.lay = e.target.dataset.l; profile(); try { await request('/me', { method: 'PATCH', body: JSON.stringify({ layout: S.lay, compact: S.dense }) }); } catch (err) { showError(err); } } };
    $('#den').onclick = async e => { if (e.target.dataset.d) { S.dense = e.target.dataset.d === '1'; document.body.classList.toggle('dense', S.dense); profile(); try { await request('/me', { method: 'PATCH', body: JSON.stringify({ layout: S.lay, compact: S.dense }) }); } catch (err) { showError(err); } } };
  };

  const showAdminPanel = async () => {
    $('#adminLogin').classList.add('hide');
    $('#adminPanel').classList.remove('hide');
    $('#adminPanelError').classList.add('hide');
    $('#adminPanelErrorText').textContent = '';
    await renderAdminSection(adminSection);
  };
  let adminLoginBusy = false;
  if (isAdminPath) {
    const authenticateAdmin = async event => {
      event.preventDefault();
      if (adminLoginBusy) return;
      adminLoginBusy = true;
      const button = $('#adminLoginButton');
      const message = $('#adminLoginError');
      message.textContent = '';
      button.disabled = true;
      try {
        const result = await request('/admin/session', {
          method: 'POST',
          body: JSON.stringify({ pin: $('#adminPassword').value }),
        });
        storeToken(result.token);
        await showAdminPanel();
      } catch (err) {
        message.textContent = err.message || 'Admin sign-in failed.';
      } finally {
        adminLoginBusy = false;
        button.disabled = false;
      }
    };
    $('#adminLoginForm').onsubmit = authenticateAdmin;
    $('#adminLoginButton').onclick = authenticateAdmin;
    $('#adminLogout').onclick = async () => {
      const old = token;
      storeToken('');
      if (old) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        try { await fetch(API + '/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${old}` }, signal: controller.signal }); }
        catch { /* The browser-side admin session is cleared either way. */ }
        finally { clearTimeout(timeout); }
      }
      $('#adminPanel').classList.add('hide');
      $('#adminLogin').classList.remove('hide');
      $('#adminPassword').value = '';
      $('#adminPassword').focus();
    };
    $('#retryAdminLoad').onclick = admin;
  }
  const adminRoot = () => isAdminPath ? $('#adminContent') : $('#view');
  admin = async function () {
    if (!isAdminPath) {
      window.location.assign('/admin.');
      return;
    }
    try {
      const data = await request('/admin/summary');
      $('#adminPanelError').classList.add('hide');
      $('#adminPanelErrorText').textContent = '';
      H(adminRoot(), `<h2>Admin centre</h2><p class="sub">Monitor registrations, hires and the platform brand.</p><div class="stats"><div class="card"><span class="price">${Number(data.hires)||0}</span><span class="mut">Hires recorded</span></div><div class="card"><span class="price">${Number(data.helpers)||0}</span><span class="mut">House helps</span></div><div class="card"><span class="price">${Number(data.customers)||0}</span><span class="mut">Customers</span></div></div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))"><div class="card"><h3>Recent registrations</h3>${data.users.map(u => `<div class="step"><span class="dot ok">!</span>${safeHtml(u.username)} · ${safeHtml(u.role)}</div>`).join('') || '<p class="mut">No registrations yet.</p>'}<h3 style="margin-top:16px">Add a user</h3><input id="nu" placeholder="Username"><input id="ne" type="email" placeholder="Customer email"><input id="np" type="password" minlength="10" maxlength="128" placeholder="Temporary password"><button class="btn" id="au">Add a user</button></div><div class="card"><h3>Branding</h3><label>Site name<input id="sn" value="${safeHtml(data.branding.name)}"></label><label>Logo letter or emoji<input id="lg" value="${safeHtml(data.branding.mark)}" maxlength="2"></label><label>Favicon emoji<input id="fv" value="${safeHtml(data.branding.favicon)}" maxlength="2"></label><button class="btn" id="sv2">Apply branding</button></div></div>`);
      $('#au').onclick = async () => { try { await request('/admin/users', { method: 'POST', body: JSON.stringify({ username: $('#nu').value, email: $('#ne').value, password: $('#np').value }) }); toast('User added'); admin(); } catch (err) { showError(err); } };
      $('#sv2').onclick = async () => { try { const brand = await request('/admin/branding', { method: 'PATCH', body: JSON.stringify({ name: $('#sn').value, mark: $('#lg').value, favicon: $('#fv').value }) }); applyBranding(brand); toast('Branding saved'); } catch (err) { showError(err); } };
    } catch (err) {
      $('#adminPanelErrorText').textContent = err.message || 'The administrator dashboard could not be loaded.';
      $('#adminPanelError').classList.remove('hide');
      if (err.status === 401 || err.status === 403) {
        storeToken('');
        $('#adminPanel').classList.add('hide');
        $('#adminLogin').classList.remove('hide');
        $('#adminLoginError').textContent = 'Your admin session was rejected. Enter the password again.';
      }
    }
  };

  let adminSection = 'overview';
  const adminEscape = value => safeHtml(value);
  const adminDate = value => value ? new Date(Number(value) * 1000).toLocaleString() : '—';
  const adminSections = [['overview','Overview'],['users','Accounts'],['helpers','House helps'],['hires','Hires'],['ratings','Feedback'],['contact','Contact inbox'],['settings','Settings']];
  const adminRequest = async (path, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try { return await request(path, { ...options, signal: controller.signal }); }
    catch (err) {
      if (err.name === 'AbortError') throw new Error('The admin API did not respond within 15 seconds. Check the server connection, then retry.');
      throw err;
    } finally { clearTimeout(timer); }
  };
  const renderAdminSection = async section => {
    adminSection = section;
    const root = adminRoot();
    const nav = `<h2>Admin centre</h2><p class="sub">Manage House Assist accounts, listings, hires, feedback, and site settings.</p><nav class="admin-nav" aria-label="Admin sections">${adminSections.map(([key,label]) => `<button type="button" class="btn ${section === key ? '' : 'alt'}" data-admin-section="${key}">${label}</button>`).join('')}</nav>`;
    root.innerHTML = `${nav}<section class="card admin-loading"><span class="price">Loading ${adminEscape(adminSections.find(([key]) => key === section)?.[1] || 'dashboard')}…</span><p class="mut">Connecting to House Assist data.</p></section>`;
    root.querySelectorAll('[data-admin-section]').forEach(b => b.onclick = () => renderAdminSection(b.dataset.adminSection));
    try {
      let content = '';
      if (section === 'overview') {
        const d = await adminRequest('/admin/summary');
        content = `<div class="admin-stats">${[['customers','Customers'],['helpers','House helps'],['hires','Total hires'],['pending_hires','Open hires'],['completed_hires','Completed hires'],['average_rating','Average rating']].map(([key,label]) => `<article class="card"><span class="price">${d[key]}</span><span class="mut">${label}${key==='average_rating'?` (${d.ratings} ratings)`:''}</span></article>`).join('')}</div><div class="card"><h3>Latest account registrations</h3><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Type</th><th>Location</th><th>Joined</th></tr></thead><tbody>${d.users.map(u => `<tr><td>${adminEscape(u.username)}</td><td>${adminEscape(u.role)}</td><td>${adminEscape(u.location)}</td><td>${adminDate(u.created_at)}</td></tr>`).join('')||'<tr><td colspan="4">No accounts yet.</td></tr>'}</tbody></table></div></div>`;
      } else if (section === 'users') {
        const q = root.querySelector('#adminSearch')?.value || '';
        const rows = await adminRequest(`/admin/users?q=${encodeURIComponent(q)}`);
        content = `<div class="card"><div class="admin-toolbar"><div><h3>Accounts</h3><p class="mut">Customers and house helps registered on House Assist.</p></div><form id="adminSearchForm" class="admin-search"><input id="adminSearch" placeholder="Search name, email, or location" value="${adminEscape(q)}"><button class="btn alt" type="button">Search</button></form></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Location</th><th>Joined</th></tr></thead><tbody>${rows.map(u => `<tr><td>${adminEscape(u.username)}</td><td>${adminEscape(u.email||'—')}</td><td>${adminEscape(u.role)}</td><td>${adminEscape(u.location)}</td><td>${adminDate(u.created_at)}</td></tr>`).join('')||'<tr><td colspan="5">No matching accounts.</td></tr>'}</tbody></table></div></div><div class="card admin-add-user"><h3>Create a customer account</h3><p class="mut">Creates an account through Supabase Auth. Share the temporary password securely.</p><div class="admin-form-row"><label>Username<input id="nu" placeholder="Customer username" maxlength="40"></label><label>Email<input id="ne" type="email" placeholder="Customer email" autocomplete="email"></label><label>Temporary password<input id="np" type="password" minlength="10" maxlength="128" placeholder="At least 10 characters"></label><button class="btn" id="au" type="button">Create account</button></div></div>`;
      } else if (section === 'helpers') {
        const q = root.querySelector('#adminSearch')?.value || '';
        const rows = await adminRequest(`/admin/helpers?q=${encodeURIComponent(q)}`);
        const services = ['House Cleaning','Plumbing','Electrical','Mason','Painting','Repairs','Gardening','Lawn Care','Laundry','Ironing','Cooking','Kitchen Assist','Moving','Packing','Elderly Care','Child Care'];
        content = `<div class="card"><div class="admin-toolbar"><div><h3>House help listings</h3><p class="mut">Edit listing details customers see when choosing a helper.</p></div><form id="adminSearchForm" class="admin-search"><input id="adminSearch" placeholder="Search name, email, or location" value="${adminEscape(q)}"><button class="btn alt" type="button">Search</button></form></div><div class="admin-record-list">${rows.map(h => `<form class="admin-record-card" data-helper-id="${h.id}"><div class="admin-record-heading"><div><h3>${adminEscape(h.name)}</h3><span class="mut">${adminEscape(h.email||'No email linked')} · ${Number(h.rating||0).toFixed(1)} stars (${h.rating_count} ratings)</span></div><button class="btn" type="button">Save listing</button></div><div class="admin-form-row"><label>Name<input name="name" value="${adminEscape(h.name)}" required maxlength="80"></label><label>Location<input name="location" value="${adminEscape(h.location)}" required maxlength="120"></label><label>Daily price (GH₵)<input name="price" type="number" min="1" step="1" value="${h.price}" required></label><label>Phone<input name="phone" value="${adminEscape(h.phone)}" maxlength="40"></label></div><fieldset class="admin-services"><legend>Services</legend>${services.map(s => `<label><input type="checkbox" name="services" value="${adminEscape(s)}" ${h.services.includes(s)?'checked':''}>${adminEscape(s)}</label>`).join('')}</fieldset></form>`).join('')||'<p class="mut">No matching listings.</p>'}</div></div>`;
      } else if (section === 'hires') {
        const q = root.querySelector('#adminSearch')?.value || '';
        const rows = await adminRequest(`/admin/hires?q=${encodeURIComponent(q)}`);
        content = `<div class="card"><div class="admin-toolbar"><div><h3>Hire activity</h3><p class="mut">Track payment and service confirmation. Payment details are hidden for privacy.</p></div><form id="adminSearchForm" class="admin-search"><input id="adminSearch" placeholder="Search customer or house help" value="${adminEscape(q)}"><button class="btn alt" type="button">Search</button></form></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Hire</th><th>Customer</th><th>House help</th><th>Method</th><th>Status</th><th>Created</th></tr></thead><tbody>${rows.map(h => `<tr><td>#${h.id}</td><td>${adminEscape(h.customer_name)}<br><span class="mut">${adminEscape(h.customer_email||'')}</span></td><td>${adminEscape(h.helper_name)}<br><span class="mut">${adminEscape(h.helper_location)} · GH₵ ${h.price}/day</span></td><td>${adminEscape(h.payment_method)}</td><td>${!h.customer_paid?'Awaiting customer confirmation':!h.helper_received?'Awaiting helper confirmation':'Completed'}</td><td>${adminDate(h.created_at)}</td></tr>`).join('')||'<tr><td colspan="6">No matching hires.</td></tr>'}</tbody></table></div></div>`;
      } else if (section === 'ratings') {
        const rows = await adminRequest('/admin/ratings');
        content = `<div class="card"><h3>Customer feedback</h3><p class="mut">Feedback stays linked to its completed hire record.</p><div class="admin-record-list">${rows.map(r => `<article class="admin-feedback"><div class="admin-record-heading"><div><strong>${adminEscape(r.customer_name)}</strong><span class="mut"> reviewed ${adminEscape(r.helper_name)} · hire #${r.hire_id}</span></div><span>${r.stars?`${r.stars} / 5`:'Written feedback'}</span></div><p>${adminEscape(r.recommendation||'No written recommendation.')}</p><span class="mut">${adminDate(r.created_at)}</span></article>`).join('')||'<p class="mut">No feedback has been submitted.</p>'}</div></div>`;
      } else if (section === 'contact') {
        const rows = await adminRequest('/admin/contact');
        content = `<div class="card"><div class="admin-toolbar"><div><h3>Contact inbox</h3><p class="mut">Messages submitted through the public contact form. Reply to people by email when they provide one.</p></div><span class="pill">${rows.filter(row => !row.read_at).length} unread</span></div><div class="admin-record-list">${rows.map(row => `<article class="admin-feedback"><div class="admin-record-heading"><div><strong>${adminEscape(row.name)}</strong>${row.email ? ` · <a href="mailto:${encodeURIComponent(row.email)}">${adminEscape(row.email)}</a>` : ' · No email supplied'}</div><span>${row.read_at ? 'Read' : 'Unread'}</span></div><p>${adminEscape(row.body)}</p><div class="admin-record-heading"><span class="mut">${adminDate(row.created_at)}</span>${row.read_at ? '' : `<button type="button" class="btn alt" data-contact-read="${Number(row.id)}">Mark as read</button>`}</div></article>`).join('')||'<p class="mut">No messages have been received.</p>'}</div></div>`;
      } else {
        const d = await adminRequest('/admin/summary');
        content = `<div class="grid admin-settings-grid"><div class="card"><h3>Site branding</h3><p class="mut">These values appear on the site and its page icon.</p><label>Site name<input id="sn" value="${adminEscape(d.branding.name)}" maxlength="60"></label><label>Logo letter or emoji<input id="lg" value="${adminEscape(d.branding.mark)}" maxlength="2"></label><label>Favicon emoji<input id="fv" value="${adminEscape(d.branding.favicon)}" maxlength="2"></label><button class="btn" id="sv2" type="button">Save branding</button></div><div class="card"><h3>Admin session</h3><p class="mut">The server password protects this session, which expires after one hour.</p><button class="btn alt" id="adminLogoutSettings" type="button">Log out</button></div></div>`;
      }
      root.innerHTML = `${nav}<section class="admin-section">${content}</section>`;
      root.querySelectorAll('[data-admin-section]').forEach(b => b.onclick = () => renderAdminSection(b.dataset.adminSection));
      const search = root.querySelector('#adminSearchForm');
      if (search) { search.onsubmit = e => { e.preventDefault(); renderAdminSection(section); }; search.querySelector('button').onclick = () => renderAdminSection(section); }
      if (section === 'users') root.querySelector('#au').onclick = async () => { try { await request('/admin/users',{method:'POST',body:JSON.stringify({username:root.querySelector('#nu').value,email:root.querySelector('#ne').value,password:root.querySelector('#np').value})}); toast('Customer account created'); renderAdminSection('users'); } catch(err) { showError(err); } };
      if (section === 'contact') root.querySelectorAll('[data-contact-read]').forEach(button => button.onclick = async () => { button.disabled = true; try { await request(`/admin/contact/${Number(button.dataset.contactRead)}`, { method: 'PATCH', body: '{}' }); renderAdminSection('contact'); } catch (err) { button.disabled = false; showError(err); } });
      if (section === 'helpers') root.querySelectorAll('[data-helper-id]').forEach(form => form.querySelector('button').onclick = async e => { e.preventDefault(); if (!form.reportValidity()) return; const f=new FormData(form); try { await request(`/admin/helpers/${form.dataset.helperId}`,{method:'PATCH',body:JSON.stringify({name:f.get('name'),location:f.get('location'),price:Number(f.get('price')),phone:f.get('phone'),services:f.getAll('services')})}); toast('House help listing saved'); renderAdminSection('helpers'); } catch(err) { showError(err); } });
      if (section === 'settings') {
        root.querySelector('#sv2').onclick = async () => { try { const b=await request('/admin/branding',{method:'PATCH',body:JSON.stringify({name:root.querySelector('#sn').value,mark:root.querySelector('#lg').value,favicon:root.querySelector('#fv').value})}); applyBranding(b); toast('Branding saved'); } catch(err) { showError(err); } };
        root.querySelector('#adminLogoutSettings').onclick = () => $('#adminLogout').click();
      }
    } catch(err) {
      if (err.status===401||err.status===403) {
        storeToken('');
        $('#adminPanel').classList.add('hide');
        $('#adminLogin').classList.remove('hide');
        $('#adminLoginError').textContent='Your admin session was rejected. Enter the password again.';
        return;
      }
      root.innerHTML = `${nav}<section class="card"><h3>Could not load this section</h3><p class="mut">${adminEscape(err.message||'Please try again.')}</p><button class="btn" id="adminSectionRetry" type="button">Retry</button></section>`;
      root.querySelectorAll('[data-admin-section]').forEach(b=>b.onclick=()=>renderAdminSection(b.dataset.adminSection));
      root.querySelector('#adminSectionRetry').onclick=()=>renderAdminSection(section);
    }
  };
  window.houseAssistRenderAdminSection = (section, sessionToken) => {
    if (sessionToken) token = sessionToken;
    return renderAdminSection(section);
  };
  admin = async function() {
    if (!isAdminPath) { window.location.assign('/admin.'); return; }
    $('#adminPanelError').classList.add('hide');
    $('#adminPanelErrorText').textContent='';
    await renderAdminSection(adminSection);
  };
  $('#retryAdminLoad').onclick = admin;
  const authenticateAdminDirect = async event => {
    event.preventDefault();
    if (adminLoginBusy) return;
    adminLoginBusy = true;
    const button = $('#adminLoginButton');
    button.disabled = true;
    $('#adminLoginError').textContent = '';
    try {
      const result = await request('/admin/session', {
        method: 'POST',
        body: JSON.stringify({ pin: $('#adminPassword').value }),
      });
      storeToken(result.token);
      $('#adminLogin').classList.add('hide');
      $('#adminPanel').classList.remove('hide');
      $('#adminPanelError').classList.add('hide');
      await renderAdminSection('overview');
    } catch (err) {
      if ($('#adminPanel').classList.contains('hide')) {
        $('#adminLoginError').textContent = err.message || 'Admin sign-in failed.';
      } else {
        $('#adminPanelErrorText').textContent = err.message || 'The admin dashboard could not start.';
        $('#adminPanelError').classList.remove('hide');
      }
    } finally {
      adminLoginBusy = false;
      button.disabled = false;
    }
  };
  $('#adminLoginForm').onsubmit = authenticateAdminDirect;
  $('#adminLoginButton').onclick = authenticateAdminDirect;

  (async () => {
    if (isAdminPath) {
      $('#land').classList.add('hide');
      $('#learn').classList.add('hide');
      $('#auth').classList.add('hide');
      $('#app').classList.add('hide');
      $('#adminArea').classList.remove('hide');
      return;
    }
    await Promise.all([refreshHelpers(), refreshGuide()]);
    const oauthCallback = window.location.search.includes('code=') ||
      window.location.search.includes('error=') ||
      window.location.search.includes('error_description=') ||
      window.location.hash.includes('access_token');
    try {
      const googleHandled = await finishGoogleSignIn();
      if (googleHandled) return;
      const brand = await request('/branding').catch(() => null);
      applyBranding(brand);
      if (token) {
        const user = await request('/me');
        applyUser(user);
        S.lay = user.layout || 'grid'; S.dense = Boolean(user.compact); S.theme = user.theme || 'Ocean';
        if (THEMES[S.theme]) setTheme(THEMES[S.theme]);
        (user.colors || []).forEach((value, i) => document.documentElement.style.setProperty(['--bg', '--sf', '--ink', '--ac'][i], value));
        document.body.classList.toggle('dense', S.dense); go('home');
      }
    } catch (err) {
      if (oauthCallback) {
        let pendingReset = null;
        try { pendingReset = JSON.parse(localStorage.getItem(RESET_PENDING_KEY) || 'null'); } catch { /* ignore invalid local state */ }
        if (pendingReset || new URL(window.location.href).searchParams.get('type') === 'recovery') {
          localStorage.removeItem(RESET_PENDING_KEY);
          showAuth('login', pendingReset?.role || 'customer');
          $('#aErr').textContent = 'This password reset link is invalid or has expired. Request a new one.';
          console.warn('Password reset did not complete:', err.message);
          return;
        }
        let pending = {};
        try { pending = JSON.parse(localStorage.getItem(GOOGLE_PENDING_KEY) || '{}'); } catch { /* ignore invalid sign-in state */ }
        // The selected role is present for both signup and login. Restore the
        // actual mode saved before leaving for Google instead of treating every
        // callback as a signup (or silently falling back to login).
        showAuth(pending.mode || 'login', pending.role || 'customer');
        $('#aErr').textContent = err.message || 'Google sign-in could not be completed. Please try again.';
        console.warn('Google sign-in did not complete:', err.message);
        return;
      }
      storeToken('');
    }
  })();
})();
