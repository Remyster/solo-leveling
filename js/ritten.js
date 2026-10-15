// ============ RITTEN (logboek lease-auto) ============
// De lease-auto is van het werk en mag niet privé gebruikt worden. Komt er toch een
// ritje tussendoor, dan hoort dat ergens te staan dat blijft bestaan. Niet als formulier
// met adressen — dat typt niemand bij een snelle stop — maar als één tik per plek:
// de knop pakt het GPS-punt en de tijd. Waar je vandaan kwam en waar je heen ging volgt
// uit de volgorde van de stops, en de afstand ertussen rekent de app uit de coördinaten.
let ritPeriode = 'maand';
let ritSoort = 'prive';

const RIT_SOORTEN = {
  prive:    {label:'Privé',    emoji:'🏠'},
  zakelijk: {label:'Zakelijk', emoji:'🔧'}
};
const PRIVE_GRENS = 500;      // fiscale grens privékilometers per kalenderjaar
const ZELFDE_PLEK = 0.25;     // km — binnen 250 m is het dezelfde plek als eerder

function fmtKm(n){
  return Number(n||0).toFixed(1).replace(/\.0$/,'').replace('.', ',');
}
function fmtTijd(ts){
  return new Date(ts).toLocaleTimeString('nl-NL',{hour:'2-digit', minute:'2-digit'});
}
// Hemelsbrede afstand tussen twee punten; genoeg voor een indicatie per stop.
function afstandKm(a, b){
  if(!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function ritBereik(){
  const n = new Date();
  if(ritPeriode==='maand') return [new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth()+1, 0)];
  if(ritPeriode==='jaar')  return [new Date(n.getFullYear(), 0, 1), new Date(n.getFullYear(), 11, 31)];
  return null;
}
function ritPeriodeLabel(){
  const n = new Date();
  if(ritPeriode==='maand') return n.toLocaleDateString('nl-NL',{month:'long', year:'numeric'});
  if(ritPeriode==='jaar')  return String(n.getFullYear());
  return 'Alle stops';
}

document.getElementById('ritPeriodeRow').addEventListener('click', e=>{
  const btn = e.target.closest('button[data-p]');
  if(!btn) return;
  ritPeriode = btn.dataset.p;
  document.querySelectorAll('#ritPeriodeRow button').forEach(b=>b.classList.toggle('sel', b===btn));
  loadRitten();
});
document.getElementById('ritSoortRow').addEventListener('click', e=>{
  const btn = e.target.closest('button[data-s]');
  if(!btn) return;
  ritSoort = btn.dataset.s;
  document.querySelectorAll('#ritSoortRow button').forEach(b=>b.classList.toggle('sel', b===btn));
});

function haalPositie(){
  return new Promise((resolve, reject)=>{
    if(!navigator.geolocation) return reject(new Error('Dit toestel geeft geen locatie door'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({lat: p.coords.latitude, lon: p.coords.longitude, nauwkeurig: Math.round(p.coords.accuracy)}),
      e => reject(new Error(e.code === 1 ? 'Geen toestemming voor locatie' : 'Geen GPS-signaal')),
      {enableHighAccuracy:true, timeout:12000, maximumAge:30000}
    );
  });
}

document.getElementById('btnRitRegels').addEventListener('click', openRitRegels);
document.getElementById('btnRitHandmatig').addEventListener('click', ()=>openRitHandmatig());
const RIT_PLAATSEN = ['Heemskerk','Andijk','Hoorn','Blokker','Velserbroek','Overveen','Waag','Castricum'];

function openRitHandmatig(stop = null){
  openSheet(`
    <button class="closex" onclick="closeSheet()">✕</button>
    <h2>Rit ${stop?'bewerken':'invoeren'}</h2>
    ${['Van','Naar'].map(label=>`<div class="field"><label>${label==='Van'?'Ik kwam van':'Ik ga naar'}</label>
      <div class="chiprow" data-ritveld="rit${label}">${RIT_PLAATSEN.map(p=>`<button data-plaats="${p}">${p}</button>`).join('')}</div>
      <input id="rit${label}" type="text" placeholder="Of typ zelf een plaats / bestemming" value="${escapeHtml(stop ? (label==='Van'?stop.vertrek:stop.plaats) : '')}">
    </div>`).join('')}
    <div class="field"><label>Wanneer</label><input id="ritWanneer" type="datetime-local" value="${lokaalDatumTijd(stop?.tijd||Date.now())}"></div>
    <div class="field"><label>Soort</label><select id="ritHandSoort">
      ${Object.entries(RIT_SOORTEN).map(([k,v])=>`<option value="${k}" ${k===(stop?.soort||ritSoort)?'selected':''}>${v.label}</option>`).join('')}
    </select></div>
    <p class="hintje">Je legt zelf een rit vast, zonder GPS-punten of berekende kilometers. De bestaande GPS-stops blijven ongewijzigd.</p>
    <div class="sheet-actions">
      ${stop?'<button class="btn danger" id="ritHandVerwijder">Verwijder</button>':''}
      <button class="btn primary" id="ritHandSave">Opslaan</button>
    </div>
  `);
  document.querySelectorAll('[data-ritveld]').forEach(row=>row.addEventListener('click', e=>{
    const button = e.target.closest('button[data-plaats]');
    if(button) document.getElementById(row.dataset.ritveld).value = button.dataset.plaats;
  }));
  document.getElementById('ritHandSave').addEventListener('click', async ()=>{
    const vertrek = document.getElementById('ritVan').value.trim();
    const plaats = document.getElementById('ritNaar').value.trim();
    const wanneer = document.getElementById('ritWanneer').value;
    if(!vertrek || !plaats || !wanneer){ toast('Vul vertrek, bestemming en tijd in'); return; }
    const button = document.getElementById('ritHandSave');
    button.disabled = true;
    try{
      await sb(stop ? `work_stops?id=eq.${stop.id}` : 'work_stops', {
        method:stop?'PATCH':'POST', body:JSON.stringify({
          vertrek, plaats, tijd:new Date(wanneer).toISOString(),
          soort:document.getElementById('ritHandSoort').value
        })
      });
      closeSheet(); toast('Rit opgeslagen'); loadRitten();
    }catch(error){ toast('Opslaan mislukt: ' + error.message); }
    finally{ button.disabled = false; }
  });
  if(stop){
    const button = document.getElementById('ritHandVerwijder');
    button.addEventListener('click', async ()=>{
      if(button.dataset.zeker!=='1'){ button.dataset.zeker='1'; button.textContent='Zeker weten?'; return; }
      button.disabled = true;
      try{
        await sb(`work_stops?id=eq.${stop.id}`, {method:'DELETE'});
        closeSheet(); toast('Rit verwijderd'); loadRitten();
      }catch(error){ toast('Verwijderen mislukt: ' + error.message); button.disabled = false; }
    });
  }
}
document.getElementById('btnHier').addEventListener('click', async ()=>{
  const btn = document.getElementById('btnHier');
  const sub = document.getElementById('hierSub');
  btn.disabled = true; sub.textContent = 'zoeken…';
  let pos = null, fout = '';
  try{ pos = await haalPositie(); }catch(e){ fout = e.message || String(e); }
  btn.disabled = false; sub.textContent = 'pakt je GPS-punt en de tijd';
  openStopSheet(pos, fout);
});

// Vlak na het vastpinnen hoef je alleen nog te zeggen wát dit is — en stond je hier
// al eens, dan is dat één tik op een chip.
async function openStopSheet(pos, fout){
  const bekend = await sb('work_stops?select=plaats,lat,lon&order=tijd.desc&limit=300');
  const dichtbij = [];
  const gezien = new Set();
  (bekend||[]).forEach(s=>{
    if(!s.plaats || gezien.has(s.plaats)) return;
    const d = afstandKm(pos, s);
    if(d !== null && d <= ZELFDE_PLEK){ gezien.add(s.plaats); dichtbij.push(s.plaats); }
  });
  const vaak = {};
  (bekend||[]).forEach(s=>{ if(s.plaats) vaak[s.plaats] = (vaak[s.plaats]||0)+1; });
  const rest = Object.keys(vaak).sort((a,b)=>vaak[b]-vaak[a]).filter(p=>!gezien.has(p)).slice(0,6);

  openSheet(`
    <button class="closex" onclick="closeSheet()">✕</button>
    <h2>📍 Wat is dit voor plek?</h2>
    ${pos
      ? `<div class="hintje">Punt vastgepind op ±${pos.nauwkeurig} m — ${fmtTijd(Date.now())}.</div>`
      : `<div class="hintje" style="color:var(--red)">Geen locatie: ${escapeHtml(fout||'onbekend')}. De stop wordt zonder punt bewaard, alleen met tijd en naam.</div>`}
    <div id="stopChips">
      ${dichtbij.length ? `<div class="hintje" style="margin-bottom:4px">Hier stond je eerder — één tik en het staat erin:</div>
        <div class="chiprow">${dichtbij.map(p=>`<button data-b="${escapeHtml(p)}">📍 ${escapeHtml(p)}</button>`).join('')}</div>` : ''}
      ${rest.length ? `<div class="hintje" style="margin-bottom:4px">${dichtbij.length ? 'Of een andere plek:' : 'Eerder gebruikt:'}</div>
        <div class="chiprow">${rest.map(p=>`<button data-b="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}</div>` : ''}
    </div>
    <div class="field"><input type="text" id="fStopPlaats" placeholder="bijv. McDonald's" autocomplete="off"></div>
    <div class="segrow" id="stopSoortRow">
      ${Object.entries(RIT_SOORTEN).map(([k,v])=>
        `<button data-s="${k}" class="${k===ritSoort?'sel':''}">${v.emoji} ${v.label}</button>`).join('')}
    </div>
    <div class="sheet-actions"><button class="btn primary" id="btnStopSave" style="width:100%">Vastleggen</button></div>
  `);

  let soort = ritSoort;
  document.getElementById('stopSoortRow').addEventListener('click', e=>{
    const b = e.target.closest('button[data-s]');
    if(!b) return;
    soort = b.dataset.s;
    document.querySelectorAll('#stopSoortRow button').forEach(x=>x.classList.toggle('sel', x===b));
  });
  document.getElementById('stopChips').addEventListener('click', e=>{
    const b = e.target.closest('button[data-b]');
    if(!b) return;
    document.getElementById('fStopPlaats').value = b.dataset.b;
    document.getElementById('btnStopSave').click();      // bekende plek = één tik en klaar
  });
  document.getElementById('btnStopSave').addEventListener('click', async ()=>{
    const plaats = document.getElementById('fStopPlaats').value.trim();
    if(!plaats){ toast('Eén woord is genoeg — waar ben je?'); return; }
    const btn = document.getElementById('btnStopSave');
    btn.disabled = true;
    try{
      await sb('work_stops', {method:'POST', body: JSON.stringify({
        tijd: new Date().toISOString(), plaats, soort,
        lat: pos ? pos.lat : null, lon: pos ? pos.lon : null,
        nauwkeurig: pos ? pos.nauwkeurig : null
      })});
      closeSheet(); toast('📍 Stop vastgelegd'); loadRitten();
    }catch(e){
      btn.disabled = false;
      toast('Opslaan mislukt: ' + (e.message||e));
    }
  });
  const inp = document.getElementById('fStopPlaats');
  if(!dichtbij.length) inp.focus();
}

async function loadRitten(){
  const host = document.getElementById('ritList');
  host.innerHTML = '<div class="empty-state">Laden…</div>';
  const b = ritBereik();
  const q = b ? `&tijd=gte.${isoDatum(b[0])}&tijd=lte.${isoDatum(b[1])}T23:59:59` : '';
  const jaarStart = isoDatum(new Date(new Date().getFullYear(), 0, 1));
  const [stops, jaarStops] = await Promise.all([
    sb(`work_stops?order=tijd.asc${q}`),
    sb(`work_stops?select=tijd,soort,lat,lon&tijd=gte.${jaarStart}&order=tijd.asc`)
  ]);
  const metAfstand = metAfstanden(stops);
  tekenRitTotalen(metAfstand, priveKm(metAfstanden(jaarStops)));
  tekenStopLijst(metAfstand);
}

// Een stop krijgt de afstand sinds de vorige stop van dezelfde dag; de eerste van een
// dag heeft er geen, want waar de auto 's nachts stond weet de app niet.
function metAfstanden(stops){
  const uit = [];
  let vorige = null;
  (stops||[]).forEach(s=>{
    const zelfdeDag = vorige && new Date(vorige.tijd).toDateString() === new Date(s.tijd).toDateString();
    uit.push(Object.assign({}, s, {
      vanaf: s.vertrek || (zelfdeDag ? vorige.plaats : null),
      km: !s.vertrek && zelfdeDag ? afstandKm(vorige, s) : null
    }));
    vorige = s;
  });
  return uit;
}
function priveKm(stops){
  return stops.filter(s=>s.soort==='prive').reduce((t,s)=>t + (s.km||0), 0);
}

function kmPerSoort(stops){
  const per = {};
  stops.forEach(s=>{ per[s.soort] = (per[s.soort]||0) + (s.km||0); });
  return Object.entries(per).filter(([,km])=>km > 0).sort((a,b)=>b[1]-a[1]);
}

function tekenRitTotalen(stops, priveJaar){
  const host = document.getElementById('ritTotalen');
  if(!stops.length){ host.innerHTML = ''; return; }
  const per = kmPerSoort(stops);
  const max = per.length ? per[0][1] : 1;
  const totaal = stops.reduce((t,s)=>t + (s.km||0), 0);
  const pct = Math.min(100, Math.round(priveJaar / PRIVE_GRENS * 100));
  host.innerHTML = `
    <div class="card">
      <div class="totaal">
        <div><div class="titel">${escapeHtml(ritPeriodeLabel())}</div></div>
        <div class="groot">${stops.length} ${stops.length===1?'stop':'stops'}</div>
      </div>
      ${per.map(([soort,km])=>`
        <div class="totrow">
          <span class="badge ${soort}">${(RIT_SOORTEN[soort]||{}).label || escapeHtml(soort)}</span>
          <span class="bar"><i style="width:${Math.round(km/max*100)}%"></i></span>
          <span class="u">± ${fmtKm(km)} km</span>
        </div>`).join('')}
      <div class="grens ${priveJaar > PRIVE_GRENS ? 'over' : ''}">
        <div class="kop"><span>🏠 Privé in ${new Date().getFullYear()}</span><b>± ${fmtKm(priveJaar)} / ${PRIVE_GRENS} km</b></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="uitleg">Afstanden zijn hemelsbreed uit de GPS-punten, dus een ondergrens — over de weg is het
        altijd iets meer. 500 km per jaar is de fiscale grens van de Belastingdienst; wat je werkgever zelf
        toestaat kan strenger zijn.</div>
      </div>
      <div class="sheet-actions">
        <button class="btn ghost" onclick="kopieerRitten()">📋 Kopieer</button>
        <button class="btn ghost" onclick="exportRitten()">⬇️ CSV</button>
      </div>
    </div>`;
}

function tekenStopLijst(stops){
  const host = document.getElementById('ritList');
  if(!stops.length){
    host.innerHTML = '<div class="empty-state">Nog geen stops vastgelegd.</div>';
    return;
  }
  const perDag = {};
  stops.forEach(s=>{ (perDag[s.tijd.slice(0,10)] = perDag[s.tijd.slice(0,10)] || []).push(s); });
  host.innerHTML = Object.keys(perDag).sort().reverse().map(datum=>{
    const dag = perDag[datum];
    const dagKm = dag.reduce((t,s)=>t + (s.km||0), 0);
    return `
      <div class="daghead">
        <h3>${new Date(datum).toLocaleDateString('nl-NL',{weekday:'short', day:'numeric', month:'short', year:'numeric'})}</h3>
        <span>${dag.length} ${dag.length===1?'stop':'stops'}${dagKm ? ` · ± ${fmtKm(dagKm)} km` : ''}</span>
      </div>
      <div class="card wl">
        ${dag.map((s,i)=>`
          ${i > 0 && s.km !== null ? `<div class="vanaf"><span class="lijn"></span><span>↓ ± ${fmtKm(s.km)} km</span><span class="lijn"></span></div>` : ''}
          <div class="stoprow" onclick="openStopBewerk('${s.id}')">
            <span class="tijd">${fmtTijd(s.tijd)}</span>
            <span class="txt">
              <div class="naam">${s.vertrek ? escapeHtml(s.vertrek) + ' → ' : ''}${escapeHtml(s.plaats||'?')}</div>
              <div class="sub">
                ${s.notitie ? escapeHtml(s.notitie) + ' · ' : ''}
                ${s.lat != null
                  ? `<a href="https://maps.google.com/?q=${s.lat},${s.lon}" target="_blank" rel="noopener" onclick="event.stopPropagation()">kaart ↗</a> · ±${s.nauwkeurig||'?'} m`
                  : 'geen GPS-punt'}
              </div>
            </span>
            <span class="badge ${s.soort}">${(RIT_SOORTEN[s.soort]||{}).emoji || ''}</span>
          </div>`).join('')}
      </div>`;
  }).join('');
}

async function openStopBewerk(id){
  const rows = await sb(`work_stops?id=eq.${id}`);
  const s = rows[0];
  if(!s) return;
  if(s.vertrek){ openRitHandmatig(s); return; }
  const lokaal = new Date(new Date(s.tijd).getTime() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  openSheet(`
    <button class="closex" onclick="closeSheet()">✕</button>
    <h2>📍 Stop bewerken</h2>
    <div class="field"><label>Plek</label><input type="text" id="eStopPlaats" value="${escapeHtml(s.plaats||'')}"></div>
    <div class="field"><label>Wanneer</label><input type="datetime-local" id="eStopTijd" value="${lokaal}"></div>
    <div class="segrow" id="eStopSoortRow" style="margin-bottom:12px">
      ${Object.entries(RIT_SOORTEN).map(([k,v])=>
        `<button data-s="${k}" class="${k===s.soort?'sel':''}">${v.emoji} ${v.label}</button>`).join('')}
    </div>
    <div class="field"><label>Toelichting — alleen als je het later wil kunnen uitleggen</label><textarea id="eStopNotitie">${escapeHtml(s.notitie||'')}</textarea></div>
    <div class="sheet-actions">
      <button class="btn danger" id="btnStopDel">Verwijder</button>
      <button class="btn primary" id="btnStopUpdate">Opslaan</button>
    </div>
    <div class="hintje" style="margin:10px 0 0; text-align:center">Het logboek is je bewijs — weghalen doe je alleen bij een vergissing.</div>
  `);
  let eSoort = s.soort;
  document.getElementById('eStopSoortRow').addEventListener('click', e=>{
    const b = e.target.closest('button[data-s]');
    if(!b) return;
    eSoort = b.dataset.s;
    document.querySelectorAll('#eStopSoortRow button').forEach(x=>x.classList.toggle('sel', x===b));
  });
  document.getElementById('btnStopUpdate').addEventListener('click', async ()=>{
    const plaats = document.getElementById('eStopPlaats').value.trim();
    if(!plaats){ toast('Vul de plek in'); return; }
    const tijdVeld = document.getElementById('eStopTijd').value;
    await sb(`work_stops?id=eq.${s.id}`, {method:'PATCH', body: JSON.stringify({
      plaats, soort: eSoort,
      notitie: document.getElementById('eStopNotitie').value.trim(),
      tijd: tijdVeld ? new Date(tijdVeld).toISOString() : s.tijd
    })});
    closeSheet(); toast('Opgeslagen'); loadRitten();
  });
  // Twee tikken: een logboekregel weggooien moet geen slip of de vinger zijn.
  const del = document.getElementById('btnStopDel');
  del.addEventListener('click', async ()=>{
    if(del.dataset.zeker !== '1'){ del.dataset.zeker = '1'; del.textContent = 'Zeker weten?'; return; }
    await sb(`work_stops?id=eq.${s.id}`, {method:'DELETE'});
    closeSheet(); toast('Verwijderd'); loadRitten();
  });
}

async function stopsVanPeriode(){
  const b = ritBereik();
  const q = b ? `&tijd=gte.${isoDatum(b[0])}&tijd=lte.${isoDatum(b[1])}T23:59:59` : '';
  return metAfstanden(await sb(`work_stops?order=tijd.asc${q}`));
}

async function openRitRegels(){
  openSheet(`
    <button class="closex" onclick="closeSheet()">✕</button>
    <h2>📖 Regels lease-auto</h2>
    <div class="ritregels" id="ritRegelsBody"><p class="hintje">Laden…</p></div>
  `);
  const body = document.getElementById('ritRegelsBody');
  try{
    const rows = await sb('work_teksten?select=inhoud&sleutel=eq.ritregels&limit=1');
    if(!document.body.contains(body)) return;
    if(!rows || !rows.length){ body.innerHTML = '<p class="hintje">Geen uitleg gevonden in Supabase.</p>'; return; }
    // Trusted content: only the owner can write this row (RLS eigenaar_only).
    body.innerHTML = rows[0].inhoud;
  }catch(e){
    if(!document.body.contains(body)) return;
    body.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'hintje';
    p.textContent = 'Uitleg laden mislukt: ' + e.message;
    body.appendChild(p);
  }
}

// Compact blokje tekst om door te sturen als iemand ernaar vraagt.
async function kopieerRitten(){
  const stops = await stopsVanPeriode();
  if(!stops.length){ toast('Niks te kopiëren'); return; }
  const regels = [`Rittenlogboek ${ritPeriodeLabel()} — ${stops.length} ${stops.length===1?'stop':'stops'}, ± ${fmtKm(stops.reduce((t,s)=>t+(s.km||0),0))} km`, ''];
  let dag = '';
  stops.forEach(s=>{
    const d = new Date(s.tijd).toLocaleDateString('nl-NL',{weekday:'short', day:'2-digit', month:'2-digit', year:'numeric'});
    if(d !== dag){ regels.push(d); dag = d; }
    regels.push(`  ${fmtTijd(s.tijd)}  ${s.plaats}  (${(RIT_SOORTEN[s.soort]||{}).label || s.soort})`
      + (s.vertrek ? `  vanaf ${s.vertrek}` : '')
      + (s.km !== null ? `  ± ${fmtKm(s.km)} km vanaf ${s.vanaf}` : '')
      + (s.notitie ? `  — ${s.notitie}` : ''));
  });
  const tekst = regels.join('\n').trim();
  try{
    await navigator.clipboard.writeText(tekst);
    toast('📋 Logboek gekopieerd');
  }catch(e){
    openSheet(`
      <button class="closex" onclick="closeSheet()">✕</button>
      <h2>📋 Rittenlogboek</h2>
      <div class="field"><textarea style="min-height:240px" onclick="this.select()">${escapeHtml(tekst)}</textarea></div>
    `);
  }
}

// Echte rittenstaat als bestand — puntkomma's en een BOM, zodat Excel het meteen goed opent.
async function exportRitten(){
  const stops = await stopsVanPeriode();
  if(!stops.length){ toast('Niks te exporteren'); return; }
  const cel = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
  const regels = [['Datum','Tijd','Plek','Soort','Vanaf','Afstand (km, hemelsbreed)','Breedtegraad','Lengtegraad','Nauwkeurig (m)','Toelichting'].join(';')];
  stops.forEach(s=>{
    regels.push([
      cel(s.tijd.slice(0,10)), cel(fmtTijd(s.tijd)), cel(s.plaats),
      cel((RIT_SOORTEN[s.soort]||{}).label || s.soort),
      cel(s.vanaf || ''), cel(s.km !== null ? fmtKm(s.km) : ''),
      cel(s.lat ?? ''), cel(s.lon ?? ''), cel(s.nauwkeurig ?? ''), cel(s.notitie)
    ].join(';'));
  });
  const blob = new Blob(['﻿' + regels.join('\r\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rittenlogboek-${ritPeriode==='alles' ? 'alles' : isoDatum(ritBereik()[0]).slice(0, ritPeriode==='jaar' ? 4 : 7)}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast('⬇️ Rittenstaat gedownload');
}
