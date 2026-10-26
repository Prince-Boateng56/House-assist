/* House Assist | app logic: pages, listings, profiles, messages, slideshow and motion */

const $=s=>document.querySelector(s),H=(n,x)=>{n.innerHTML=x};
const COL=['#F2B632','#8EC5F0','#F4A58A','#B7C7F2','#A9C2FF','#E6B3D9'];
let helpers=[];
let S={role:'customer',mode:'login',user:null,view:'home',lay:'grid',dense:false,site:'House Assist',hired:[],q:'',sv:'',sort:'rating'};
const stars=n=>'★'.repeat(n)+'☆'.repeat(5-n);
const ini=n=>n.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
const toast=t=>{const e=document.createElement('div');e.className='toast';e.textContent=t;document.body.append(e);setTimeout(()=>e.remove(),2600)};

/* auth */
function authUI(){
 $('#roleSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.r==S.role));
 $('#modeSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.m==S.mode));
 const su=S.mode=='signup';
 $('#locL').classList.toggle('hide',!su);$('#svcL').classList.toggle('hide',!(su&&S.role=='helper'));
 $('#go').textContent=su?'Create account':'Log in';$('#aT').textContent=su?'Join House Assist':'Welcome back';
 $('#aS').textContent=su?'Create your account to get started':'Please enter your details to continue';
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
$('#fg').onclick=()=>$('#aErr').textContent='Password reset will work once the backend is connected.';

const closeDD=()=>document.querySelectorAll('.dd.open').forEach(x=>x.classList.remove('open'));
document.addEventListener('click',closeDD);document.addEventListener('keydown',e=>{if(e.key=='Escape')closeDD()});
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
 if(e.target.id=='backHome'){$('#auth').classList.add('hide');$('#land').classList.remove('hide');scrollTo(0,0)}});
/* nav */
function drawer(){
 const c=S.role=='customer',it=[['home',c?'Find a house help':'Other house helps'],...(c?[['guide','Price guide'],['hired','Hired before']]:[['guide','Price guide']]),['messages','Messages'],['profile','Profile & appearance']];
 H($('#drawer'),it.map(([k,t])=>`<a data-k="${k}" class="${S.view==k?'on':''}">${t}</a>`).join('')+
 (c?'':`<a class="sos" data-k="sos">Emergency</a>`)+
 `<a data-k="out" style="margin-top:6px">Log out</a><div class="policy">House Assist is not responsible for arrangements or transactions completed outside the platform. Please confirm payments and service details carefully. <a data-k="adm" style="display:inline;padding:0;font-weight:400;color:inherit">Read the full p</a><b>olicy</b></div>`);
}
const open=o=>{$('#drawer').classList.toggle('open',o);$('#scrim').classList.toggle('hide',!o)};
$('#bg').onclick=()=>open(true);$('#scrim').onclick=()=>open(false);
$('#drawer').onclick=e=>{const k=e.target.closest('a')?.dataset.k;if(!k)return;open(false);
 if(k=='sos')return sos();if(k=='out')return location.reload();if(k=='adm')return adminGate();go(k)};
function go(v){S.view=v;drawer();({home,guide,hired,messages,profile,admin})[v]();scrollTo(0,0)}

/* listings */
function home(){
 const c=S.role=='customer';
 let l=helpers.filter(h=>(!S.q||(h.n+h.l).toLowerCase().includes(S.q.toLowerCase()))&&(!S.sv||h.s.includes(S.sv)));
 l.sort((a,b)=>S.sort=='rating'?b.r-a.r:S.sort=='low'?a.p-b.p:b.p-a.p);
 H($('#view'),`<h2>${c?'Find a house help':'House helps on the platform'}</h2><p class="sub">${c?'Compare prices and ratings, then contact and hire in a few taps.':'See how others price their work and how they are rated.'}</p>
 <div class="bar"><input id="q" placeholder="Search name or area" value="${S.q}"><select id="sv"><option value="">All services</option>${['House Cleaning','Plumbing','Electrical','Mason','Painting','Repairs','Gardening','Lawn Care','Laundry','Ironing','Cooking','Kitchen Assist','Moving','Packing','Elderly Care','Child Care'].map(x=>`<option ${S.sv==x?'selected':''}>${x}</option>`).join('')}</select>
 <select id="so"><option value="rating">Top rated</option><option value="low" ${S.sort=='low'?'selected':''}>Price: low to high</option><option value="high" ${S.sort=='high'?'selected':''}>Price: high to low</option></select></div>
 <div class="grid ${S.lay=='list'?'list':''}">${l.map(card(c)).join('')||'<p class="mut">No house helps match. Clear the filters to see everyone.</p>'}</div>`);
 $('#q').oninput=e=>{S.q=e.target.value;const p=e.target.selectionStart;home();$('#q').focus();$('#q').setSelectionRange(p,p)};
 $('#sv').onchange=e=>{S.sv=e.target.value;home()};$('#so').onchange=e=>{S.sort=e.target.value;home()};enh($('#view'));
}
const card=c=>(h,i)=>`<div class="card helper"><div style="display:flex;gap:12px;align-items:center"><div class="av" style="background:${COL[helpers.indexOf(h)%6]}">${ini(h.n)}</div><div><b>${h.n}</b><div class="mut">${h.l}</div></div></div>
 <div>${h.s.map(s=>`<span class="tag">${s}</span>`).join('')}</div>
 <div><span class="stars" aria-label="${h.r} stars">${stars(h.r)}</span> <span class="mut">${h.r?h.r+'.0':'New'}</span></div>
 <div class="price">GH₵ ${h.p}<span class="mut" style="font:400 14px Figtree"> / day</span></div>
 ${c?`<button class="btn" data-view="${helpers.indexOf(h)}">View</button>`:''}</div>`;
document.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)viewProfile(helpers[+b.dataset.view])});
function viewProfile(h){
 const tel=(h.ph||'').replace(/[^0-9+]/g,''),ok=tel.length>6,fn=h.n.split(' ')[0],i=helpers.indexOf(h);
 const msg=encodeURIComponent('Hi '+fn+', I found you on House Assist and I\u2019d like to ask about your '+(h.s[0]||'service')+' service.');
 modal(`<div class="pf"><div class="pf-head"><div class="av" style="background:${COL[i%6]};width:72px;height:72px;font-size:26px">${ini(h.n)}</div><div><h3 style="font-size:24px;margin-bottom:5px">${h.n}</h3>
 <div>${h.r?`<span class="stars">${stars(h.r)}</span> <b>${h.r}.0</b>`:'<span class="mut">No ratings yet</span>'}</div><div class="mut">\u{1F4CD} ${h.l}</div></div></div>
 <div class="pf-stats"><div><b>GH\u20b5 ${h.p}</b><small>per day</small></div><div><b>${h.jb||0}</b><small>jobs done</small></div><div><b>${h.x||'New'}</b><small>experience</small></div></div>
 <h4>About</h4><p>${h.b||'New on House Assist. Ask about the work they can do for you.'}</p>
 <h4>Services</h4><div>${h.s.map(x=>`<span class="tag">${x}</span>`).join('')}</div>
 <h4>Availability</h4><p>${h.av||'Ask when you get in touch'}</p>
 <h4>Languages</h4><p>${h.lg||'English'}</p>
 ${ok?`<div class="pf-num hide" id="pfnum"><small>Tap the number to call</small><a class="btn" href="tel:${tel}">${h.ph}</a></div>`:''}<div class="pf-act">${ok?`<button class="btn" type="button" id="pfcall">Call</button>`:''}<button class="btn alt" type="button" id="pft">Text</button><button class="btn hire" type="button" id="pfh">Hire ${fn}</button></div>
 <button class="btn alt" style="width:100%" id="cl" type="button">Close</button></div>`);
 $('#cl').onclick=()=>modal(0);$('#pfh').onclick=()=>hire(h);const pt=$('#pft');if(pt)pt.onclick=()=>openChat(h);const pc=$('#pfcall');if(pc)pc.onclick=()=>{const n=$('#pfnum');n.classList.toggle('hide');if(!n.classList.contains('hide'))n.scrollIntoView({block:'nearest',behavior:'smooth'})};
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
 let body=`<h3 style="font-size:24px">Hire ${h.n}</h3><p class="mut">GH₵ ${h.p} per day · call ${h.ph} to agree the details.</p><label>How will you pay?</label>
 <button class="opt ${m=='cash'?'on':''}" data-m="cash">Cash</button><button class="opt ${m=='bank'?'on':''}" data-m="bank">Bank payment</button><button class="opt ${m=='momo'?'on':''}" data-m="momo">Mobile money</button>`;
 if(m=='bank')body+=`<label>Choose your bank<select id="bk">${banks.map(x=>`<option ${b==x?'selected':''}>${x}</option>`).join('')}</select></label>`;
 if(m=='momo')body+=`<label>Choose a network<select id="bk">${mm.map(x=>`<option ${b==x?'selected':''}>${x}</option>`).join('')}</select></label>`;
 if(m)body+=`<div class="step"><span class="dot ${P.cp?'ok':''}">${P.cp?'✓':''}</span>You confirm you have paid</div><div class="step"><span class="dot ${P.hp?'ok':''}">${P.hp?'✓':''}</span>${h.n.split(' ')[0]} confirms they received it</div>
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
 modal(`<h3 style="font-size:24px">How was ${P.h.n.split(' ')[0]}?</h3><p class="mut">Give a rating, a recommendation, or both.</p><div class="rate" id="rs">${[1,2,3,4,5].map(i=>`<span data-i="${i}">★</span>`).join('')}</div>
 <label>Recommendation (optional)<input id="rv" placeholder="What went well?"></label><button class="btn" id="sb" style="width:100%">Submit</button>`);
 $('#rs').onclick=e=>{if(e.target.dataset.i){n=+e.target.dataset.i;document.querySelectorAll('#rs span').forEach((s,i)=>s.classList.toggle('on',i<n))}};
 $('#sb').onclick=()=>{if(!n&&!$('#rv').value.trim())return toast('Add a rating or a recommendation first');
  if(!S.hired.includes(P.h))S.hired.push(P.h);modal(0);toast('Thanks, your feedback is saved')};
}
function sos(){modal(`<h3 style="font-size:26px;color:var(--red)">Emergency</h3><p>Call the national emergency line now.</p><a class="btn warn" style="display:block;text-align:center;text-decoration:none;font-size:22px" href="tel:112">Call 112</a>
 <p class="mut">Police 191 · Ambulance 193 · Fire 192. Confirm these numbers before launch.</p><button class="btn alt" style="width:100%" id="cl">Close</button>`);$('#cl').onclick=()=>modal(0)}

/* profile + theme */
const THEMES={Ocean:['#040B18','#0A1730','#EAF1FF','#3B82F6','#F2B632'],Emerald:['#050D0A','#0C1A14','#E8F5EE','#2ECC71','#F2B632'],Night:['#0B1020','#141B33','#E6ECFF','#7C9CFF','#F2B632'],Sunset:['#140A07','#22120D','#FBEDE6','#F2784B','#F2B632'],Violet:['#0B0816','#151026','#EEE9FF','#8B6CF0','#F2B632'],Mono:['#0A0A0A','#161616','#F2F2F2','#E5E5E5','#888888']};
function setTheme(a){const r=document.documentElement;r.removeAttribute('data-theme');['--bg','--sf','--ink','--ac','--ac2'].forEach((k,i)=>r.style.setProperty(k,a[i]));
 if(a[0][1]<'5'&&a[0][1]!='F')r.style.colorScheme='dark';else r.style.colorScheme='light'}
function pfCard(){
 const hp=S.role=='helper',rec=hp?(helpers.find(h=>h.me)||S.user):S.user,bio=rec.b||'',v=x=>esc(String(x||''));
 return `<div class="card"><h3>Write your profile</h3><p class="mut" style="margin:6px 0 12px">${hp?'This is what customers see when they press View on your card.':'Tell house helps a little about you and your home.'}</p>
 <label>About me<textarea id="pb" maxlength="400" placeholder="${hp?'Tell customers about your experience, the work you do best and what makes you reliable.':'For example: where you live, the help you need and when.'}">${v(bio)}</textarea></label><div class="mut" id="pbc" style="text-align:right;font-size:12.5px;margin:-2px 0 10px">${bio.length}/400</div>
 ${hp?`<label>Phone number<input id="pph" type="tel" value="${v(rec.ph&&rec.ph!='\u2014'?rec.ph:'')}" placeholder="e.g. 024 000 0000"></label><label>Years of experience<input id="px" value="${v(rec.x)}" placeholder="e.g. 5 years"></label><label>Availability<input id="pav" value="${v(rec.av)}" placeholder="e.g. Mon\u2013Sat, mornings"></label><label>Languages<input id="plg" value="${v(rec.lg)}" placeholder="e.g. English, Twi"></label><label>Price per day (GH\u20b5)<input id="ppr" type="number" min="1" value="${rec.p||''}"></label>`:''}
 <button class="btn" type="button" id="psave">Save profile</button></div>`}
function pfBind(){
 const t=$('#pb'),c=$('#pbc');t.oninput=()=>{c.textContent=t.value.length+'/400'};
 $('#psave').onclick=()=>{const hp=S.role=='helper',rec=hp?(helpers.find(h=>h.me)||S.user):S.user;rec.b=t.value.trim();
  if(hp){rec.ph=$('#pph').value.trim()||'\u2014';rec.x=$('#px').value.trim();rec.av=$('#pav').value.trim();rec.lg=$('#plg').value.trim();const pr=+$('#ppr').value;if(pr>0)rec.p=pr}
  toast('Profile saved')};
}
function profile(){
 H($('#view'),`<h2>Profile & appearance</h2><p class="sub">Make House Assist look and feel the way you like.</p>
 <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(290px,100%),1fr))">${pfCard()}<div class="card"><h3>Your details</h3><div class="av" style="background:${COL[0]};margin:12px 0">${ini(S.user.name)}</div>
 <label>Profile picture<input type="file" accept="image/*"></label><label>Username<input value="${S.user.name}"></label><label>New password<input type="password"></label>
 <button class="btn" onclick="toast('Profile saved')">Save changes</button></div>
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

/* fit the headline to one line across the photo */
function fitHero(){const hero=document.querySelector('.hero'),h=hero&&hero.querySelector('h1');if(!h||!hero.clientWidth)return;h.style.fontSize='100px';const w=h.scrollWidth||h.offsetWidth;h.style.fontSize=Math.min(136,100*hero.clientWidth*0.752/w)+'px';h.style.left=Math.max(16,hero.clientWidth*0.03)+'px';const p=hero.querySelector('p');if(p){p.style.left=h.style.left;p.style.top=(h.offsetTop+h.offsetHeight+10)+'px'}}
(()=>{const hero=document.querySelector('.hero');if(window.ResizeObserver)new ResizeObserver(fitHero).observe(hero);else addEventListener('resize',fitHero);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fitHero);fitHero()})();

/* home page slideshow */
(()=>{const sl=[...document.querySelectorAll('#land .slides i')],dt=[...document.querySelectorAll('#land .dots button')];let k=0,t;
const show=n=>{k=(n+sl.length)%sl.length;sl.forEach((e,i)=>e.classList.toggle('on',i==k));dt.forEach((e,i)=>e.classList.toggle('on',i==k))};
const run=()=>{clearInterval(t);if(!matchMedia('(prefers-reduced-motion:reduce)').matches)t=setInterval(()=>{if(!document.getElementById('land').classList.contains('hide'))show(k+1)},5500)};
dt.forEach((b,i)=>b.onclick=()=>{show(i);run()});show(0);run()})();

/* services dropdown (multi-select) */
(()=>{const box=document.getElementById('svcBox'),btn=box.querySelector('button');
const sync=()=>{const v=[...box.querySelectorAll('input:checked')].map(x=>x.value);btn.textContent=v.length?(v.length>2?v.slice(0,2).join(', ')+' +'+(v.length-2):v.join(', ')):'Select services';btn.classList.toggle('ph',!v.length)};
btn.onclick=e=>{e.preventDefault();e.stopPropagation();const o=!box.classList.contains('open');closeDD();box.classList.toggle('open',o)};
box.querySelector('ul').onclick=e=>e.stopPropagation();
box.addEventListener('change',sync);sync()})();
/* home page sections */
(()=>{const I={shield:'<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',star:'<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',home:'<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>'};
const ic=n=>`<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`;
const row=([i,t,d])=>`<div><span class="ico2">${ic(i)}</span><span><b>${t}</b><small>${d}</small></span></div>`;
H($('#trust'),[['shield','Verified & Trained Assistants','Skilled helpers you can rely on.'],['clock','Same-Day Service','Book in minutes. We handle the rest.'],['shield','Safe & Secure','Your safety and privacy are our priority.'],['star','Affordable & Transparent Pricing','Clear daily prices and star ratings.']].map(row).join(''));
H($('#wl'),[['clock','Save Time','Get things done, without the stress.'],['shield','Peace of Mind','Know you\u2019re in safe hands.'],['star','Quality Service','Professional, friendly and reliable.'],['home','A Cleaner, Healthier Home','Because your well-being matters.']].map(row).join(''));
$('#whyimg').src=document.querySelector('.hero>.ph').src;
$('#hfind').onclick=()=>{S.sv=$('#hsv').value||'';S.q=$('#hrg').value||'';showAuth('signup','customer')};
document.addEventListener('click',e=>{const c=e.target.closest('[data-svc]');if(c){S.sv=c.dataset.svc;S.q='';showAuth('signup','customer')}});
})();
/* learn more page */
const COMPANY={phone:'',whatsapp:'',email:'',address:'',hours:'',social:{Facebook:'',Instagram:'',X:'',YouTube:'',LinkedIn:'',TikTok:''}};
const showLearn=()=>{$('#land').classList.add('hide');$('#learn').classList.remove('hide');scrollTo(0,0)};
const showHome=()=>{$('#learn').classList.add('hide');$('#land').classList.remove('hide');scrollTo(0,0)};
document.addEventListener('click',e=>{if(e.target.closest('[data-learn]')){e.preventDefault();showLearn()}else if(e.target.closest('[data-home]')){e.preventDefault();showHome()}});
$('#learnimg').src=document.querySelector('.hero>.ph').src;
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
/* home page motion */
(()=>{const root=document.documentElement,rm=matchMedia('(prefers-reduced-motion:reduce)').matches,land=document.getElementById('land');
// animated headline
const h=land.querySelector('.lh h1');const ws=h.textContent.trim().split(/\s+/);
h.innerHTML=ws.map((w,i)=>`<span class="w"><span class="${i>=ws.length-2?'g':''}" style="--i:${i}">${w}</span></span>`).join(' ');
[['.lhero .eye',0],['.lhero .lead',5],['.sbar',6],['.lh .dots',7]].forEach(([q,i])=>{const e=land.querySelector(q);if(e){e.classList.add('up');e.style.setProperty('--i',i)}});
// orbs, floating service chips, ticker and counters
land.querySelector('.slides').insertAdjacentHTML('afterend','<div class="orbs" aria-hidden="true"><i></i><i></i><i></i></div>');
const fl=[['\u{1F9F9}','Cleaning','8%','6%','0s','-5deg'],['\u{1F527}','Plumbing','52%','0%','-1.5s','4deg'],['\u{1F373}','Cooking','4%','34%','-3s','3deg'],['\u{1F33F}','Gardening','46%','40%','-4.5s','-4deg'],['\u{1F9FA}','Laundry','12%','64%','-2s','5deg'],['\u{1F476}','Child Care','50%','76%','-3.5s','-3deg']];
land.querySelector('.lh').insertAdjacentHTML('beforeend','<div class="floats" aria-hidden="true">'+fl.map(([e,t,l,tp,d,r])=>`<span style="left:${l};top:${tp};--d:${d};--r:${r}">${e} ${t}</span>`).join('')+'</div>');
const names=['House Cleaning','Plumbing','Electrical','Mason','Painting','Repairs','Gardening','Lawn Care','Laundry','Ironing','Cooking','Kitchen Assist','Moving','Packing','Elderly Care','Child Care'],set=names.map(n=>`<span>${n}</span>`).join('');
land.querySelector('.lhero').insertAdjacentHTML('afterend',`<div class="marq" aria-hidden="true"><div class="mq">${set}${set}</div></div><div class="wrap"><div class="stats2">${[[16,'Regions covered'],[16,'Services to choose'],[3,'Ways to pay'],[5,'Star ratings']].map(([n,l])=>`<div><b data-n="${n}">${rm?n:0}</b><small>${l}</small></div>`).join('')}</div></div>`);
// scroll reveal
root.classList.add('js-rv');
const els=[...land.querySelectorAll('.lsec>h2,.lsec>.sub,.lsec>.eye,.svc,.tr>div,.why2>*,.g3>.card,#lp,.stats2>div,.lsec>.lead')];
els.forEach(e=>e.classList.add('rv'));
const count=t=>{const b=t.querySelector('b[data-n]');if(!b)return;const n=+b.dataset.n,t0=performance.now();const f=now=>{const p=Math.min(1,(now-t0)/1400);b.textContent=Math.round(n*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(f)};if(rm)b.textContent=n;else requestAnimationFrame(f)};
const io=new IntersectionObserver(en=>en.forEach(x=>{if(!x.isIntersecting)return;const t=x.target,k=[...t.parentElement.children].indexOf(t);
 t.style.transitionDelay=Math.min(k,8)*70+'ms';t.classList.add('in');io.unobserve(t);
 t.addEventListener('transitionend',()=>{t.style.transitionDelay='';t.classList.add('done')},{once:true});count(t)}),{threshold:.12});
els.forEach(e=>io.observe(e));
// 3D tilt on service cards
land.querySelectorAll('button.svc').forEach(c=>{c.addEventListener('pointermove',e=>{if(e.pointerType!='mouse'||rm)return;const r=c.getBoundingClientRect();c.style.setProperty('--ry',((e.clientX-r.left)/r.width-.5)*12+'deg');c.style.setProperty('--rx',-((e.clientY-r.top)/r.height-.5)*12+'deg')});c.addEventListener('pointerleave',()=>{c.style.setProperty('--rx','0deg');c.style.setProperty('--ry','0deg')})});
})();
