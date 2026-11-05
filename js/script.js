/* House Assist | app logic: pages, listings, profiles, messages, slideshow and motion */

const $=s=>document.querySelector(s),H=(n,x)=>{n.innerHTML=x};
const safeHtml=value=>{const node=document.createElement('span');node.textContent=String(value??'');return node.innerHTML.replace(/"/g,'&quot;').replace(/'/g,'&#39;')};
const COL=['#d8eaf0','#b9d9e2','#eaf4f6','#a6cbd7','#c6e0e7','#8ebdca'];
let helpers=[];
let S={role:'customer',mode:'login',user:null,view:'home',lay:'grid',dense:false,site:'House Assist',hired:[],q:'',sv:'',sort:'rating'};
const stars=n=>'★'.repeat(n)+'☆'.repeat(5-n);
const ini=n=>n.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
const toast=t=>{const e=document.createElement('div');e.className='toast';e.textContent=t;document.body.append(e);setTimeout(()=>e.remove(),2600)};

const releaseLoadingButton=button=>{
 if(!button)return;
 clearTimeout(button._loadingTimer);
 button.classList.remove('is-loading');
 button.disabled=false;
 if(window.__houseAssistLoadingButton===button)window.__houseAssistLoadingButton=null;
};
document.addEventListener('click',e=>{
 const button=e.target.closest('button');
 if(!button||button.closest('.ha-landing')||button.disabled||button.classList.contains('is-loading'))return;
 button.classList.add('is-loading');
 button.disabled=true;
 window.__houseAssistLoadingButton=button;
 button._loadingTimer=setTimeout(()=>releaseLoadingButton(button),1200);
},true);
const houseAssistFetch=window.fetch.bind(window);
window.fetch=(...args)=>{
 const loadingButton=window.__houseAssistLoadingButton;
 return houseAssistFetch(...args).finally(()=>releaseLoadingButton(loadingButton));
};

/* auth */
function authUI(){
 $('#roleSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.r==S.role));
 $('#modeSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.m==S.mode));
 const su=S.mode=='signup';
 $('#locL').classList.toggle('hide',!su);$('#svcL').classList.toggle('hide',!(su&&S.role=='helper'));
 $('#go').textContent=su?'Create account':'Log in';$('#aT').textContent=su?'Join House Assist':'Welcome back';
 $('#aS').textContent=su?'Create your account to get started':'Please enter your details to continue';
 $('#usernameFieldLabel').textContent=su?'Full name':'Username';$('#u').placeholder=su?'e.g. Akosua Mensah':'Enter your username';$('#u').autocomplete=su?'name':'username';
 $('#pw').autocomplete=su?'new-password':'current-password';$('#pw').placeholder=su?'At least 10 characters':'Enter your password';$('#pw').maxLength=128;
 $('#rmRow').classList.toggle('hide',su);
 $('#swL').innerHTML=su?'Already have an account? <a>Log in</a>':'Don’t have an account? <a>Sign up</a>';
}
$('#roleSeg').onclick=e=>{if(e.target.dataset.r){S.role=e.target.dataset.r;authUI()}};
$('#modeSeg').onclick=e=>{if(e.target.dataset.m){S.mode=e.target.dataset.m;authUI()}};
$('#go').onclick=()=>{
 const u=$('#u').value.trim(),pw=$('#pw').value,su=S.mode=='signup',err=m=>$('#aErr').textContent=m;
 if(!u)return err('Enter your username.');if(pw.length<6)return err('Password needs at least 6 characters.');
 if(su&&!$('#loc').value.trim())return err('Select your region so we can match you nearby.');
 if(su&&S.role=='helper'&&!(+$('#pr').value>0))return err('Add the price you charge per day.');
 const picked=[...document.querySelectorAll('#svcBox input:checked')].map(x=>x.value);if(su&&S.role=='helper'&&!picked.length)return err('Choose at least one service you offer.');
 S.user={name:u,loc:$('#loc').value||'Greater Accra'};
 $('#auth').classList.add('hide');$('#app').classList.remove('hide');
 $('#who').textContent=u+' · '+(S.role=='helper'?'House help':'Customer');go('home');
};
authUI();
$('#swL').onclick=e=>{if(e.target.tagName=='A'){S.mode=S.mode=='login'?'signup':'login';$('#aErr').textContent='';authUI()}};
$('#eye').onclick=()=>{const p=$('#pw'),h=p.type=='password';p.type=h?'text':'password';$('#eye').textContent=h?'Hide':'Show'};
const closeDD=()=>document.querySelectorAll('.dd.open').forEach(x=>x.classList.remove('open'));
document.addEventListener('click',closeDD);document.addEventListener('keydown',e=>{if(e.key=='Escape'){closeDD();open(false)}});
function enh(root=document){root.querySelectorAll('select:not([data-dd])').forEach(s=>{s.dataset.dd=1;s.style.display='none';
 const d=document.createElement('div'),b=document.createElement('button'),u=document.createElement('ul');d.className='dd';b.type='button';b.setAttribute('aria-haspopup','listbox');u.setAttribute('role','listbox');
 const draw=()=>{b.textContent=s.options[s.selectedIndex]?.text||'';b.classList.toggle('ph',s.value==='');u.innerHTML=[...s.options].map((o,i)=>o.value===''?'':`<li role="option" data-i="${i}" class="${i==s.selectedIndex?'on':''}">${o.text}</li>`).join('')};draw();
 b.onclick=e=>{e.preventDefault();e.stopPropagation();const o=!d.classList.contains('open');closeDD();d.classList.toggle('open',o)};
 u.onclick=e=>{const li=e.target.closest('li');if(!li)return;e.stopPropagation();s.selectedIndex=+li.dataset.i;draw();d.classList.remove('open');s.dispatchEvent(new Event('change',{bubbles:true}))};
 d.append(b,u);s.after(d)})}
enh();
const showAuth=(m,r)=>{S.mode=m||'login';if(r)S.role=r;authUI();$('#land').classList.add('hide');$('#learn').classList.add('hide');$('#auth').classList.remove('hide');scrollTo(0,0)};
document.addEventListener('click',e=>{const g=e.target.closest('[data-go]');if(g){e.preventDefault();const[m,r]=g.dataset.go.split(',');showAuth(m,r)}
 const s=e.target.closest('[data-scroll]');if(s){e.preventDefault();document.getElementById(s.dataset.scroll).scrollIntoView({behavior:'smooth'})}
 if(e.target.closest('#backHome,#backHomeText,#authBackLink')){$('#auth').classList.add('hide');$('#land').classList.remove('hide');scrollTo(0,0)}});
/* nav */
function drawer(){
 const c=S.role=='customer',it=[['home',c?'Find a house help':'Other house helps'],...(c?[['guide','Price guide'],['hired','Hired before']]:[['guide','Price guide']]),['messages','Messages'],['profile','Profile & appearance']];
 const name=S.user?.name||'House Assist member',icons={
  home:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3.5 10 8.5-7 8.5 7"/><path d="M5.5 9.5V21h13V9.5M9.5 21v-6h5v6"/></svg>',
  guide:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h13a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2V4.5Z"/><path d="M5 18a2 2 0 0 1 2-2h13M9 9h7M9 12h5"/></svg>',
  hired:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16m-11 5 2 2 4-4"/></svg>',
  messages:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4.5 2 1.4-4.2A7.5 7.5 0 1 1 20.5 11.5Z"/><path d="M8.5 11.5h7M8.5 14.5h4"/></svg>',
  profile:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 21c.8-4 3.3-6 7.5-6s6.7 2 7.5 6"/></svg>',
  sos:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.1 3.5h2.7l1.4 3.8-1.9 1.5a13 13 0 0 0 5.9 5.9l1.5-1.9 3.8 1.4v2.7c0 .9-.7 1.6-1.6 1.6A15.4 15.4 0 0 1 5.5 5.1c0-.9.7-1.6 1.6-1.6Z"/></svg>',
  out:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M14 16l5-4-5-4m5 4H9"/></svg>'
 };
 const link=([k,label],extra='')=>`<a href="#app" data-k="${k}" class="drawer-item ${extra} ${S.view==k?'on':''}" ${S.view==k?'aria-current="page"':''}><span class="drawer-item-icon">${icons[k]}</span><span class="drawer-item-label">${label}</span></a>`;
 H($('#drawer'),`<div class="drawer-brand"><span>&#8962;</span><b>${safeHtml(S.site||'House Assist')}</b><small>Good help for a better home.</small></div>
  <section class="drawer-profile" aria-label="Your account"><div class="drawer-avatar" aria-hidden="true">${safeHtml(ini(name))}</div><div class="drawer-profile-copy"><b>${safeHtml(name)}</b><small>${c?'House owner':'House help'}</small></div><a href="#app" data-k="profile" class="drawer-profile-link" ${S.view=='profile'?'aria-current="page"':''}>View profile <span aria-hidden="true">&#8599;</span></a></section>
  <div class="drawer-links">${it.map(item=>link(item,item[0]=='profile'?'drawer-profile-menu':'')).join('')}${c?'':link(['sos','Emergency'],'sos')}</div>
  <div class="drawer-bottom">${link(['out','Log out'],'drawer-logout')}<div class="policy">House Assist is not responsible for arrangements or transactions completed outside the platform. Please confirm payments and service details carefully.</div></div>`);
 const mobile=window.matchMedia('(max-width: 820px)').matches;$('#drawer').inert=mobile;$('#drawer').setAttribute('aria-hidden',String(mobile));
}
const open=o=>{const mobile=window.matchMedia('(max-width: 820px)').matches;$('#drawer').classList.toggle('open',o);$('#drawer').inert=mobile&&!o;$('#drawer').setAttribute('aria-hidden',String(mobile&&!o));$('#scrim').classList.toggle('hide',!o);$('#bg').setAttribute('aria-expanded',String(o));$('#bg').setAttribute('aria-label',o?'Close menu':'Open menu');document.body.classList.toggle('drawer-open',o)};
$('#bg').onclick=()=>open(true);$('#scrim').onclick=()=>open(false);
$('#drawer').onclick=e=>{const item=e.target.closest('a[data-k]');if(!item)return;e.preventDefault();const k=item.dataset.k;open(false);
 if(k=='sos')return sos();if(k=='out')return location.reload();go(k)};
function syncDashboardNav(view){
 const nav=document.querySelector('.app-bottom-nav');if(!nav)return;
 const buttons=[...nav.querySelectorAll('button[data-app-nav]')];
 const labels=S.role==='helper'?{home:'Dashboard',guide:'Price guide',messages:'Messages',profile:'Profile'}:{home:'Home',guide:'Price guide',messages:'Messages',profile:'Account'};
 buttons.forEach(button=>{const label=button.querySelector('small');if(label)label.textContent=labels[button.dataset.appNav]||button.dataset.appNav});
 const center=nav.querySelector('[data-center-action]'),helperMode=S.role==='helper';
 if(center){
  center.classList.toggle('is-emergency',helperMode);
  center.setAttribute('aria-label',helperMode?'Call Ghana Police emergency number 191':'Find a house help');
  center.innerHTML=helperMode?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.1 3.5h2.7l1.4 3.8-1.9 1.5a13 13 0 0 0 5.9 5.9l1.5-1.9 3.8 1.4v2.7c0 .9-.7 1.6-1.6 1.6A15.4 15.4 0 0 1 5.5 5.1c0-.9.7-1.6 1.6-1.6Z"/></svg><small>SOS</small>':'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.4"/><path d="m15.5 15.5 4.3 4.3"/></svg><small>Find</small>';
  center.onclick=()=>{if(helperMode){window.location.href='tel:191';return}go('home');requestAnimationFrame(()=>document.querySelector('#q')?.focus({preventScroll:true}))};
 }
 const activeView=buttons.some(button=>button.dataset.appNav===view)?view:'';
 nav.dataset.active=activeView;
 buttons.forEach(button=>{
  const active=button.dataset.appNav===activeView;
  button.classList.toggle('on',active);
  if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
 });
}
function go(v){S.view=v;syncDashboardNav(v);drawer();({home,guide,hired,messages,profile,admin})[v]();scrollTo(0,0)}
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-app-nav]');
 if(!b||$('#app').classList.contains('hide'))return;
 e.preventDefault();
 go(b.dataset.appNav);
});

/* listings and role-aware dashboards */
function helperPhoto(h){
 const services=h.s||[],name=services[0]||'';
 if(/garden|lawn/i.test(name))return 'images/slide-02-lawn-care.jpg';
 if(/laundry|clean/i.test(name))return 'images/slide-03-cleaning-table.jpg';
 if(/cook|kitchen/i.test(name))return 'images/slide-05-washing-dishes.jpg';
 if(/child|elderly|care/i.test(name))return 'images/slide-06-childcare.jpg';
 if(/electric/i.test(name))return 'images/slide-07-electrician.jpg';
 if(/plumb/i.test(name))return 'images/slide-08-plumber.jpg';
 if(/mason|paint|repair/i.test(name))return 'images/slide-09-carpenter.jpg';
 return 'images/slide-01-cleaners-living-room.jpg';
}
function home(){
 const c=S.role==='customer',name=esc((S.user&&S.user.name||'there').split(' ')[0]);
 let matches=helpers.filter(h=>(!S.q||`${h.n} ${h.l} ${(h.s||[]).join(' ')}`.toLowerCase().includes(S.q.toLowerCase()))&&(!S.sv||(h.s||[]).includes(S.sv)));
 const ranked=[...matches].sort((a,b)=>(b.r||0)-(a.r||0));
  const services=[['House Cleaning','&#10022;'],['Repairs','&#10052;'],['Plumbing','&#8961;'],['Electrical','&#9889;'],['Laundry','&#9635;'],['Gardening','&#9827;'],['Child Care','&#9825;'],['More','&#65291;']];
 const serviceButtons=services.map(([service,icon])=>`<button type="button" class="dash-service" data-service="${service}"><span>${icon}</span><small>${service}</small></button>`).join('');
 if(c){
  const featured=ranked.slice(0,2),more=[...ranked.slice(2)].sort((a,b)=>S.sort==='low'?a.p-b.p:S.sort==='high'?b.p-a.p:(b.r||0)-(a.r||0));
  H($('#view'),`<div class="dashboard-view role-customer">
   <div class="dash-topline"><div><small class="dash-kicker">YOUR HOME, WELL CARED FOR</small><h2>Welcome home, ${name}</h2><p class="sub">Find good help for the everyday things that make a house a home.</p></div><button type="button" class="dash-bell" data-app-nav="messages" aria-label="Open messages">&#9826;</button></div>
   <div class="dash-search bar"><span aria-hidden="true">&#8981;</span><input id="q" placeholder="Search a service or region" value="${esc(S.q)}"><button type="button" class="dash-filter" aria-label="Filter results">&#9776;</button></div>
   <section class="dash-promo customer-promo"><div><small>GOOD HELP FOR A BETTER HOME.</small><h3>A little help makes home feel lighter.</h3><p>Browse local people, compare their ratings, and find the right fit for your home.</p><button type="button" class="btn" data-app-nav="guide">Explore services <span>&#8594;</span></button></div><div class="dash-promo-art" aria-hidden="true">&#10035;</div></section>
   <section class="dash-section"><div class="dash-section-head"><div><small class="dash-kicker">START WITH WHAT YOU NEED</small><h3>Popular services</h3></div><button type="button" class="dash-see-all" data-app-nav="guide">All services <span>&#8594;</span></button></div><div class="dash-services">${serviceButtons}</div></section>
   <section class="dash-section dash-recommended"><div class="dash-section-head"><div><small class="dash-kicker">THE COMMUNITY'S TOP PICKS</small><h3>Highest rated house helps</h3></div><label class="dash-sort-label">Sort others <select id="so"><option value="rating">Top rated</option><option value="low" ${S.sort==='low'?'selected':''}>Lowest price</option><option value="high" ${S.sort==='high'?'selected':''}>Highest price</option></select></label></div>
    ${featured.length?`<div class="helper-feature-grid">${featured.map(card(true,'featured')).join('')}</div>`:'<p class="mut dash-empty">No house helps match your search yet. Try another service or region.</p>'}
   </section>
   ${more.length?`<section class="dash-section dash-more-helpers"><div class="dash-section-head"><div><small class="dash-kicker">MORE LOCAL PROFESSIONALS</small><h3>More house helps to explore</h3></div><span class="dash-count">${more.length} profiles</span></div><div class="helper-compact-grid">${more.map(card(true,'compact')).join('')}</div></section>`:''}
   <div class="dash-filters"><label>Filter service <select id="sv"><option value="">All services</option>${['House Cleaning','Plumbing','Electrical','Mason','Painting','Repairs','Gardening','Lawn Care','Laundry','Ironing','Cooking','Kitchen Assist','Moving','Packing','Elderly Care','Child Care'].map(x=>`<option ${S.sv===x?'selected':''}>${x}</option>`).join('')}</select></label></div>
  </div>`);
 }else{
  const mine=helpers.find(h=>h.n===(S.user&&S.user.name))||null;
  const rating=mine&&mine.r?`${mine.r}.0`:'New';
  const price=mine&&mine.p?`GH&#8373; ${mine.p}`:'Set your rate';
  const offered=mine&&mine.s&&mine.s.length?mine.s:['Add the services you offer'];
  H($('#view'),`<div class="dashboard-view role-helper">
   <div class="dash-topline"><div><small class="dash-kicker">YOUR HOUSE ASSIST SPACE</small><h2>Good to see you, ${name}</h2><p class="sub">Keep your profile ready for the next customer nearby.</p></div><button type="button" class="dash-bell" data-app-nav="messages" aria-label="Open messages">&#9826;</button></div>
   <section class="dash-promo helper-promo"><div><small>YOUR WORK, YOUR REPUTATION</small><h3>Let your good work speak for itself.</h3><p>Keep your services and daily rate up to date so customers can find and contact you.</p><button type="button" class="btn" data-app-nav="profile">Manage your profile <span>&#8594;</span></button></div><div class="dash-promo-art" aria-hidden="true">&#10035;</div></section>
   <section class="helper-overview"><div class="helper-overview-copy"><small class="dash-kicker">YOUR PUBLIC PROFILE</small><h3>${mine?esc(mine.n):name}</h3><p>${mine?esc(mine.l||S.user.loc||'Ghana'):'Complete your profile to start appearing in customer searches.'}</p><div class="helper-tags">${offered.map(x=>`<span>${esc(x)}</span>`).join('')}</div><button type="button" class="btn" data-app-nav="profile">Edit your profile <span>&#8594;</span></button></div><div class="helper-stat-grid"><div><small>Current rating</small><b>${rating}${mine&&mine.r?' <span>&#9733;</span>':''}</b><em>${mine&&mine.r?'Customer rated':'Build your reputation'}</em></div><div><small>Daily rate</small><b>${price}</b><em>Set a fair rate</em></div><div><small>Services listed</small><b>${mine&&mine.s?mine.s.length:'&mdash;'}</b><em>Help customers find you</em></div></div></section>
   <section class="dash-section helper-guide"><div class="dash-section-head"><div><small class="dash-kicker">MAKE YOUR PROFILE STAND OUT</small><h3>Three ways to grow your presence</h3></div></div><div class="helper-tips"><article><span>01</span><b>Show what you do</b><p>List every service you can confidently provide.</p></article><article><span>02</span><b>Share your experience</b><p>Add a short introduction and your availability.</p></article><article><span>03</span><b>Keep your rate current</b><p>Make your daily price easy for customers to understand.</p></article></div></section>
  </div>`);
 }
 const q=$('#q');if(q)q.oninput=e=>{S.q=e.target.value;const p=e.target.selectionStart;home();$('#q')?.focus();$('#q')?.setSelectionRange(p,p)};
 const so=$('#so');if(so)so.onchange=e=>{S.sort=e.target.value;home()};
 const sv=$('#sv');if(sv)sv.onchange=e=>{S.sv=e.target.value;home()};
 enh($('#view'));
 $('#view').querySelectorAll('[data-service]').forEach(b=>b.onclick=()=>{const value=b.dataset.service;if(value==='More')return go('guide');S.sv=value;home()});
}
const card=(c,variant='normal')=>(h)=>{
 const index=helpers.indexOf(h),rating=h.r?`${h.r}.0`:'New',price=`GH&#8373; ${h.p}`;
 const service=(h.s||[])[0]||'Home help';
  if(variant==='featured')return `<article class="helper-feature-card" data-view="${index}" tabindex="0" role="link" aria-label="View ${safeHtml(h.n)}'s profile"><div class="helper-feature-photo"><img src="${helperPhoto(h)}" alt="${safeHtml(service)} service example"><span class="feature-badge">TOP RATED</span><span class="feature-stars">&#9733; ${rating}</span></div><div class="helper-feature-body"><div class="helper-feature-person"><div class="av" style="background:${COL[index%6]}">${safeHtml(ini(h.n))}</div><div><b>${safeHtml(h.n)}</b><small>${safeHtml(h.l||'Ghana')}</small></div><span class="helper-rating-pill">&#9733; ${rating}</span></div><div class="helper-feature-tags">${(h.s||[]).slice(0,2).map(x=>`<span>${safeHtml(x)}</span>`).join('')}</div><div class="helper-feature-bottom"><strong>${price}<small> / day</small></strong><span class="helper-card-link">View profile <span aria-hidden="true">&#8594;</span></span></div></div></article>`;
  if(variant==='compact')return `<article class="helper-compact-card" data-view="${index}" tabindex="0" role="link" aria-label="View ${safeHtml(h.n)}'s profile"><div class="helper-compact-photo"><img src="${helperPhoto(h)}" alt=""></div><div class="av" style="background:${COL[index%6]}">${safeHtml(ini(h.n))}</div><div class="helper-compact-person"><b>${safeHtml(h.n)}</b><small>${safeHtml(h.l||'Ghana')} &middot; ${safeHtml(service)}</small><span class="helper-rating-pill">${h.r?'&#9733; '+rating:'New'}</span></div><strong>${price}<small> / day</small></strong><span class="helper-card-arrow" aria-hidden="true">&#8594;</span></article>`;
  return `<div class="card helper" data-view="${index}" tabindex="0" role="link" aria-label="View ${safeHtml(h.n)}'s profile"><div style="display:flex;gap:12px;align-items:center"><div class="av" style="background:${COL[index%6]}">${safeHtml(ini(h.n))}</div><div><b>${safeHtml(h.n)}</b><div class="mut">${safeHtml(h.l||'Ghana')}</div></div></div><div>${(h.s||[]).map(s=>`<span class="tag">${safeHtml(s)}</span>`).join('')}</div><div><span class="stars" aria-label="${Number(h.r)||0} stars">${stars(Number(h.r)||0)}</span> <span class="mut">${rating}</span></div><div class="price">${price}<span class="mut" style="font:400 14px Figtree"> / day</span></div>${c?'<span class="helper-card-link">View profile <span aria-hidden="true">&#8594;</span></span>':''}</div>`;
};
document.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)viewProfile(helpers[+b.dataset.view])});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-view]')){e.preventDefault();viewProfile(helpers[+e.target.dataset.view])}});
function viewProfile(h){
 const tel=(h.ph||'').replace(/[^0-9+]/g,''),ok=tel.length>6,fn=h.n.split(' ')[0],i=helpers.indexOf(h),photo=helperPhoto(h);
 S.detailHelper=h;S.view='helperDetail';syncDashboardNav(S.view);drawer();scrollTo(0,0);
 H($('#view'),`<div class="helper-detail-page">
  <button class="helper-detail-back" type="button" data-helper-back><span aria-hidden="true">&#8592;</span> Back to house helps</button>
  <section class="helper-detail-hero"><div class="helper-detail-photo"><img src="${photo}" alt="${safeHtml((h.s||[])[0]||'Home help')} service example"></div><div class="helper-detail-title"><span class="dash-kicker">HOUSE ASSIST PROFESSIONAL</span><h1>${safeHtml(h.n)}</h1><p>${safeHtml(h.l||'Ghana')} <span aria-hidden="true">·</span> ${(h.s||[]).slice(0,2).map(safeHtml).join(' · ')}</p><div class="helper-detail-rating">${h.r?`<span class="stars">${stars(Number(h.r)||0)}</span><b>${Number(h.r)||0}.0</b><span>(${Number(h.rc)||0} reviews)</span>`:'<span class="mut">New on House Assist · No reviews yet</span>'}</div></div></section>
  <div class="helper-detail-content"><section class="helper-detail-main">
   <article class="helper-detail-panel"><span class="dash-kicker">A LITTLE ABOUT ${safeHtml(h.n.split(' ')[0].toUpperCase())}</span><h2>Meet your house help</h2><p>${safeHtml(h.b||'This house help is ready to tell you more about their experience and the care they bring to each home.')}</p></article>
   <article class="helper-detail-panel"><span class="dash-kicker">SERVICES</span><h2>How they can help</h2><div class="helper-detail-tags">${(h.s||[]).map(s=>`<span>${safeHtml(s)}</span>`).join('')}</div></article>
   <article class="helper-detail-panel helper-detail-facts"><div><span>Experience</span><b>${safeHtml(h.x||'Ask when you connect')}</b></div><div><span>Availability</span><b>${safeHtml(h.av||'Ask when you connect')}</b></div><div><span>Languages</span><b>${safeHtml(h.lg||'English')}</b></div></article>
  </section><aside class="helper-detail-aside"><div class="helper-detail-price"><span class="dash-kicker">CLEAR DAILY RATE</span><strong>GH&#8373; ${Number(h.p)||0}<small> / day</small></strong><p>Confirm the work details and schedule directly with ${safeHtml(fn)} before booking.</p><div class="helper-detail-actions">${ok?'<button class="btn alt" type="button" data-detail-call>Call</button>':''}<button class="btn alt" type="button" data-detail-text>Text</button><button class="btn" type="button" data-detail-hire>Hire ${safeHtml(fn)}</button></div>${ok?`<div class="helper-detail-phone hide" data-helper-phone><a href="tel:${tel}">${safeHtml(h.ph)}</a></div>`:''}</div></aside></div>
 </div>`);
 $('#view').querySelector('[data-helper-back]').onclick=()=>go('home');
 $('#view').querySelector('[data-detail-call]')?.addEventListener('click',()=>$('#view').querySelector('[data-helper-phone]').classList.toggle('hide'));
 $('#view').querySelector('[data-detail-text]').onclick=()=>openChat(h);
 $('#view').querySelector('[data-detail-hire]').onclick=()=>hire(h);
}

/* price guide */
function guide(){
 const rows=[5,4,3,2,1].map(r=>{const p=helpers.filter(h=>h.r==r).map(h=>h.p);return{r,lo:Math.min(...p),hi:Math.max(...p),n:p.length}}).filter(x=>x.n);
 const mx=Math.max(...rows.map(x=>x.hi))*1.1;
 H($('#view'),`<h2>Price guide by star rating</h2><p class="sub">The typical daily range for each rating group, worked out from current listings. Use it to judge whether a price is fair.</p>
 <div class="card">${rows.map(x=>`<div class="row"><span class="stars">${stars(x.r)}</span><div class="track"><div class="fill" style="left:${x.lo/mx*100}%;width:${Math.max((x.hi-x.lo)/mx*100,2)}%"></div></div><b>GH₵ ${x.lo}${x.hi>x.lo?' – '+x.hi:''}</b></div>`).join('')}
 <p class="mut" style="margin:14px 0 0">Based on ${helpers.length} listings. Groups with no house helps are hidden.</p></div>`);
}
function hired(){H($('#view'),`<h2>Hired before</h2><p class="sub">House helps you have worked with.</p><div class="grid">${S.hired.map(card(true)).join('')||'<p class="mut">You haven’t hired anyone yet. Browse house helps to get started.</p>'}</div>`)}

/* messages */
S.th={};S.chat=null;
const esc=t=>t.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nowT=()=>new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
function openChat(h){const i=helpers.indexOf(h),k='h'+i;if(!S.th[k])S.th[k]={n:h.n,c:i,m:[]};S.chat=k;modal(0);go('messages')}
function messages(){
 const keys=Object.keys(S.th),cur=S.th[S.chat];
 const last=t=>t.m.length?(t.m[t.m.length-1].f=='me'?'You: ':'')+t.m[t.m.length-1].t:'No messages yet';
 H($('#view'),`<h2>Messages</h2><p class="sub">${S.role=='helper'?'Chat with customers who contact you.':'Chat with house helps before you hire them.'}</p>
 <div class="chat ${cur?'open':''}"><aside class="cl">${keys.length?keys.map(k=>`<button type="button" class="crow ${k==S.chat?'on':''}" data-chat="${k}"><span class="av" style="background:${COL[S.th[k].c%6]};width:44px;height:44px;font-size:16px;flex:none">${ini(S.th[k].n)}</span><span><b>${esc(S.th[k].n)}</b><small>${esc(last(S.th[k]))}</small></span></button>`).join(''):'<p class="mut" style="padding:20px">No conversations yet. Open a house help’s profile and press Text to start one.</p>'}</aside>
 <section class="ct">${cur?`<div class="cth"><button type="button" class="btn alt cback" data-chatback aria-label="Back">\u2190</button><span class="av" style="background:${COL[cur.c%6]};width:42px;height:42px;font-size:15px">${ini(cur.n)}</span><b>${esc(cur.n)}</b></div>
  <div class="ms" id="ms">${cur.m.length?cur.m.map(x=>`<div class="bub ${x.f}">${esc(x.t)}<small>${x.at}</small></div>`).join(''):'<div class="empty">Say hello to '+esc(cur.n.split(' ')[0])+'.</div>'}</div>
  <div class="cmp"><input id="mi" placeholder="Type a message" autocomplete="off"><button type="button" class="btn" id="msend">Send</button></div>
  `:'<div class="empty">Select a conversation to start chatting.</div>'}</section></div>`);
 const m=$('#ms');if(m)m.scrollTop=m.scrollHeight;
 const send=()=>{const i=$('#mi'),t=i.value.trim();if(!t)return;cur.m.push({f:'me',t,at:nowT()});messages();$('#mi').focus()};
 if($('#msend')){$('#msend').onclick=send;$('#mi').onkeydown=e=>{if(e.key=='Enter')send()}}
}
document.addEventListener('click',e=>{const c=e.target.closest('[data-chat]');if(c){S.chat=c.dataset.chat;messages();return}if(e.target.closest('[data-chatback]')){S.chat=null;messages()}});
/* hire + payment */
let P={};
function modal(x){const m=$('#modal');m.classList.toggle('hide',!x);if(x){H(m,`<div class="card">${x}</div>`);m.onclick=e=>{if(e.target==m)modal(0)}}}
function hire(h){P={h,m:'',b:'',cp:0,hp:0};pay()}
function pay(){
 const {h,m,b}=P,banks=['GCB Bank','Ecobank Ghana','Stanbic Bank','Absa Ghana','Fidelity Bank'],mm=['MTN MoMo','Telecel Cash','AT Money'];
 let body=`<h3 style="font-size:24px">Hire ${safeHtml(h.n)}</h3><p class="mut">GH₵ ${Number(h.p)||0} per day · call ${safeHtml(h.ph||'the house help')} to agree the details.</p><label>How will you pay?</label>
 <button class="opt ${m=='cash'?'on':''}" data-m="cash">Cash</button><button class="opt ${m=='bank'?'on':''}" data-m="bank">Bank payment</button><button class="opt ${m=='momo'?'on':''}" data-m="momo">Mobile money</button>`;
 if(m=='bank')body+=`<label>Choose your bank<select id="bk">${banks.map(x=>`<option ${b==x?'selected':''}>${x}</option>`).join('')}</select></label>`;
 if(m=='momo')body+=`<label>Choose a network<select id="bk">${mm.map(x=>`<option ${b==x?'selected':''}>${x}</option>`).join('')}</select></label>`;
 if(m)body+=`<div class="step"><span class="dot ${P.cp?'ok':''}">${P.cp?'✓':''}</span>You confirm you have paid</div><div class="step"><span class="dot ${P.hp?'ok':''}">${P.hp?'✓':''}</span>${safeHtml(h.n.split(' ')[0])} confirms they received it</div>
 ${P.hp&&P.cp?'<button class="btn" id="rt" style="width:100%">Rate & recommend</button>':
 `<button class="btn" id="paid" style="width:100%" ${P.cp?'disabled':''}>I have paid</button>`}
 <p class="mut" style="font-size:13px;margin-bottom:0">Your confirmation is not proof from the bank or network. Check your own statement too.</p>`;
 modal(body+`<button class="btn alt" style="width:100%;margin-top:12px" id="cl">Close</button>`);
 $('#cl').onclick=()=>modal(0);
 document.querySelectorAll('[data-m]').forEach(x=>x.onclick=()=>{if(P.cp)return;P.m=x.dataset.m;P.b='';pay();if($('#bk'))P.b=$('#bk').value});
 if($('#bk')){$('#bk').onchange=e=>P.b=e.target.value;enh($('#modal'))}
 if($('#paid'))$('#paid').onclick=()=>{if($('#bk'))P.b=$('#bk').value;P.cp=1;pay();toast('Payment marked as done')};
 if($('#rt'))$('#rt').onclick=rate;
}
function rate(){let n=0;
 modal(`<h3 style="font-size:24px">How was ${safeHtml(P.h.n.split(' ')[0])}?</h3><p class="mut">Give a rating, a recommendation, or both.</p><div class="rate" id="rs">${[1,2,3,4,5].map(i=>`<span data-i="${i}">★</span>`).join('')}</div>
 <label>Recommendation (optional)<input id="rv" placeholder="What went well?"></label><button class="btn" id="sb" style="width:100%">Submit</button>`);
 $('#rs').onclick=e=>{if(e.target.dataset.i){n=+e.target.dataset.i;document.querySelectorAll('#rs span').forEach((s,i)=>s.classList.toggle('on',i<n))}};
 $('#sb').onclick=()=>{if(!n&&!$('#rv').value.trim())return toast('Add a rating or a recommendation first');
  if(!S.hired.includes(P.h))S.hired.push(P.h);modal(0);toast('Thanks, your feedback is saved')};
}
function sos(){modal(`<h3 style="font-size:26px;color:var(--red)">Call the Police</h3><p>Connect directly to the Ghana Police emergency line.</p><a class="btn warn" style="display:block;text-align:center;text-decoration:none;font-size:22px" href="tel:191">Call Police · 191</a>
 <p class="mut">Ghana Police also lists 18555 as a toll-free helpline.</p><button class="btn alt" style="width:100%" id="cl">Close</button>`);$('#cl').onclick=()=>modal(0)}

/* profile + theme */
const THEMES={Ocean:['#f3f9fa','#ffffff','#183943','#08798e','#075b70'],Emerald:['#f1f8f6','#ffffff','#193c38','#087d77','#075b70'],Night:['#eef6f8','#ffffff','#173641','#096d86','#075b70'],Sunset:['#faf6f2','#ffffff','#3d3530','#0b7186','#075b70'],Violet:['#f5f3f9','#ffffff','#302b3b','#08798e','#075b70'],Mono:['#f5f8f9','#ffffff','#24383e','#347c8b','#075b70']};
function setTheme(a){const r=document.documentElement;r.removeAttribute('data-theme');['--bg','--sf','--ink','--ac','--ac2'].forEach((k,i)=>r.style.setProperty(k,a[i]));
 if(a[0][1]<'5'&&a[0][1]!='F')r.style.colorScheme='dark';else r.style.colorScheme='light'}
function pfCard(){
 const hp=S.role=='helper',rec=hp?(helpers.find(h=>h.me)||S.user):S.user,bio=rec.b??rec.bio??'',v=x=>esc(String(x||''));
 return `<div class="card"><h3>Write your profile</h3><p class="mut" style="margin:6px 0 12px">${hp?'This is what customers see when they press View on your card.':'Tell house helps a little about you and your home.'}</p>
 <label>About me<textarea id="pb" maxlength="400" placeholder="${hp?'Tell customers about your experience, the work you do best and what makes you reliable.':'For example: where you live, the help you need and when.'}">${v(bio)}</textarea></label><div class="mut" id="pbc" style="text-align:right;font-size:12.5px;margin:-2px 0 10px">${bio.length}/400</div>
  ${hp?`<label>Phone number<input id="pph" type="tel" maxlength="40" value="${v(rec.ph||rec.phone)}" placeholder="e.g. 024 000 0000"></label><label>Years of experience<input id="px" maxlength="80" value="${v(rec.x||rec.experience)}" placeholder="e.g. 5 years"></label><label>Availability<input id="pav" maxlength="120" value="${v(rec.av||rec.availability)}" placeholder="e.g. Mon\u2013Sat, mornings"></label><label>Languages<input id="plg" maxlength="120" value="${v(rec.lg||rec.languages)}" placeholder="e.g. English, Twi"></label><label>Price per day (GH\u20b5)<input id="ppr" type="number" min="1" value="${Number(rec.p||rec.price)||''}"></label>`:''}
 <button class="btn" type="button" id="psave">Save profile</button></div>`}
function pfBind(){
 const t=$('#pb'),c=$('#pbc');t.oninput=()=>{c.textContent=t.value.length+'/400'};
 $('#psave').onclick=()=>{const hp=S.role=='helper',rec=hp?(helpers.find(h=>h.me)||S.user):S.user;rec.b=t.value.trim();
  if(hp){rec.ph=$('#pph').value.trim()||'\u2014';rec.x=$('#px').value.trim();rec.av=$('#pav').value.trim();rec.lg=$('#plg').value.trim();const pr=+$('#ppr').value;if(pr>0)rec.p=pr}
  toast('Profile saved')};
}
function profile(){
 H($('#view'),`<h2>Profile & appearance</h2><p class="sub">Make House Assist look and feel the way you like.</p>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(290px,100%),1fr))">${pfCard()}<div class="card"><h3>Your details</h3><div class="av" style="background:${COL[0]};margin:12px 0">${safeHtml(ini(S.user.name))}</div>
  <p class="mut">Profile photos will be available when secure image storage is configured.</p><label>Full name<input id="profileUsername" maxlength="40" value="${safeHtml(S.user.name)}"></label><label>Region<input id="profileLocation" maxlength="80" value="${safeHtml(S.user.loc||'')}" placeholder="Your region"></label><label>New password<input id="profilePassword" type="password" autocomplete="new-password"></label>
  <button class="btn" type="button" id="saveAccountDetails">Save account details</button></div>
 <div class="card"><h3>Colour theme</h3><p class="mut">Pick a preset, then fine-tune any colour.</p><div class="swatch">${Object.entries(THEMES).map(([k,v])=>`<button title="${k}" aria-label="${k} theme" data-t="${k}" style="background:linear-gradient(135deg,${v[0]} 50%,${v[3]} 50%)"></button>`).join('')}</div>
 ${[['Background',0],['Cards',1],['Text',2],['Accent',3]].map(([t,i])=>`<label>${t}<input type="color" data-c="${i}" value="${getComputedStyle(document.documentElement).getPropertyValue(['--bg','--sf','--ink','--ac'][i]).trim().slice(0,7)||'#ffffff'}"></label>`).join('')}</div>
 <div class="card"><h3>Layout</h3><p class="mut">How house-help listings appear.</p><div class="seg" id="lay"><button data-l="grid" class="${S.lay=='grid'?'on':''}">Grid</button><button data-l="list" class="${S.lay=='list'?'on':''}">List</button></div>
 <div class="seg" id="den"><button data-d="0" class="${S.dense?'':'on'}">Comfortable</button><button data-d="1" class="${S.dense?'on':''}">Compact</button></div></div></div>`);
 pfBind();
 document.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{setTheme(THEMES[b.dataset.t]);profile()});
 document.querySelectorAll('[data-c]').forEach(i=>i.oninput=()=>document.documentElement.style.setProperty(['--bg','--sf','--ink','--ac'][i.dataset.c],i.value));
 $('#lay').onclick=e=>{if(e.target.dataset.l){S.lay=e.target.dataset.l;profile()}};
 $('#den').onclick=e=>{if(e.target.dataset.d){S.dense=e.target.dataset.d=='1';document.body.classList.toggle('dense',S.dense);profile()}};
}

/* services dropdown (multi-select) */
(()=>{const box=document.getElementById('svcBox'),btn=box.querySelector('button');
const sync=()=>{const v=[...box.querySelectorAll('input:checked')].map(x=>x.value);btn.textContent=v.length?(v.length>2?v.slice(0,2).join(', ')+' +'+(v.length-2):v.join(', ')):'Select services';btn.classList.toggle('ph',!v.length)};
btn.onclick=e=>{e.preventDefault();e.stopPropagation();const o=!box.classList.contains('open');closeDD();box.classList.toggle('open',o)};
box.querySelector('ul').onclick=e=>e.stopPropagation();
box.addEventListener('change',sync);sync()})();
/* landing interactions */
$('#hfind').onclick=()=>{S.sv=$('#hsv').value||'';S.q=$('#hrg').value||'';showAuth('signup','customer')};
document.addEventListener('click',e=>{const c=e.target.closest('[data-svc]');if(c){S.sv=c.dataset.svc;S.q='';showAuth('signup','customer')}});
const landingNav=document.querySelector('.ha-nav'),landingMenu=document.querySelector('.ha-menu');
landingMenu.onclick=()=>landingNav.classList.toggle('is-open');
landingNav.querySelectorAll('.ha-navlinks a').forEach(a=>a.addEventListener('click',()=>landingNav.classList.remove('is-open')));
/* learn more page */
const COMPANY={phone:'',whatsapp:'',email:'',address:'',hours:'',social:{Facebook:'',Instagram:'',X:'',YouTube:'',LinkedIn:'',TikTok:''}};
const showLearn=()=>{$('#land').classList.add('hide');$('#learn').classList.remove('hide');scrollTo(0,0)};
const showHome=target=>{$('#learn').classList.add('hide');$('#land').classList.remove('hide');scrollTo(0,0);if(target)requestAnimationFrame(()=>document.getElementById(target)?.scrollIntoView({behavior:'smooth'}))};
document.addEventListener('click',e=>{if(e.target.closest('[data-learn]')){e.preventDefault();showLearn()}else{const homeLink=e.target.closest('[data-home]');if(homeLink){e.preventDefault();showHome(homeLink.dataset.homeTarget)}}});
$('#learnimg').src='images/slide-04-housekeeper.jpg';
(()=>{const C=COMPANY,dg=x=>String(x).replace(/[^0-9+]/g,''),ink=(t,v,h)=>`<div class="card cbox"><span class="ico2">${t}</span><span><b>${h}</b>${v}</span></div>`;
const soon='<small>Coming soon</small>';
H($('#cinfo'),[ink('\u260E',C.phone?`<a href="tel:${dg(C.phone)}">${esc(C.phone)}</a>`:soon,'Phone'),
 ink('\u{1F4AC}',C.whatsapp?`<a href="https://wa.me/${dg(C.whatsapp).replace('+','')}" target="_blank" rel="noopener">${esc(C.whatsapp)}</a>`:soon,'WhatsApp'),
 ink('\u2709',C.email?`<a href="mailto:${esc(C.email)}">${esc(C.email)}</a>`:soon,'Email'),
 ink('\u{1F4CD}',C.address?`<small>${esc(C.address)}</small>`:soon,'Office'),
 ink('\u{1F552}',C.hours?`<small>${esc(C.hours)}</small>`:soon,'Opening hours')].join(''));
H($('#csoc'),Object.entries(C.social).map(([n,u])=>u?`<a href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`:`<span class="off" title="Coming soon">${n}</span>`).join(''));
$('#cs').onclick=()=>{const n=$('#cn').value.trim(),m=$('#cm').value.trim(),e=$('#ce').value.trim();if(!n||!m)return toast('Add your name and a message first');
 if(!C.email)return toast('Messages will work once the contact email is added');
 location.href='mailto:'+C.email+'?subject='+encodeURIComponent('Message from '+n)+'&body='+encodeURIComponent(m+'\n\n'+n+(e?' ('+e+')':''))}})();
