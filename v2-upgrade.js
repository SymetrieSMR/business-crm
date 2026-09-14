/* Business CRM V2 Upgrade
   Non-destructive enhancement for SymetrieSMR/business-crm V1.
   Keeps STORAGE_KEY = biz_crm_v1 and existing contact/referral data.
*/
(function(){
  'use strict';

  const V2_VERSION = '2.0.0';
  const SALES_COMPANIES = new Set(['symetrie','prestige']);
  const ACTIVITY_TYPES = ['Call','Text','Email','Site Visit','Estimate','Follow-up','Note'];
  const ESTIMATE_STATUSES = ['Not started','Preparing','Sent','Accepted','Declined','Expired'];
  const REVIEW_STATUSES = ['Not requested','Requested','Received','Not applicable'];
  let attentionFilter = 'all';

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function todayISO(){ const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
  function money(n){ return new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(Number(n)||0); }
  function dueState(date){
    if(!date) return 'none';
    const t=todayISO();
    if(date<t) return 'overdue';
    if(date===t) return 'today';
    return 'future';
  }
  function companyRows(){ return (state && state.data && state.data[state.activeCompany]) || []; }
  function currentCompany(){ return COMPANIES[state.activeCompany]; }
  function isSales(){ return SALES_COMPANIES.has(state.activeCompany); }
  function isActiveJob(r){ return ['Won','Scheduled','In Progress'].includes(r.status) || r.jobStatus === 'Active'; }
  function isEstimateOpen(r){ return ['Preparing','Sent'].includes(r.estimateStatus) || ['Quoted','Estimate Pending','Follow-up'].includes(r.status); }
  function wonValue(rows){ return rows.filter(r=>['Won','Scheduled','In Progress','Completed'].includes(r.status)).reduce((s,r)=>s+(Number(r.value)||0),0); }

  function injectStyles(){
    const style=document.createElement('style');
    style.id='v2Styles';
    style.textContent=`
      .v2-shell{max-width:960px;margin:0 auto;padding:10px 16px 2px}
      .v2-kicker{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:2px 0 9px}
      .v2-kicker strong{font-size:13px}.v2-version{font-size:11px;color:var(--text-faint)}
      .v2-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
      .v2-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:11px 12px;box-shadow:var(--shadow);cursor:pointer;text-align:left}
      .v2-card:hover{border-color:var(--accent)}.v2-card.active{outline:2px solid var(--accent);outline-offset:-1px}
      .v2-num{font-size:20px;font-weight:800;letter-spacing:-.02em}.v2-label{font-size:11px;color:var(--text-soft);margin-top:2px}
      .v2-danger .v2-num{color:var(--danger)}
      .v2-tools{display:flex;gap:7px;margin:9px 0 0;flex-wrap:wrap}
      .v2-mini{border:1px solid var(--border);background:var(--surface);border-radius:7px;padding:7px 10px;font-size:12px;font-weight:650;cursor:pointer;color:var(--text)}
      .v2-mini.primary{background:var(--accent);color:white;border-color:var(--accent)}
      .v2-attention{margin-top:10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
      .v2-attention-head{padding:9px 12px;font-size:12px;font-weight:800;color:var(--text-soft);border-bottom:1px solid var(--border)}
      .v2-attention-row{display:flex;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer}
      .v2-attention-row:last-child{border-bottom:none}.v2-attention-row:hover{background:var(--bg)}
      .v2-attention-name{font-size:13.5px;font-weight:750}.v2-attention-sub{font-size:11.5px;color:var(--text-soft);margin-top:2px}.v2-attention-date{font-size:11.5px;font-weight:750;white-space:nowrap}
      .v2-overdue{color:var(--danger)}.v2-today{color:var(--accent)}
      .v2-section{margin:14px 0 2px;padding-top:12px;border-top:1px solid var(--border)}
      .v2-section-title{font-size:13px;font-weight:800;margin-bottom:10px;color:var(--text)}
      .v2-activity-list{max-height:170px;overflow:auto;border:1px solid var(--border);border-radius:8px;background:var(--bg);margin-bottom:10px}
      .v2-activity-item{padding:8px 10px;border-bottom:1px solid var(--border);font-size:12px}.v2-activity-item:last-child{border-bottom:none}
      .v2-activity-meta{font-size:10.5px;color:var(--text-faint);margin-bottom:2px}
      .v2-badge{display:inline-block;padding:3px 7px;border-radius:20px;background:var(--accent-tint);color:var(--accent);font-size:10.5px;font-weight:750;margin-left:6px}
      @media(max-width:650px){.v2-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.v2-shell{padding-top:8px}}
    `;
    document.head.appendChild(style);
  }

  function upgradeCompanyPipelines(){
    ['symetrie','prestige'].forEach(key=>{
      const c=COMPANIES[key];
      const expanded=['New Lead','Contacted','Site Visit','Estimate Pending','Quoted','Follow-up','Won','Scheduled','In Progress','Completed','Lost'];
      c.statuses=expanded;
      c.openStatuses=['New Lead','Contacted','Site Visit','Estimate Pending','Quoted','Follow-up','Won','Scheduled','In Progress'];
    });
  }

  function addDashboard(){
    const anchor=document.querySelector('.toolbar');
    if(!anchor || $('v2Dashboard')) return;
    const shell=document.createElement('div');
    shell.className='v2-shell'; shell.id='v2Dashboard';
    anchor.insertAdjacentElement('afterend', shell);
    renderDashboard();
  }

  function renderDashboard(){
    const el=$('v2Dashboard'); if(!el) return;
    const rows=companyRows();
    const overdue=rows.filter(r=>dueState(r.followUp)==='overdue');
    const today=rows.filter(r=>dueState(r.followUp)==='today');
    const estimates=rows.filter(isEstimateOpen);
    const jobs=rows.filter(isActiveJob);
    const filtered = attentionFilter==='overdue' ? overdue : attentionFilter==='today' ? today : attentionFilter==='estimates' ? estimates : attentionFilter==='jobs' ? jobs : [...overdue,...today].filter((r,i,a)=>a.findIndex(x=>x.id===r.id)===i);
    const next=filtered.slice().sort((a,b)=>(a.followUp||'9999').localeCompare(b.followUp||'9999')).slice(0,6);
    el.innerHTML=`
      <div class="v2-kicker"><strong>${esc(currentCompany().name)} — Lead & Customer Pipeline</strong><span class="v2-version">V${V2_VERSION}</span></div>
      <div class="v2-grid">
        ${dashCard('overdue',overdue.length,'Overdue follow-ups',true)}
        ${dashCard('today',today.length,"Today's follow-ups")}
        ${dashCard('estimates',estimates.length,'Open estimates')}
        ${dashCard('jobs',jobs.length,'Active / won jobs')}
      </div>
      ${isSales()?`<div class="v2-tools"><button class="v2-mini" id="v2ShowAll">Clear dashboard filter</button><button class="v2-mini" id="v2Export">Backup CRM</button><button class="v2-mini" id="v2Restore">Restore backup</button><input type="file" id="v2RestoreFile" accept="application/json,.json" hidden><span style="font-size:11px;color:var(--text-soft);align-self:center">Won/active value: <b>${money(wonValue(rows))}</b></span></div>`:`<div class="v2-tools"><button class="v2-mini" id="v2Export">Backup CRM</button><button class="v2-mini" id="v2Restore">Restore backup</button><input type="file" id="v2RestoreFile" accept="application/json,.json" hidden></div>`}
      <div class="v2-attention">
        <div class="v2-attention-head">${attentionFilter==='all'?'Needs attention':labelForFilter(attentionFilter)}</div>
        ${next.length ? next.map(attentionRow).join('') : '<div style="padding:14px 12px;font-size:12.5px;color:var(--text-soft)">Nothing in this view.</div>'}
      </div>`;
    el.querySelectorAll('.v2-card').forEach(btn=>btn.onclick=()=>{attentionFilter=btn.dataset.filter;renderDashboard();});
    el.querySelectorAll('.v2-attention-row').forEach(row=>row.onclick=()=>openEdit(row.dataset.id));
    if($('v2ShowAll')) $('v2ShowAll').onclick=()=>{attentionFilter='all';renderDashboard();};
    $('v2Export').onclick=exportBackup;
    $('v2Restore').onclick=()=> $('v2RestoreFile').click();
    $('v2RestoreFile').onchange=restoreBackup;
  }
  function dashCard(filter,num,label,danger){ return `<button class="v2-card ${danger?'v2-danger':''} ${attentionFilter===filter?'active':''}" data-filter="${filter}"><div class="v2-num">${num}</div><div class="v2-label">${label}</div></button>`; }
  function labelForFilter(f){ return ({overdue:'Overdue follow-ups',today:"Today's follow-ups",estimates:'Open estimates',jobs:'Active / won jobs'})[f]||'Needs attention'; }
  function attentionRow(r){
    const ds=dueState(r.followUp); const dclass=ds==='overdue'?'v2-overdue':ds==='today'?'v2-today':'';
    const secondary=[r.status,r.estimateStatus && r.estimateStatus!=='Not started'?`Estimate: ${r.estimateStatus}`:'',r.nextAction||''].filter(Boolean).join(' • ');
    return `<div class="v2-attention-row" data-id="${esc(r.id)}"><div><div class="v2-attention-name">${esc(r.name)}</div><div class="v2-attention-sub">${esc(secondary)}</div></div><div class="v2-attention-date ${dclass}">${r.followUp?esc(r.followUp):''}</div></div>`;
  }

  function injectContactFields(){
    const notes=$('fNotes'); if(!notes || $('v2Fields')) return;
    const block=document.createElement('div'); block.id='v2Fields'; block.className='v2-section';
    block.innerHTML=`
      <div class="v2-section-title">V2 Lead & Customer Tracking</div>
      <div class="field-row">
        <div class="field"><label>Lead source</label><input id="v2LeadSource" placeholder="Google, Facebook, referral, repeat client…"></div>
        <div class="field"><label>Last contact date</label><input type="date" id="v2LastContact"></div>
      </div>
      <div class="field"><label>Next action</label><input id="v2NextAction" placeholder="Call back, site visit, send estimate…"></div>
      <div id="v2SalesFields">
        <div class="field-row">
          <div class="field"><label>Estimate #</label><input id="v2EstimateNo" placeholder="EST-2026-001"></div>
          <div class="field"><label>Estimate date</label><input type="date" id="v2EstimateDate"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Estimate status</label><select id="v2EstimateStatus" class="native">${ESTIMATE_STATUSES.map(x=>`<option>${x}</option>`).join('')}</select></div>
          <div class="field"><label>Job status</label><select id="v2JobStatus" class="native"><option>Not started</option><option>Scheduled</option><option>Active</option><option>Completed</option><option>Cancelled</option></select></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Completion date</label><input type="date" id="v2CompletionDate"></div>
          <div class="field"><label>Review status</label><select id="v2ReviewStatus" class="native">${REVIEW_STATUSES.map(x=>`<option>${x}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Warranty / retention follow-up</label><input type="date" id="v2WarrantyFollowUp"></div>
      </div>
      <div class="v2-section-title" style="margin-top:8px">Activity history</div>
      <div class="v2-activity-list" id="v2ActivityList"><div style="padding:10px;color:var(--text-soft);font-size:12px">No activity yet.</div></div>
      <div class="field-row">
        <div class="field"><label>Activity type</label><select id="v2ActivityType" class="native">${ACTIVITY_TYPES.map(x=>`<option>${x}</option>`).join('')}</select></div>
        <div class="field"><label>Date</label><input type="date" id="v2ActivityDate" value="${todayISO()}"></div>
      </div>
      <div class="field"><label>Add activity note</label><textarea id="v2ActivityNote" placeholder="What happened / what was agreed?"></textarea></div>`;
    notes.closest('.field').insertAdjacentElement('afterend',block);
  }

  function loadV2Fields(r){
    if(!$('v2Fields')) return;
    r=r||{};
    $('v2LeadSource').value=r.leadSource||'';
    $('v2LastContact').value=r.lastContact||'';
    $('v2NextAction').value=r.nextAction||'';
    $('v2EstimateNo').value=r.estimateNo||'';
    $('v2EstimateDate').value=r.estimateDate||'';
    $('v2EstimateStatus').value=r.estimateStatus||'Not started';
    $('v2JobStatus').value=r.jobStatus||'Not started';
    $('v2CompletionDate').value=r.completionDate||'';
    $('v2ReviewStatus').value=r.reviewStatus||'Not requested';
    $('v2WarrantyFollowUp').value=r.warrantyFollowUp||'';
    $('v2ActivityType').value='Call'; $('v2ActivityDate').value=todayISO(); $('v2ActivityNote').value='';
    $('v2SalesFields').style.display=isSales()?'block':'none';
    renderActivity(r.activity||[]);
  }
  function renderActivity(items){
    const el=$('v2ActivityList'); if(!el) return;
    if(!items.length){ el.innerHTML='<div style="padding:10px;color:var(--text-soft);font-size:12px">No activity yet.</div>'; return; }
    el.innerHTML=items.slice().sort((a,b)=>(b.at||'').localeCompare(a.at||'')).map(a=>`<div class="v2-activity-item"><div class="v2-activity-meta">${esc(a.date||'')} <span class="v2-badge">${esc(a.type||'Note')}</span></div>${esc(a.note||'')}</div>`).join('');
  }

  function saveV2Fields(record){
    record.leadSource=$('v2LeadSource').value.trim();
    record.lastContact=$('v2LastContact').value;
    record.nextAction=$('v2NextAction').value.trim();
    if(isSales()){
      record.estimateNo=$('v2EstimateNo').value.trim();
      record.estimateDate=$('v2EstimateDate').value;
      record.estimateStatus=$('v2EstimateStatus').value;
      record.jobStatus=$('v2JobStatus').value;
      record.completionDate=$('v2CompletionDate').value;
      record.reviewStatus=$('v2ReviewStatus').value;
      record.warrantyFollowUp=$('v2WarrantyFollowUp').value;
    }
    const note=$('v2ActivityNote').value.trim();
    if(note){
      record.activity=Array.isArray(record.activity)?record.activity:[];
      record.activity.push({id:'a'+Date.now().toString(36),type:$('v2ActivityType').value,date:$('v2ActivityDate').value||todayISO(),note,at:new Date().toISOString()});
      if(['Call','Text','Email','Site Visit','Follow-up'].includes($('v2ActivityType').value)) record.lastContact=$('v2ActivityDate').value||todayISO();
    }
  }

  function hookContactForm(){
    const form=$('contactForm'); if(!form || form.dataset.v2Hooked) return; form.dataset.v2Hooked='1';
    form.addEventListener('submit', function(){
      const editId=$('editId').value;
      const name=$('fName').value.trim();
      const companyAtSubmit=state.activeCompany;
      setTimeout(()=>{
        const rows=state.data[companyAtSubmit]||[];
        let rec=editId ? rows.find(r=>r.id===editId) : rows.filter(r=>r.name===name).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''))[0];
        if(!rec) return;
        saveV2Fields(rec); saveData(); renderDashboard();
      },0);
    }, true);
  }

  function wrapFunctions(){
    const baseSetActive=setActiveCompany;
    setActiveCompany=function(key){ baseSetActive(key); if($('v2SalesFields')) $('v2SalesFields').style.display=isSales()?'block':'none'; renderDashboard(); };

    const baseOpenEdit=openEdit;
    openEdit=function(id){ baseOpenEdit(id); const r=companyRows().find(x=>x.id===id); loadV2Fields(r||{}); };

    const baseOpenAdd=openAdd;
    openAdd=function(){ baseOpenAdd(); loadV2Fields({}); };

    const baseRenderSummary=renderSummary;
    renderSummary=function(){ baseRenderSummary(); renderDashboard(); };

    const baseDelete=deleteCurrentContact;
    deleteCurrentContact=function(){ baseDelete(); renderDashboard(); };
  }

  function exportBackup(){
    const raw=localStorage.getItem(STORAGE_KEY)||JSON.stringify({data:state.data,settings:state.settings});
    const blob=new Blob([JSON.stringify({crmVersion:V2_VERSION,storageKey:STORAGE_KEY,exportedAt:new Date().toISOString(),payload:JSON.parse(raw)},null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`business-crm-backup-${todayISO()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    showToast('CRM backup downloaded');
  }
  function restoreBackup(e){
    const file=e.target.files && e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const parsed=JSON.parse(reader.result); const payload=parsed.payload||parsed;
        if(!payload || !payload.data) throw new Error('Invalid CRM backup');
        if(!confirm('Restore this backup? Current CRM data in this browser will be replaced.')) return;
        localStorage.setItem(STORAGE_KEY,JSON.stringify(payload));
        loadData(); setActiveCompany(state.activeCompany); renderDashboard(); showToast('Backup restored');
      }catch(err){ alert('Could not restore this backup: '+err.message); }
      e.target.value='';
    };
    reader.readAsText(file);
  }

  function addV2MetadataToExisting(){
    let changed=false;
    COMPANY_ORDER.forEach(key=>(state.data[key]||[]).forEach(r=>{
      if(!Array.isArray(r.activity)){ r.activity=[]; changed=true; }
      if(r.estimateStatus===undefined && SALES_COMPANIES.has(key)){ r.estimateStatus='Not started'; changed=true; }
      if(r.jobStatus===undefined && SALES_COMPANIES.has(key)){ r.jobStatus='Not started'; changed=true; }
      if(r.reviewStatus===undefined && SALES_COMPANIES.has(key)){ r.reviewStatus='Not requested'; changed=true; }
    }));
    if(changed) saveData();
  }

  function initV2(){
    if(typeof COMPANIES==='undefined' || typeof state==='undefined' || typeof STORAGE_KEY==='undefined'){
      console.error('Business CRM V2 upgrade could not find the V1 CRM globals.'); return;
    }
    injectStyles();
    upgradeCompanyPipelines();
    injectContactFields();
    hookContactForm();
    wrapFunctions();
    addV2MetadataToExisting();
    addDashboard();
    populateFormOptions();
    renderStatusChips();
    renderList();
    renderSummary();
    console.info('Business CRM V2 upgrade loaded', V2_VERSION);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(initV2,0));
  else setTimeout(initV2,0);
})();
