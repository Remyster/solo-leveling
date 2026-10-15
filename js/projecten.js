// ============ PROJECTEN TAB (alleen PWN) ============
const statusLabels = {backlog:'Nog beginnen', bezig:'Mee bezig', wacht_op:'Wacht op iemand of iets', klaar:'Klaar'};
const statusUitleg = {
  backlog:'Nog niets aan gedaan.',
  bezig:'Je bent begonnen, ook voorbereiden of bestellen telt.',
  wacht_op:'Je kunt niet verder: wacht op levering, reactie of iemand anders.',
  klaar:'Afgerond.'
};
const herhalingLabels = {eenmalig:'Eenmalig', dagelijks:'Elke dag', wekelijks:'Elke week', maandelijks:'Elke maand'};

function isVasteTaak(t){ return !!t.herhaling && t.herhaling !== 'eenmalig'; }

function volgendeDeadline(deadline, herhaling){
  if(!deadline) return null;
  const d = new Date(`${deadline}T12:00:00`);
  if(herhaling==='dagelijks') d.setDate(d.getDate()+1);
  else if(herhaling==='wekelijks') d.setDate(d.getDate()+7);
  else if(herhaling==='maandelijks') d.setMonth(d.getMonth()+1);
  else return deadline;
  return isoDatum(d);
}

function takenSectieOpen(key){
  try{ return JSON.parse(localStorage.getItem('werkhubTaakSecties')||'{}')[key] === true; }catch(e){ return false; }
}
function onthoudTakenSectie(key, open){
  try{
    const state = JSON.parse(localStorage.getItem('werkhubTaakSecties')||'{}');
    state[key] = open;
    localStorage.setItem('werkhubTaakSecties', JSON.stringify(state));
  }catch(e){}
}

// Sorteert op deadline (datum) en daarbinnen op begintijd. Taken zonder deadline/tijd
// komen achteraan — werkt ook als begin_tijd/eind_tijd nog niet in de database bestaan
// (sb() geeft dan gewoon 'undefined' terug, die behandelen we als "geen tijd").
function sortTakenOpDeadlineEnTijd(taken){
  return [...taken].sort((a,b)=>{
    const ad = a.deadline || '9999-99-99', bd = b.deadline || '9999-99-99';
    if(ad !== bd) return ad < bd ? -1 : 1;
    const at = a.begin_tijd || '99:99', bt = b.begin_tijd || '99:99';
    if(at !== bt) return at < bt ? -1 : 1;
    return 0;
  });
}

async function loadProjecten(){
  const host = document.getElementById('projLists');
  host.innerHTML = '<div class="empty-state">Laden…</div>';
  const tasksRaw = await sb(`work_tasks?project=eq.pwn&order=deadline.asc.nullslast`);
  const day = new URL(location.href).searchParams.get('datum');
  const filteredDay = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? day : null;
  const tasks = sortTakenOpDeadlineEnTijd(filteredDay ? tasksRaw.filter(t=>t.deadline===filteredDay) : tasksRaw);
  host.innerHTML = `<div class="pwn-actions"><button class="btn primary" onclick="openTaskSheet(null,'pwn')">+ Nieuwe taak</button><button class="btn ghost" onclick="openTaskSheet(null,'pwn','',null,null,'subtaak')">+ Subtaak</button></div>`;
  if(filteredDay){
    host.innerHTML += `<div class="card">Taken op ${escapeHtml(filteredDay)} <button class="btn ghost" id="clearTaskDay">Alle taken tonen</button></div>`;
    document.getElementById('clearTaskDay').addEventListener('click', ()=>{
      const url = new URL(location.href); url.searchParams.delete('datum');
      history.replaceState(null,'',url); loadProjecten();
    });
  }
  if(!tasks.length){ host.innerHTML += '<div class="empty-state">Nog geen taken hier.</div>'; return; }
  const subtaken = tasks.filter(t=>t.taaktype==='subtaak' && t.status!=='klaar');
  const gewoneTaken = tasks.filter(t=>t.taaktype!=='subtaak');
  const secties = [
    {key:'taken', titel:'Taken', uitleg:'Nog te doen en mee bezig.', items:gewoneTaken.filter(t=>t.status==='backlog' || t.status==='bezig')},
    {key:'wacht_op', titel:'Wacht op iemand of iets', uitleg:statusUitleg.wacht_op, items:gewoneTaken.filter(t=>t.status==='wacht_op')},
    {key:'subtaken', titel:'🧩 Subtaken voor tussendoor', uitleg:'Kleine klussen zonder deadline.', items:subtaken},
    {key:'klaar', titel:'Klaar', uitleg:statusUitleg.klaar, items:tasks.filter(t=>t.status==='klaar')}
  ];
  host.insertAdjacentHTML('beforeend', secties.map(s=>`
    <details class="statuscol" data-sectie="${s.key}" ${takenSectieOpen(s.key) ? 'open' : ''}>
      <summary><span>${escapeHtml(s.titel)}<span class="uitleg">${escapeHtml(s.uitleg)}</span></span><span class="telling">${s.items.length}</span></summary>
      <div class="inhoud">${s.items.length ? s.items.map(taskCard).join('') : '<div class="empty-state">Niets hier.</div>'}</div>
    </details>`).join(''));
  host.querySelectorAll('details.statuscol').forEach(d=>{
    d.addEventListener('toggle', ()=>onthoudTakenSectie(d.dataset.sectie, d.open));
  });
}

function fmtTaakDatumTijd(t){
  if(!t.deadline) return '';
  const datum = new Date(`${t.deadline}T12:00:00`).toLocaleDateString('nl-NL',{day:'numeric',month:'short'});
  if(t.begin_tijd && t.eind_tijd) return `${datum} ${t.begin_tijd.slice(0,5)}–${t.eind_tijd.slice(0,5)}`;
  if(t.begin_tijd) return `${datum} ${t.begin_tijd.slice(0,5)}`;
  return datum;
}

function taskCard(t){
  return `
    <div class="card" onclick="openTaskSheet('${t.id}','${t.project}')">
      <div class="titel">${escapeHtml(t.titel)}</div>
      <div class="meta">
        <span class="badge ${t.status}">${statusLabels[t.status]}</span>
        ${t.taaktype==='subtaak' ? '<span class="badge subtaak">Subtaak</span>' : ''}
        ${isVasteTaak(t) ? `<span class="badge herhaling">🔁 ${herhalingLabels[t.herhaling]||escapeHtml(t.herhaling)}</span>` : ''}
        ${t.deadline ? `<span>📅 ${fmtTaakDatumTijd(t)}</span>` : ''}
        ${t.wie ? `<span>👤 ${escapeHtml(t.wie)}</span>` : ''}
        ${t.waar ? `<span>📍 ${escapeHtml(t.waar)}</span>` : ''}
      </div>
    </div>`;
}

function whatsappWakeVoorTaak({id, project, teamId, taaktype}){
  return !id && project === 'pwn' && !teamId && (taaktype || 'taak') === 'taak';
}

async function openTaskSheet(id, project, prefillTekst, dumpId, teamId, taaktype = 'taak'){
  let t = {titel:prefillTekst||'', waar:'', wie:'', bijlage_url:'', status:'backlog', deadline:'', notitie:'', project, taaktype};
  if(id){ const rows = await sb(`work_tasks?id=eq.${id}`); t = rows[0]; }
  if(!t) throw new Error('Taak niet gevonden; laad de lijst opnieuw');
  const linkedTeamId = t.team_id || teamId || null;
  const isTeam = !!linkedTeamId;

  openSheet(`
    <button class="closex" onclick="closeSheet()">✕</button>
    <h2>${id ? 'Taak bewerken' : t.taaktype==='subtaak' ? 'Nieuwe subtaak' : 'Nieuwe taak'} — ${isTeam ? 'Team / Pret' : '🔧 PWN'}</h2>
    ${isTeam ? '<p class="team-warning">Interne teamactie. Alleen neutrale informatie; geen medische details of privégegevens. Geen AI, bijlagen of Google-export voor deze taak.</p>' : ''}

    ${(!isTeam && !id && prefillTekst) ? `<div class="aihelp" id="aiHelpBox">
      💡 AI kan proberen Waar/Wie/Deadline uit deze tekst te halen.
      <div><button id="btnAiHelp">✨ AI-hulp gebruiken</button></div>
    </div>` : ''}

    <div class="field"><label>Wat</label><input type="text" id="fTitel" value="${escapeHtml(t.titel)}"></div>
    <div class="field"><label>📍 Waar (locatie/URL)</label><input type="text" id="fWaar" value="${escapeHtml(t.waar||'')}"></div>
    <div class="field"><label>👤 Wie (contactpersoon)</label><input type="text" id="fWie" value="${escapeHtml(t.wie||'')}"></div>
    ${t.taaktype==='subtaak' ? '<p class="hintje">Subtaken hebben bewust geen datum of tijd. Gebruik ze voor kleine klussen als je ruimte over hebt.</p>' : `
    <div class="field"><label>📅 Deadline</label><input type="date" id="fDeadline" value="${t.deadline||''}"></div>
    <div class="field"><label>⏰ Begintijd</label><input type="time" id="fBeginTijd" value="${(t.begin_tijd||'').slice(0,5)}"></div>
    <div class="field"><label>⏰ Eindtijd (optioneel)</label><input type="time" id="fEindTijd" value="${(t.eind_tijd||'').slice(0,5)}"></div>`}
    <div id="calLinkWrap"></div>
    <div class="field"><label>Status</label>
      <div class="segrow" id="statusRow">
        ${[['backlog','Taken'],['wacht_op','Wacht op iemand of iets'],['klaar','Klaar']].map(([s,label])=>`<button data-s="${s}" class="${(t.status===s || (s==='backlog' && t.status==='bezig'))?'sel':''}" onclick="pickStatus('${s}')">${label}</button>`).join('')}
      </div>
      <div class="statushelp" id="statusHelp">${escapeHtml(statusUitleg[t.status]||'')}</div>
    </div>
    ${!isTeam && t.taaktype!=='subtaak' ? `<div class="field"><label>🔁 Soort taak</label>
      <select id="fHerhaling">${Object.entries(herhalingLabels).map(([k,v])=>`<option value="${k}" ${(t.herhaling||'eenmalig')===k?'selected':''}>${k==='eenmalig'?'Eenmalige taak':'Vaste taak: '+v.toLowerCase()}</option>`).join('')}</select>
      <div class="statushelp">Vaste operatortaken staan apart bovenaan. Status Klaar = de vaste taak stopt.</div>
      ${id && isVasteTaak(t) && t.status!=='klaar' ? `<button class="btn ghost" id="btnDezeKeerGedaan" style="width:100%;margin-top:8px">✓ Deze keer gedaan${t.deadline ? ' (datum naar '+escapeHtml(volgendeDeadline(t.deadline,t.herhaling))+')' : ''}</button>` : ''}
    </div>` : ''}
    ${!isTeam ? `<div class="field"><label>📎 Bijlage (foto/document)</label>
      <input type="file" id="fBijlage" accept="image/*,.pdf">
      ${t.bijlage_url ? `<div style="margin-top:6px"><a href="${t.bijlage_url}" target="_blank" style="color:var(--teal); font-size:13px">huidige bijlage bekijken</a></div>` : ''}
    </div>` : ''}
    <div class="field"><label>Notitie</label><textarea id="fNotitie">${escapeHtml(t.notitie||'')}</textarea></div>
    ${isTeam ? '<label class="team-warning" style="display:block"><input type="checkbox" id="teamTaskPrivacy"> Gecontroleerd: neutrale teamactie, geen gevoelige details of onnodige persoonsgegevens.</label>' : ''}

    <div class="sheet-actions">
      ${id ? `<button class="btn danger" onclick="deleteTask('${id}',${isTeam})">Verwijder</button>` : ''}
      <button class="btn primary" id="btnSaveTask">Opslaan</button>
    </div>
    ${isTeam ? '<p id="teamTaskError" class="team-error" role="alert"></p>' : ''}
  `);
  window._taskStatus = t.status;
  window._taskBijlageUrl = t.bijlage_url || '';
  const teamTaskError=document.getElementById('teamTaskError');
  if(isTeam){
    Object.entries({fTitel:120,fWaar:200,fWie:120,fNotitie:2000}).forEach(([field,max])=>{
      const input=document.getElementById(field);
      input.maxLength=max;
      input.addEventListener('input',()=>{document.getElementById('teamTaskPrivacy').checked=false;});
    });
  }

  const aiBtn = document.getElementById('btnAiHelp');
  if(aiBtn) aiBtn.addEventListener('click', ()=>aiVulTaakIn(prefillTekst));

  function renderCalLink(){
    const wrap = document.getElementById('calLinkWrap');
    if(isTeam){wrap.textContent='Teamacties blijven in WerkHub. Eventuele bestaande algemene herinneringen bevatten geen taakinformatie.';return;}
    if(t.taaktype==='subtaak'){wrap.textContent='';return;}
    const datum = document.getElementById('fDeadline').value;
    const begin = document.getElementById('fBeginTijd').value;
    const eind = document.getElementById('fEindTijd').value;
    if(!datum || !begin || !eind || eind <= begin){
      wrap.innerHTML = '<p style="font-size:12px; color:var(--sub)">Voor Google Calendar: vul datum, begintijd en een latere eindtijd in. Geen automatische synchronisatie; stel de herinnering in Google zelf in.</p>';
      return;
    }
    const titel = document.getElementById('fTitel').value.trim() || 'Taak';
    const waar = document.getElementById('fWaar').value.trim();
    const startStr = `${datum.replace(/-/g,'')}T${begin.replace(':','')}00`;
    const eindDatumTijd = `${datum.replace(/-/g,'')}T${eind.replace(':','')}00`;
    const url = new URL('https://calendar.google.com/calendar/render');
    url.searchParams.set('action','TEMPLATE');
    url.searchParams.set('text', titel);
    url.searchParams.set('dates', `${startStr}/${eindDatumTijd}`);
    if(waar) url.searchParams.set('location', waar);
    url.searchParams.set('ctz','Europe/Amsterdam');
    wrap.innerHTML = `<div class="field"><a class="btn ghost" style="display:block; text-align:center; text-decoration:none" href="${escapeHtml(url.toString())}" target="_blank" rel="noopener noreferrer">📅 Toevoegen aan Google Calendar</a><p style="font-size:12px; color:var(--sub)">Opent Google met titel, locatie en tijden. Controleer en sla daar op; geen automatische synchronisatie of ingestelde herinnering.</p></div>`;
  }
  ['fDeadline','fBeginTijd','fEindTijd','fTitel','fWaar'].forEach(elId=>{
    document.getElementById(elId)?.addEventListener('input', renderCalLink);
  });
  renderCalLink();

  const dezeKeerBtn = document.getElementById('btnDezeKeerGedaan');
  if(dezeKeerBtn) dezeKeerBtn.addEventListener('click', ()=>{
    const deadlineEl = document.getElementById('fDeadline');
    if(deadlineEl.value) deadlineEl.value = volgendeDeadline(deadlineEl.value, document.getElementById('fHerhaling').value);
    pickStatus('backlog');
    document.getElementById('btnSaveTask').click();
  });

  document.getElementById('btnSaveTask').addEventListener('click', async ()=>{
    const btn = document.getElementById('btnSaveTask');
    if(btn.disabled) return;
    const beginTijd = document.getElementById('fBeginTijd')?.value || '';
    const eindTijd = document.getElementById('fEindTijd')?.value || '';
    if(beginTijd && !document.getElementById('fDeadline')?.value){ toast('Vul een datum in bij de begintijd'); return; }
    if(eindTijd && !beginTijd){ toast('Vul ook een begintijd in bij een eindtijd'); return; }
    if(beginTijd && eindTijd && eindTijd <= beginTijd){ toast('Eindtijd moet na de begintijd liggen (zelfde dag)'); return; }
    const payload = {
      project, titel: document.getElementById('fTitel').value.trim(),
      waar: document.getElementById('fWaar').value.trim(),
      wie: document.getElementById('fWie').value.trim(),
      deadline: document.getElementById('fDeadline')?.value || null,
      status: window._taskStatus === 'bezig' ? 'backlog' : window._taskStatus,
      notitie: document.getElementById('fNotitie').value.trim(),
      bijlage_url: window._taskBijlageUrl,
      updated_at: new Date().toISOString()
    };
    if(!payload.titel){ toast('Vul iets in bij "Wat"'); return; }
    if(!isTeam && (t.taaktype==='subtaak' || t.taaktype!==undefined)) payload.taaktype = t.taaktype || 'taak';
    const herhalingEl = document.getElementById('fHerhaling');
    const herhaling = herhalingEl ? herhalingEl.value : 'eenmalig';
    // Only send herhaling when used, so the app keeps working before TAKEN-HERHALING-MIGRATIE.sql.
    const herhalingMeesturen = !isTeam && (herhaling !== 'eenmalig' || (id && t.herhaling !== undefined));
    if(herhalingMeesturen) payload.herhaling = herhaling;
    if(isTeam){
      try{
        if(!document.getElementById('teamTaskPrivacy').checked) throw new Error('Bevestig eerst de privacycontrole van deze teamactie');
        validateTeamTask(payload);
        payload.team_id = linkedTeamId;
      }catch(error){
        teamTaskError.textContent=error.message;return;
      }
    }
    // Keep untimed tasks writable before the optional time-column migration.
    const tijdenMeesturen = !!beginTijd || !!eindTijd || (id && (t.begin_tijd || t.eind_tijd));
    if(tijdenMeesturen){
      payload.begin_tijd = beginTijd || null;
      payload.eind_tijd = eindTijd || null;
    }
    btn.disabled = true;
    let wakeWhatsApp = false;
    try{
      const fileInput = document.getElementById('fBijlage');
      if(fileInput && fileInput.files[0]){
        toast('Bijlage uploaden…');
        payload.bijlage_url = await uploadFoto(fileInput.files[0]);
        window._taskBijlageUrl = payload.bijlage_url;
      }
      if(id){
        const rows=await sb(`work_tasks?id=eq.${id}`, {method:'PATCH', body: JSON.stringify(payload)});
        if(isTeam && (!Array.isArray(rows) || rows.length!==1)) throw new Error('Geen teamactie gewijzigd; controleer toegang en laad opnieuw');
      }else{
        const rows=await sb('work_tasks', {method:'POST', body: JSON.stringify(payload)});
        if(isTeam && (!Array.isArray(rows) || rows.length!==1)) throw new Error('Geen teamactie opgeslagen; controleer toegang en laad opnieuw');
        wakeWhatsApp = whatsappWakeVoorTaak({
          id, project, teamId: linkedTeamId, taaktype: payload.taaktype,
        });
        if(dumpId) await sb(`work_items?id=eq.${dumpId}`, {method:'PATCH', body: JSON.stringify({gesorteerd:true})});
      }
    }catch(err){
      const msg = (err && err.message) || '';
      if(isTeam) teamTaskError.textContent='Opslaan mislukt: '+(msg || 'onbekende fout');
      if(tijdenMeesturen && /(?:begin_tijd|eind_tijd)/i.test(msg) && /(?:does not exist|could not find|schema cache)/i.test(msg)){
        toast('Kan tijd niet opslaan: voer eerst TAAKTIJDEN-MIGRATIE.sql uit in Supabase.');
      }else if(herhalingMeesturen && /herhaling/i.test(msg) && /(?:does not exist|could not find|schema cache)/i.test(msg)){
        toast('Kan vaste taak niet opslaan: voer eerst TAKEN-HERHALING-MIGRATIE.sql uit in Supabase.');
      }else if(payload.taaktype==='subtaak' && /taaktype/i.test(msg) && /(?:does not exist|could not find|schema cache)/i.test(msg)){
        toast('Kan subtaak niet opslaan: voer eerst TAKEN-SUBTAKEN-MIGRATIE.sql uit in Supabase.');
      }else{
        toast('Opslaan mislukt: ' + (msg || 'onbekende fout'));
      }
      return;
    }finally{
      btn.disabled = false;
    }
    if(!isTeam || btn.isConnected) closeSheet();
    toast('Opgeslagen');
    if(isTeam) loadTeam();
    else { loadProjecten(); loadDumpSubtaken(); }
    if(wakeWhatsApp){
      reminderApi('dispatch-whatsapp', {}).catch(error=>{
        console.warn('WerkHub WhatsApp wake-up mislukt', error?.message || 'request_failed');
        toast('Taak opgeslagen; WhatsApp volgt via de automatische controle.');
      });
    }
  });
}
function pickStatus(s){
  window._taskStatus = s;
  document.querySelectorAll('#statusRow button').forEach(b=>b.classList.toggle('sel', b.dataset.s===s));
  const help = document.getElementById('statusHelp');
  if(help) help.textContent = statusUitleg[s] || '';
}
async function deleteTask(id, linked=false){
  if(linked && !confirm('Deze teamactie verwijderen?')) return;
  try{
    const rows=await sb(`work_tasks?id=eq.${id}`, {method:'DELETE'});
    if(linked && (!Array.isArray(rows) || rows.length!==1)) throw new Error('Geen teamactie verwijderd; controleer toegang en laad opnieuw');
  }catch(error){
    toast('Verwijderen mislukt: '+error.message);
    if(linked) document.getElementById('teamTaskError').textContent='Verwijderen mislukt: '+error.message;
    return;
  }
  closeSheet(); toast('Verwijderd');
  if(linked) loadTeam();
  else { loadProjecten(); loadDumpSubtaken(); }
}

async function aiVulTaakIn(tekst){
  const box = document.getElementById('aiHelpBox');
  box.innerHTML = '⏳ Bezig met analyseren…';
  try{
    const data = await aiMessages({
      model: AI_MODEL, max_tokens: 200,
      system: 'Je haalt uit een korte Nederlandse werknotitie de velden Waar (locatie of URL), Wie (contactpersoon of bedrijf) en Deadline (datum in formaat YYYY-MM-DD, alleen als expliciet genoemd of duidelijk afleidbaar, anders leeg) en een korte titel (max 6 woorden). Antwoord UITSLUITEND met geldige JSON: {"titel":"...","waar":"...","wie":"...","deadline":"..."}. Onbekende velden: lege string.',
      messages:[{role:'user', content: tekst.slice(0,500)}]
    });
    const raw = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');
    if(parsed.titel) document.getElementById('fTitel').value = parsed.titel;
    if(parsed.waar) document.getElementById('fWaar').value = parsed.waar;
    if(parsed.wie) document.getElementById('fWie').value = parsed.wie;
    if(parsed.deadline) document.getElementById('fDeadline').value = parsed.deadline;
    box.innerHTML = '✅ Velden ingevuld — check en pas aan waar nodig.';
  }catch(e){
    box.innerHTML = '⚠️ AI-hulp lukte niet. Vul handmatig in.';
  }
}
