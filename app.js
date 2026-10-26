/* Connects the existing House Assist screens to the API. */
(() => {
  const API = '/api';
  const TOKEN_KEY = 'house-assist-token';
  let token = localStorage.getItem(TOKEN_KEY) || '';
  const request = async (path, options = {}) => {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(API + path, { ...options, headers });
    const value = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      const requestError = new Error(value?.error || 'The request could not be completed.');
      requestError.code = value?.code;
      requestError.email = value?.email;
      throw requestError;
    }
    return value;
  };
  const reportError = (element, err) => { if (element) element.textContent = err.message; else toast(err.message); };
  const storeToken = value => { token = value || ''; if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); };
  const showError = err => toast(err.message);
  const GOOGLE_PENDING_KEY = 'house-assist-google-pending';
  let supabaseClient;
  let googleSession;

  const googleDetails = () => ({
    username: $('#u').value.trim(),
    role: S.role,
    location: $('#loc').value.trim(),
    services: [...document.querySelectorAll('#svcBox input:checked')].map(input => input.value),
    price: Number($('#pr').value),
  });

  async function continueWithGoogle() {
    const details = googleDetails();
    if (googleSession) return completeGoogleProfile();
    $('#em').readOnly = false;
    $('#googleAuth').textContent = 'Continue with Google';
    const signup = S.mode === 'signup';
    if (signup && !details.location) return reportError($('#aErr'), new Error('Select your region before continuing with Google.'));
    try {
      const config = await request('/auth/config');
      if (!window.supabase) throw new Error('The Google sign-in library could not be loaded.');
      supabaseClient = window.supabase.createClient(config.url, config.publishable_key);
      sessionStorage.setItem(GOOGLE_PENDING_KEY, JSON.stringify({ ...details, username: '', mode: S.mode }));
      const { error: oauthError } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
      if (oauthError) throw oauthError;
    } catch (err) { reportError($('#aErr'), err); }
  }

  async function completeGoogleProfile() {
    const details = googleDetails();
    if (!details.username) return reportError($('#aErr'), new Error('Enter a username to finish your Google signup.'));
    if (!details.location) return reportError($('#aErr'), new Error('Select your region before continuing.'));
    if (S.role === 'helper' && (!details.services.length || details.price < 1)) {
      return reportError($('#aErr'), new Error('Choose your services and add your daily price before continuing.'));
    }
    try {
      const result = await request('/auth/google', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + googleSession },
        body: JSON.stringify(details),
      });
      googleSession = null;
      sessionStorage.removeItem(GOOGLE_PENDING_KEY);
      storeToken(result.token);
      applyUser(result.user);
      await refreshHelpers();
      go('home');
    } catch (err) { reportError($('#aErr'), err); }
  }

  async function finishGoogleSignIn() {
    const callbackUrl = new URL(window.location.href);
    const callbackCode = callbackUrl.searchParams.get('code');
    const callbackError = callbackUrl.searchParams.get('error_description') || callbackUrl.searchParams.get('error');
    const oauthCallback = Boolean(callbackCode || callbackError || callbackUrl.hash.includes('access_token'));
    if (callbackError) {
      window.history.replaceState({}, document.title, window.location.pathname);
      throw new Error('Google sign-in was rejected by Supabase: ' + callbackError.replace(/\+/g, ' '));
    }
    if (!oauthCallback) return false;
    if (oauthCallback) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    const config = await request('/auth/config');
    if (!window.supabase) throw new Error('The Google sign-in library could not be loaded.');
    supabaseClient = window.supabase.createClient(config.url, config.publishable_key);
    let session;
    if (callbackCode) {
      const { data, error } = await supabaseClient.auth.exchangeCodeForSession(callbackCode);
      if (error) throw error;
      session = data.session;
    } else {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      session = data.session;
    }
    if (!session) throw new Error('Google sign-in did not complete. Please try again.');
    const details = JSON.parse(sessionStorage.getItem(GOOGLE_PENDING_KEY) || '{}');
    let result;
    try {
      result = await request('/auth/google', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(details),
      });
    } catch (err) {
      if (err.code !== 'PROFILE_REQUIRED') throw err;
      googleSession = session.access_token;
      if (details.mode === 'login') {
        throw new Error('No House Assist account exists for this Google account. Sign up first.');
      }
      showAuth('signup', details.role || 'customer');
      $('#u').value = '';
      $('#em').value = err.email || session.user.email || '';
      $('#em').readOnly = true;
      $('#loc').value = details.location || '';
      $('#loc + .dd button').textContent = details.location || 'Select your region';
      document.querySelectorAll('#svcBox input').forEach(input => {
        input.checked = details.services?.includes(input.value) || false;
      });
      $('#pr').value = details.price || '';
      $('#googleAuth').textContent = 'Complete Google signup';
      $('#aErr').textContent = `Google verified ${err.email || session.user.email}. Choose a username to finish creating your account.`;
      return true;
    }
    sessionStorage.removeItem(GOOGLE_PENDING_KEY);
    storeToken(result.token);
    applyUser(result.user);
    await refreshHelpers();
    go('home');
    return true;
  }

  $('#googleAuth').onclick = continueWithGoogle;

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
    S.user = { id: user.id, name: user.name, loc: user.loc };
    S.role = user.role;
    $('#who').textContent = `${user.name} · ${user.role === 'helper' ? 'House help' : 'Customer'}`;
    $('#auth').classList.add('hide'); $('#land').classList.add('hide'); $('#app').classList.remove('hide');
  };
  const applyBranding = brand => {
    if (!brand) return;
    S.site = brand.name;
    document.querySelectorAll('.sn').forEach(x => x.textContent = brand.name);
    document.querySelectorAll('.mark').forEach(x => x.textContent = brand.mark);
    document.title = brand.name;
    document.querySelector('link[rel="icon"]')?.remove();
    const icon = document.createElement('link'); icon.rel = 'icon';
    icon.href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${brand.favicon || '🏠'}</text></svg>`)}`;
    document.head.append(icon);
  };

  $('#go').onclick = async () => {
    $('#em').readOnly = false;
    const username = $('#u').value.trim(), email = $('#em').value.trim(), password = $('#pw').value;
    const signup = S.mode === 'signup';
    $('#aErr').textContent = '';
    if (!username) return reportError($('#aErr'), new Error('Enter your username.'));
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reportError($('#aErr'), new Error('Enter a valid email address.'));
    if (password.length < 6) return reportError($('#aErr'), new Error('Password needs at least 6 characters.'));
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

  // Clear the saved session before the original menu handler reloads the page.
  document.addEventListener('click', e => {
    if (e.target.closest('#drawer [data-k="out"]')) {
      const old = token; storeToken('');
      if (old) fetch(API + '/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${old}` } }).catch(() => {});
    }
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
      box.innerHTML = `<h2 style="margin-top:28px">Hire requests</h2><p class="sub">Confirm receipt after you have received payment.</p><div class="grid">${hires.map(h => `<div class="card"><b>${h.customer}</b><div class="mut">${h.location} · GH₵ ${h.price}/day</div><div class="mut" style="margin:8px 0">${h.customer_paid ? 'Customer marked payment as sent' : 'Waiting for customer payment confirmation'} · ${h.payment_method}</div>${h.customer_paid && !h.helper_received ? `<button class="btn" data-received="${h.id}">Confirm received</button>` : h.helper_received ? '<span class="pill">Confirmed</span>' : ''}</div>`).join('') || '<p class="mut">No hire requests yet.</p>'}</div>`;
      $('#view').append(box);
      box.onclick = async e => {
        const button = e.target.closest('[data-received]'); if (!button) return;
        button.disabled = true;
        try { await request(`/hires/${button.dataset.received}/received`, { method: 'PATCH', body: '{}' }); toast('Receipt confirmed'); home(); }
        catch (err) { button.disabled = false; showError(err); }
      };
    } catch (err) { if (err.message !== 'Please log in to continue.') showError(err); }
  }

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
    let content = `<h3 style="font-size:24px">Hire ${h.n}</h3><p class="mut">GH₵ ${h.p} per day · call ${h.ph} to agree the details.</p><label>How will you pay?</label><button class="opt ${m === 'cash' ? 'on' : ''}" data-method="cash">Cash</button><button class="opt ${m === 'bank' ? 'on' : ''}" data-method="bank">Bank payment</button><button class="opt ${m === 'momo' ? 'on' : ''}" data-method="momo">Mobile money</button>`;
    if (m === 'bank') content += `<label>Choose your bank<select id="payDetail">${banks.map(x => `<option ${b === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`;
    if (m === 'momo') content += `<label>Choose a network<select id="payDetail">${networks.map(x => `<option ${b === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`;
    if (m) content += `<div class="step"><span class="dot ${P.cp ? 'ok' : ''}">${P.cp ? '✓' : ''}</span>You confirm you have paid</div><div class="step"><span class="dot ${P.hp ? 'ok' : ''}">${P.hp ? '✓' : ''}</span>${h.n.split(' ')[0]} confirms they received it</div>${P.cp && P.hp ? '<button class="btn" id="rateHire" style="width:100%">Rate & recommend</button>' : `<button class="btn" id="paid" style="width:100%" ${P.cp ? 'disabled' : ''}>I have paid</button>`}<p class="mut" style="font-size:13px;margin-bottom:0">This records confirmations only; it does not process or verify a payment.</p>`;
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
    modal(`<h3 style="font-size:24px">How was ${P.h.n.split(' ')[0]}?</h3><p class="mut">Give a rating, a recommendation, or both.</p><div class="rate" id="rs">${[1,2,3,4,5].map(i => `<span data-i="${i}">★</span>`).join('')}</div><label>Recommendation (optional)<input id="rv" placeholder="What went well?"></label><button class="btn" id="sb" style="width:100%">Submit</button>`);
    $('#rs').onclick = e => { if (e.target.dataset.i) { stars = Number(e.target.dataset.i); document.querySelectorAll('#rs span').forEach((s, i) => s.classList.toggle('on', i < stars)); } };
    $('#sb').onclick = async () => {
      const recommendation = $('#rv').value.trim();
      if (!stars && !recommendation) return toast('Add a rating or a recommendation first');
      try { await request(`/hires/${activeHireId}/rating`, { method: 'POST', body: JSON.stringify({ stars: stars || null, recommendation }) }); modal(0); toast('Thanks, your feedback is saved'); await refreshHelpers(); }
      catch (err) { showError(err); }
    };
  };

  const originalProfile = profile;
  profile = function () {
    originalProfile();
    const fields = $('#view').querySelectorAll('.card:first-child input');
    const save = $('#view').querySelector('.card:first-child .btn');
    if (save) save.onclick = async () => {
      try {
        await request('/me', { method: 'PATCH', body: JSON.stringify({ username: fields[1]?.value || S.user.name, password: fields[2]?.value || '', theme: S.theme || 'Ocean', layout: S.lay, compact: S.dense, colors: [...$('#view').querySelectorAll('[data-c]')].map(x => x.value) }) });
        S.user.name = fields[1]?.value || S.user.name; $('#who').textContent = `${S.user.name} · ${S.role === 'helper' ? 'House help' : 'Customer'}`;
        toast('Profile saved');
      } catch (err) { showError(err); }
    };
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

  adminGate = function () {
    modal(`<h3 style="font-size:24px">Restricted area</h3><p class="mut">Enter the administrator access code configured on the server.</p><input id="pin" type="password" inputmode="numeric" autocomplete="off"><button class="btn" id="ok" style="width:100%">Continue</button>`);
    $('#ok').onclick = async () => {
      try { const result = await request('/admin/session', { method: 'POST', body: JSON.stringify({ pin: $('#pin').value }) }); storeToken(result.token); modal(0); go('admin'); }
      catch (err) { showError(err); }
    };
  };
  admin = async function () {
    try {
      const data = await request('/admin/summary');
      H($('#view'), `<h2>Admin centre</h2><p class="sub">Monitor registrations, hires and the platform brand.</p><div class="stats"><div class="card"><span class="price">${data.hires}</span><span class="mut">Hires recorded</span></div><div class="card"><span class="price">${data.helpers}</span><span class="mut">House helps</span></div><div class="card"><span class="price">${data.customers}</span><span class="mut">Customers</span></div></div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))"><div class="card"><h3>Recent registrations</h3>${data.users.map(u => `<div class="step"><span class="dot ok">!</span>${u.username} · ${u.role}</div>`).join('') || '<p class="mut">No registrations yet.</p>'}<h3 style="margin-top:16px">Add a user</h3><input id="nu" placeholder="Username"><input id="np" type="password" placeholder="Temporary password (6+ characters)"><button class="btn" id="au">Add user</button></div><div class="card"><h3>Branding</h3><label>Site name<input id="sn" value="${data.branding.name}"></label><label>Logo letter or emoji<input id="lg" value="${data.branding.mark}" maxlength="2"></label><label>Favicon emoji<input id="fv" value="${data.branding.favicon}" maxlength="2"></label><button class="btn" id="sv2">Apply branding</button></div></div>`);
      $('#au').onclick = async () => { try { await request('/admin/users', { method: 'POST', body: JSON.stringify({ username: $('#nu').value, password: $('#np').value }) }); toast('User added'); admin(); } catch (err) { showError(err); } };
      $('#sv2').onclick = async () => { try { const brand = await request('/admin/branding', { method: 'PATCH', body: JSON.stringify({ name: $('#sn').value, mark: $('#lg').value, favicon: $('#fv').value }) }); applyBranding(brand); toast('Branding saved'); } catch (err) { showError(err); } };
    } catch (err) { showError(err); }
  };

  (async () => {
    await Promise.all([refreshHelpers(), refreshGuide()]);
    const oauthCallback = window.location.search.includes('code=') ||
      window.location.search.includes('error=') ||
      window.location.search.includes('error_description=') ||
      window.location.hash.includes('access_token');
    try {
      const googleHandled = await finishGoogleSignIn();
      if (googleHandled) return;
      if (token) {
        const user = await request('/me'); applyUser(user); go('home');
        return;
      }
      const brand = await request('/branding').catch(() => null);
      applyBranding(brand);
      if (!token) return;
      const user = await request('/me'); applyUser(user);
      S.lay = user.layout || 'grid'; S.dense = Boolean(user.compact); S.theme = user.theme || 'Ocean';
      if (THEMES[S.theme]) setTheme(THEMES[S.theme]);
      (user.colors || []).forEach((value, i) => document.documentElement.style.setProperty(['--bg', '--sf', '--ink', '--ac'][i], value));
      document.body.classList.toggle('dense', S.dense); go('home');
    } catch (err) {
      storeToken('');
      if (oauthCallback) {
        const pending = JSON.parse(sessionStorage.getItem(GOOGLE_PENDING_KEY) || '{}');
        showAuth(pending.role ? 'signup' : 'login', pending.role || 'customer');
        $('#aErr').textContent = '';
        console.warn('Google sign-in did not complete:', err.message);
      }
    }
  })();
})();
