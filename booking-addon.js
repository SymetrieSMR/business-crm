/* Business CRM V2.1 - Booking & Appointments add-on
   Load AFTER v2-upgrade.js.
   Adds owner-side appointment/request inbox, manual scheduling, and secure sync hooks.
   Does not alter company logos or company identity data.
*/
(function(){
  'use strict';
  const VERSION='2.1.0';
  const BOOKING_KEY='biz_crm_booking_v21';
  const CONFIG_KEY='biz_crm_booking_config_v21';
  const SALES_COMPANIES=new Set(['symetrie','prestige']);
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const nowISO=()=>new Date().toISOString();
  const todayISO=()=>{const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10)};
  const id=()=>`bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;

  function loadBookings(){ try{return JSON.parse(localStorage.getItem(BOOKING_KEY)||'[]')}catch{return[]} }
  function saveBookings(rows){ localStorage.setItem(BOOKING_KEY,JSON.stringify(rows)); }
  function loadConfig(){ try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}')}catch{return{}} }
  function saveConfig(c){ localStorage.setItem(CONFIG_KEY,JSON.stringify(c)); }
  function activeCompany(){ return (typeof state!=='undefined'&&state.activeCompany)||'symetrie'; }
  function isSales(){ return SALES_COMPANIES.has(activeCompany()); }

  function injectStyles(){
    if($('bookingV21Styles')) return;
    const s=document.createElement('style');s.id='bookingV21Styles';s.textContent=`
      .bk-shell{max-width:960px;margin:0 auto;padding:6px 16px 4px}.bk-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:10px 0 8px}
      .bk-head strong{font-size:13px}.bk-actions{display:flex;gap:6px;flex-wrap:wrap}.bk-btn{border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer}.bk-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
      .bk-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:8px}.bk-stat{border:1px solid var(--border);background:var(--surface);border-radius:10px;padding:10px 12px}.bk-stat b{display:block;font-size:19px}.bk-stat span{font-size:11px;color:var(--text-soft)}
      .bk-list{border:1px solid var(--border);background:var(--surface);border-radius:10px;overflow:hidden}.bk-row{display:grid;grid-template-columns:1.4fr 1fr 1fr auto;gap:10px;align-items:center;padding:10px 12px;border-top:1px solid var(--border);font-size:12px}.bk-row:first-child{border-top:0}.bk-name{font-weight:800}.bk-sub{font-size:11px;color:var(--text-soft);margin-top:2px}.bk-pill{display:inline-block;border:1px solid var(--border);border-radius:999px;padding:3px 7px;font-size:10px;font-weight:800}.bk-empty{padding:14px 12px;color:var(--text-soft);font-size:12px}
      .bk-modal{position:fixed;inset:0;background:rgba(0,0,0,.48);display:none;align-items:center;justify-content:center;z-index:99999;padding:16px}.bk-modal.open{display:flex}.bk-card{width:min(620px,100%);max-height:90vh;overflow:auto;background:var(--surface);border-radius:14px;border:1px solid var(--border);padding:16px;box-shadow:0 18px 60px rgba(0,0,0,.25)}.bk-card h3{margin:0 0 12px}.bk-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}.bk-field{display:flex;flex-direction:column;gap:4px}.bk-field.full{grid-column:1/-1}.bk-field label{font-size:11px;font-weight:800;color:var(--text-soft)}.bk-field input,.bk-field select,.bk-field textarea{font:inherit;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:8px;padding:9px}.bk-field textarea{min-height:80px;resize:vertical}.bk-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.bk-note{font-size:11px;color:var(--text-soft);line-height:1.4;margin-top:8px}
      @media(max-width:700px){.bk-grid{grid-template-columns:1fr 1fr}.bk-row{grid-template-columns:1fr auto}.bk-row>div:nth-child(2),.bk-row>div:nth-child(3){display:none}.bk-form{grid-template-columns:1fr}.bk-field.full{grid-column:auto}}
    `;document.head.appendChild(s);
  }

  function normalize(r){return {id:r.id||id(),company:r.company||'symetrie',type:r.type||'callback',status:r.status||'New',name:r.name||'',phone:r.phone||'',email:r.email||'',service:r.service||'',preferredDate:r.preferredDate||'',preferredTime:r.preferredTime||'',scheduledStart:r.scheduledStart||'',scheduledEnd:r.scheduledEnd||'',videoPlatform:r.videoPlatform||'',meetingLink:r.meetingLink||'',address:r.address||'',message:r.message||'',source:r.source||'CRM',createdAt:r.createdAt||nowISO(),updatedAt:nowISO()};}

  function counts(rows){return {new:rows.filter(x=>x.status==='New').length,scheduled:rows.filter(x=>x.status==='Scheduled').length,callbacks:rows.filter(x=>x.type==='callback'&&x.status!=='Completed').length,video:rows.filter(x=>x.type==='video'&&x.status!=='Completed').length};}

  function addPanel(){
    if($('bookingV21')||!isSales()) return;
    const dash=$('v2Dashboard')||document.querySelector('.toolbar'); if(!dash)return;
    const shell=document.createElement('div');shell.id='bookingV21';shell.className='bk-shell';dash.insertAdjacentElement('afterend',shell);render();
  }

  function render(){
    const shell=$('bookingV21'); if(!shell)return;
    if(!isSales()){shell.style.display='none';return}else shell.style.display='block';
    const rows=loadBookings().filter(r=>r.company===activeCompany()).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    const c=counts(rows); const pending=rows.filter(r=>!['Completed','Cancelled'].includes(r.status)).slice(0,8);
    shell.innerHTML=`
      <div class="bk-head"><strong>Bookings & Appointments <span style="font-weight:500;color:var(--text-faint)">V${VERSION}</span></strong><div class="bk-actions"><button class="bk-btn" id="bkSync">Sync public requests</button><button class="bk-btn" id="bkSettings">Booking setup</button><button class="bk-btn primary" id="bkNew">+ New appointment</button></div></div>
      <div class="bk-grid"><div class="bk-stat"><b>${c.new}</b><span>New requests</span></div><div class="bk-stat"><b>${c.scheduled}</b><span>Scheduled</span></div><div class="bk-stat"><b>${c.callbacks}</b><span>Callbacks</span></div><div class="bk-stat"><b>${c.video}</b><span>Video consults</span></div></div>
      <div class="bk-list">${pending.length?pending.map(rowHtml).join(''):'<div class="bk-empty">No pending booking requests.</div>'}</div>`;
    $('bkNew').onclick=()=>openEditor(); $('bkSettings').onclick=openSettings; $('bkSync').onclick=syncPublic;
    shell.querySelectorAll('[data-bkid]').forEach(b=>b.onclick=()=>openEditor(b.dataset.bkid));
  }

  function rowHtml(r){
    const when=r.scheduledStart?new Date(r.scheduledStart).toLocaleString('en-CA',{dateStyle:'medium',timeStyle:'short'}):[r.preferredDate,r.preferredTime].filter(Boolean).join(' ')||'Time not selected';
    const type={estimate:'Estimate',callback:'Callback',video:'Video consultation'}[r.type]||r.type;
    return `<div class="bk-row"><div><div class="bk-name">${esc(r.name||'Unnamed request')}</div><div class="bk-sub">${esc(type)}${r.service?' · '+esc(r.service):''}</div></div><div>${esc(when)}</div><div><span class="bk-pill">${esc(r.status)}</span></div><button class="bk-btn" data-bkid="${esc(r.id)}">Open</button></div>`;
  }

  function ensureModal(){
    if($('bkModal'))return;
    const m=document.createElement('div');m.id='bkModal';m.className='bk-modal';m.innerHTML='<div class="bk-card" id="bkCard"></div>';document.body.appendChild(m);m.onclick=e=>{if(e.target===m)m.classList.remove('open')};
  }

  function openEditor(recordId){
    ensureModal();const rows=loadBookings();let r=rows.find(x=>x.id===recordId)||normalize({company:activeCompany()});
    $('bkCard').innerHTML=`<h3>${recordId?'Booking / Appointment':'New appointment'}</h3><div class="bk-form">
      <div class="bk-field"><label>Type</label><select id="bType"><option value="estimate">Estimate / site visit</option><option value="callback">Callback</option><option value="video">Video consultation</option></select></div>
      <div class="bk-field"><label>Status</label><select id="bStatus">${['New','Contacted','Scheduled','Completed','Cancelled'].map(x=>`<option>${x}</option>`).join('')}</select></div>
      <div class="bk-field"><label>Client name</label><input id="bName"></div><div class="bk-field"><label>Phone</label><input id="bPhone" inputmode="tel"></div>
      <div class="bk-field"><label>Email</label><input id="bEmail" type="email"></div><div class="bk-field"><label>Service</label><input id="bService" placeholder="Foundation repair, basement, windows…"></div>
      <div class="bk-field"><label>Scheduled start</label><input id="bStart" type="datetime-local"></div><div class="bk-field"><label>Scheduled end</label><input id="bEnd" type="datetime-local"></div>
      <div class="bk-field"><label>Video platform</label><select id="bPlatform"><option value="">Not a video meeting</option><option>Google Meet</option><option>Microsoft Teams</option><option>Messenger</option></select></div><div class="bk-field"><label>Meeting link</label><input id="bLink" placeholder="Paste Meet / Teams link"></div>
      <div class="bk-field full"><label>Address</label><input id="bAddress"></div><div class="bk-field full"><label>Notes / request</label><textarea id="bMessage"></textarea></div>
    </div><div class="bk-note">Calendar button creates a pre-filled Google Calendar event. Google Meet links can also be created when the event is added through Google Calendar.</div><div class="bk-foot"><button class="bk-btn" id="bClose">Close</button>${recordId?'<button class="bk-btn" id="bCalendar">Google Calendar</button>':''}<button class="bk-btn primary" id="bSave">Save</button></div>`;
    const set=(k,v)=>{$(k).value=v||''}; set('bType',r.type);set('bStatus',r.status);set('bName',r.name);set('bPhone',r.phone);set('bEmail',r.email);set('bService',r.service);set('bStart',r.scheduledStart?r.scheduledStart.slice(0,16):'');set('bEnd',r.scheduledEnd?r.scheduledEnd.slice(0,16):'');set('bPlatform',r.videoPlatform);set('bLink',r.meetingLink);set('bAddress',r.address);set('bMessage',r.message);
    $('bClose').onclick=()=>$('bkModal').classList.remove('open');
    $('bSave').onclick=()=>{Object.assign(r,{type:$('bType').value,status:$('bStatus').value,name:$('bName').value.trim(),phone:$('bPhone').value.trim(),email:$('bEmail').value.trim(),service:$('bService').value.trim(),scheduledStart:$('bStart').value,scheduledEnd:$('bEnd').value,videoPlatform:$('bPlatform').value,meetingLink:$('bLink').value.trim(),address:$('bAddress').value.trim(),message:$('bMessage').value.trim(),updatedAt:nowISO()});const a=loadBookings();const i=a.findIndex(x=>x.id===r.id);if(i>=0)a[i]=r;else a.push(r);saveBookings(a);$('bkModal').classList.remove('open');render();};
    if($('bCalendar'))$('bCalendar').onclick=()=>openCalendar(r);
    $('bkModal').classList.add('open');
  }

  function openCalendar(r){
    if(!r.scheduledStart){alert('Save a scheduled start time first.');return;}
    const start=new Date(r.scheduledStart),end=r.scheduledEnd?new Date(r.scheduledEnd):new Date(start.getTime()+60*60*1000); const fmt=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
    const title=encodeURIComponent(`${r.type==='callback'?'Callback':r.type==='video'?'Video consultation':'Estimate'} – ${r.name||'Client'}`);const details=encodeURIComponent([r.service,r.phone,r.email,r.address,r.message].filter(Boolean).join('\n'));const loc=encodeURIComponent(r.address||'');
    window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmt(start)}/${fmt(end)}&details=${details}&location=${loc}`,'_blank','noopener');
  }

  function openSettings(){
    ensureModal();const c=loadConfig();$('bkCard').innerHTML=`<h3>Public booking setup</h3><div class="bk-form"><div class="bk-field full"><label>Booking API URL</label><input id="cfgApi" value="${esc(c.apiUrl||'')}" placeholder="Google Apps Script web-app URL"></div><div class="bk-field full"><label>Admin sync token</label><input id="cfgToken" value="${esc(c.adminToken||'')}" type="password" autocomplete="off"></div><div class="bk-field full"><label>Public booking page</label><input value="${location.origin}${location.pathname.replace(/[^/]*$/,'')}book.html" readonly></div></div><div class="bk-note">The public page never receives your admin token. Keep this token only in your CRM browser.</div><div class="bk-foot"><button class="bk-btn" id="cfgClose">Close</button><button class="bk-btn primary" id="cfgSave">Save setup</button></div>`;$('cfgClose').onclick=()=>$('bkModal').classList.remove('open');$('cfgSave').onclick=()=>{saveConfig({apiUrl:$('cfgApi').value.trim(),adminToken:$('cfgToken').value.trim()});$('bkModal').classList.remove('open');};$('bkModal').classList.add('open');
  }

  async function syncPublic(){
    const c=loadConfig();if(!c.apiUrl||!c.adminToken){openSettings();return;}
    try{const u=new URL(c.apiUrl);u.searchParams.set('action','list');u.searchParams.set('token',c.adminToken);const res=await fetch(u.toString(),{cache:'no-store'});if(!res.ok)throw new Error(`HTTP ${res.status}`);const out=await res.json();if(!out.ok)throw new Error(out.error||'Sync failed');const local=loadBookings();const seen=new Set(local.map(x=>x.remoteId).filter(Boolean));let added=0;(out.bookings||[]).forEach(x=>{if(seen.has(String(x.id)))return;local.push(normalize({...x,id:id(),remoteId:String(x.id),source:'Public booking page'}));added++;});saveBookings(local);render();alert(added?`${added} new public booking request${added===1?'':'s'} synced.`:'No new public booking requests.');}catch(e){alert('Booking sync failed: '+e.message);}
  }

  function wrapCompanySwitch(){ if(typeof setActiveCompany!=='function'||setActiveCompany.__bkWrapped)return;const base=setActiveCompany;window.setActiveCompany=function(k){base(k);setTimeout(()=>{if(!$('bookingV21'))addPanel();render()},0)};window.setActiveCompany.__bkWrapped=true; }
  function init(){ if(typeof state==='undefined'){console.warn('Booking add-on requires CRM V2.');return} injectStyles();wrapCompanySwitch();addPanel();console.info('Business CRM booking add-on loaded',VERSION); }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,30));else setTimeout(init,30);
})();
