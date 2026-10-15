// ============ WORKLOAD (urenregistratie) ============
let urenPeriode = 'week';

function fmtUren(n){
  return Number(n||0).toFixed(2).replace(/0+$/,'').replace(/\.$/,'').replace('.', ',');
}
function isoDatum(d){
  return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
}
function weekBereik(d = new Date()){
  const start = new Date(d); start.setHours(0,0,0,0);
  start.setDate(start.getDate() - (start.getDay()+6)%7);   // maandag
  const eind = new Date(start); eind.setDate(eind.getDate()+6);
  return [start, eind];
}
function periodeBereik(){
  if(urenPeriode==='week') return weekBereik();
  if(urenPeriode==='maand'){
    const n = new Date();
    return [new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth()+1, 0)];
  }
  return null;   // alles
}
function periodeLabel(){
  const b = periodeBereik();
  if(!b) return 'Alles';
  const o = {day:'numeric', month:'short'};
  if(urenPeriode==='maand') return new Date().toLocaleDateString('nl-NL',{month:'long', year:'numeric'});
  return `Week ${isoWeek(new Date()).split('-')[1]} · ${b[0].toLocaleDateString('nl-NL',o)} t/m ${b[1].toLocaleDateString('nl-NL',o)}`;
}

document.getElementById('urenPeriodeRow').addEventListener('click', e=>{
  const btn = e.target.closest('button[data-p]');
  if(!btn) return;
  urenPeriode = btn.dataset.p;
  document.querySelectorAll('#urenPeriodeRow button').forEach(b=>b.classList.toggle('sel', b===btn));
  loadUren();
});
document.getElementById('urenSnelRow').addEventListener('click', e=>{
  const btn = e.target.closest('button[data-u]');
  if(!btn) return;
  document.getElementById('fUrenUren').value = fmtUren(btn.dataset.u);
  document.querySelectorAll('#urenSnelRow button').forEach(b=>b.classList.toggle('sel', b===btn));
});
document.getElementById('urenCodeChips').addEventListener('click', e=>{
  const btn = e.target.closest('button[data-c]');
  if(!btn) return;
  document.getElementById('fUrenCode').value = btn.dataset.c;
  document.querySelectorAll('#urenCodeChips button').forEach(b=>b.classList.toggle('sel', b===btn));
});

document.getElementById('btnUrenSave').addEventListener('click', async ()=>{
  const code = document.getElementById('fUrenCode').value.trim().toUpperCase();
  const uren = getal('fUrenUren');
  const werkzaamheden = document.getElementById('fUrenWerk').value.trim();
  const datum = document.getElementById('fUrenDatum').value || isoDatum(new Date());
  if(!code){ toast('Vul een code in (bijv. AKF)'); return; }
  if(uren === null || uren <= 0){ toast('Vul de uren in'); return; }
  if(!werkzaamheden){ toast('Zet er kort bij wat je gedaan hebt'); return; }
  const btn = document.getElementById('btnUrenSave');
  btn.disabled = true;
  try{
    await sb('work_load', {method:'POST', body: JSON.stringify({code, uren, werkzaamheden, datum})});
    // code laten staan: meestal boek je meerdere regels op dezelfde klus
    document.getElementById('fUrenCode').value = code;
    document.getElementById('fUrenUren').value = '';
    document.getElementById('fUrenWerk').value = '';
    document.querySelectorAll('#urenSnelRow button').forEach(b=>b.classList.remove('sel'));
    toast('⏱️ Uren opgeslagen');
    loadUren();
  }catch(e){
    toast('Opslaan mislukt: ' + (e.message||e));
  }finally{
    btn.disabled = false;
  }
});

async function loadUren(){
  const inpDatum = document.getElementById('fUrenDatum');
  if(!inpDatum.value) inpDatum.value = isoDatum(new Date());
  const host = document.getElementById('urenList');
  host.innerHTML = '<div class="empty-state">Laden…</div>';
  const b = periodeBereik();
  const q = b ? `&datum=gte.${isoDatum(b[0])}&datum=lte.${isoDatum(b[1])}` : '';
  const [rijen, alleCodes] = await Promise.all([
    sb(`work_load?order=datum.desc,created_at.desc${q}`),
    sb('work_load?select=code&order=created_at.desc&limit=300')
  ]);
  tekenCodeChips(alleCodes);
  tekenUrenTotalen(rijen);
  tekenUrenLijst(rijen);
}

function tekenCodeChips(rijen){
  const telling = {};
  (rijen||[]).forEach(r=>{ telling[r.code] = (telling[r.code]||0) + 1; });
  const top = Object.keys(telling).sort((a,b)=>telling[b]-telling[a]).slice(0,8);
  const huidig = document.getElementById('fUrenCode').value.trim().toUpperCase();
  document.getElementById('urenCodeChips').innerHTML = top
    .map(c=>`<button data-c="${escapeHtml(c)}" class="${c===huidig?'sel':''}">${escapeHtml(c)}</button>`).join('');
}

function urenPerCode(rijen){
  const per = {};
  rijen.forEach(r=>{ per[r.code] = (per[r.code]||0) + Number(r.uren||0); });
  return Object.entries(per).sort((a,b)=>b[1]-a[1]);
}

function tekenUrenTotalen(rijen){
  const host = document.getElementById('urenTotalen');
  const totaal = rijen.reduce((s,r)=>s + Number(r.uren||0), 0);
  if(!rijen.length){ host.innerHTML = ''; return; }
  const per = urenPerCode(rijen);
  const max = per[0][1] || 1;
  host.innerHTML = `
    <div class="card">
      <div class="totaal">
        <div><div class="titel">${periodeLabel()}</div></div>
        <div class="groot">${fmtUren(totaal)} u</div>
      </div>
      ${per.map(([code,u])=>`
        <div class="totrow">
          <span class="badge code">${escapeHtml(code)}</span>
          <span class="bar"><i style="width:${Math.round(u/max*100)}%"></i></span>
          <span class="u">${fmtUren(u)} u</span>
        </div>`).join('')}
      <button class="btn ghost" style="width:100%; margin-top:12px" onclick="kopieerUren()">📋 Kopieer overzicht</button>
    </div>`;
}

function tekenUrenLijst(rijen){
  const host = document.getElementById('urenList');
  if(!rijen.length){
    host.innerHTML = '<div class="empty-state">Nog geen uren in deze periode.</div>';
    return;
  }
  const perDag = {};
  rijen.forEach(r=>{ (perDag[r.datum] = perDag[r.datum] || []).push(r); });
  host.innerHTML = Object.keys(perDag).sort().reverse().map(datum=>{
    const dag = perDag[datum];
    const dagTotaal = dag.reduce((s,r)=>s + Number(r.uren||0), 0);
    return `
      <div class="daghead">
        <h3>${new Date(datum).toLocaleDateString('nl-NL',{weekday:'short', day:'numeric', month:'short'})}</h3>
        <span>${fmtUren(dagTotaal)} u</span>
      </div>
      <div class="card wl">
        ${dag.map(r=>`
          <div class="wlrow" onclick="openUrenSheet('${r.id}')">
            <span class="badge code">${escapeHtml(r.code)}</span>
            <span class="txt">${r.werkzaamheden ? escapeHtml(r.werkzaamheden) : '<span style="color:var(--sub)">—</span>'}</span>
            <span class="u">${fmtUren(r.uren)} u</span>
          </div>`).join('')}
      </div>`;
  }).join('');
}

async function openUrenSheet(id){
  const rows = await sb(`work_load?id=eq.${id}`);
  const r = rows[0];
  if(!r) return;
  openSheet(`
    <button class="closex" onclick="closeSheet()">✕</button>
    <h2>⏱️ Uren bewerken</h2>
    <div class="bedragrij">
      <div class="field"><label>Code / klus</label><input type="text" id="eUrenCode" value="${escapeHtml(r.code)}" autocapitalize="characters"></div>
      <div class="field"><label>Uren</label><input type="text" inputmode="decimal" id="eUrenUren" value="${fmtUren(r.uren)}"></div>
    </div>
    <div class="field"><label>📅 Datum</label><input type="date" id="eUrenDatum" value="${r.datum||''}"></div>
    <div class="field"><label>Werkzaamheden</label><textarea id="eUrenWerk">${escapeHtml(r.werkzaamheden||'')}</textarea></div>
    <div class="sheet-actions">
      <button class="btn danger" onclick="verwijderUren('${r.id}')">Verwijder</button>
      <button class="btn primary" id="btnUrenUpdate">Opslaan</button>
    </div>
  `);
  document.getElementById('btnUrenUpdate').addEventListener('click', async ()=>{
    const code = document.getElementById('eUrenCode').value.trim().toUpperCase();
    const uren = getal('eUrenUren');
    if(!code){ toast('Vul een code in'); return; }
    if(uren === null || uren <= 0){ toast('Vul de uren in'); return; }
    await sb(`work_load?id=eq.${r.id}`, {method:'PATCH', body: JSON.stringify({
      code, uren,
      datum: document.getElementById('eUrenDatum').value || r.datum,
      werkzaamheden: document.getElementById('eUrenWerk').value.trim()
    })});
    closeSheet(); toast('Opgeslagen'); loadUren();
  });
}
async function verwijderUren(id){
  await sb(`work_load?id=eq.${id}`, {method:'DELETE'});
  closeSheet(); toast('Verwijderd'); loadUren();
}

// Compact blokje tekst om door te sturen of in een urenbriefje te plakken.
async function kopieerUren(){
  const b = periodeBereik();
  const q = b ? `&datum=gte.${isoDatum(b[0])}&datum=lte.${isoDatum(b[1])}` : '';
  const rijen = await sb(`work_load?order=datum.asc,created_at.asc${q}`);
  if(!rijen.length){ toast('Niks te kopiëren'); return; }
  const totaal = rijen.reduce((s,r)=>s + Number(r.uren||0), 0);
  const regels = [`${periodeLabel()} — ${fmtUren(totaal)} uur`, ''];
  urenPerCode(rijen).forEach(([code, u])=>{
    regels.push(`${code} — ${fmtUren(u)} u`);
    rijen.filter(r=>r.code===code).forEach(r=>{
      const d = new Date(r.datum).toLocaleDateString('nl-NL',{day:'2-digit',month:'2-digit'});
      regels.push(`  ${d}  ${fmtUren(r.uren)} u  ${r.werkzaamheden||'—'}`);
    });
    regels.push('');
  });
  const tekst = regels.join('\n').trim();
  try{
    await navigator.clipboard.writeText(tekst);
    toast('📋 Overzicht gekopieerd');
  }catch(e){
    openSheet(`
      <button class="closex" onclick="closeSheet()">✕</button>
      <h2>📋 Urenoverzicht</h2>
      <div class="field"><textarea style="min-height:220px" onclick="this.select()">${escapeHtml(tekst)}</textarea></div>
    `);
  }
}

function isoWeek(d){
  const date = new Date(d.getTime());
  date.setHours(0,0,0,0);
  date.setDate(date.getDate() + 3 - (date.getDay()+6)%7);
  const week1 = new Date(date.getFullYear(),0,4);
  return date.getFullYear()+'-'+(1 + Math.round(((date-week1)/86400000 - 3 + (week1.getDay()+6)%7)/7));
}
