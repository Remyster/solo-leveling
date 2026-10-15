// ============ VANDAAG TAB ============
// ============ AGENDA (via edge function werkhub-agenda, geen Google-iframe/cookies) ============
let agendaGeladenOm = 0;
async function loadAgenda(force=false){
  const lijst = document.getElementById('agendaLijst');
  const status = document.getElementById('agendaStatus');
  if(!lijst) return;
  if(!force && Date.now() - agendaGeladenOm < 5*60*1000) return;
  if(!(await requireAuth())){ status.textContent = 'Log in om je agenda te zien.'; return; }
  try{
    const res = await fetch(`${SB_URL}/functions/v1/werkhub-agenda?days=14`, {
      cache:'no-store', headers:{ 'apikey': SB_KEY, 'Authorization': `Bearer ${getAccessToken()}` }
    });
    const data = await res.json().catch(()=>({}));
    if(res.status === 503){
      lijst.innerHTML = '<p class="agenda-leeg">Agenda nog niet ingesteld: zet je geheime iCal-adres in Supabase als secret <b>AGENDA_ICS_URLS</b>.</p>';
      status.textContent = '';
      return;
    }
    if(!res.ok || !Array.isArray(data.items)) throw new Error(data.error || `HTTP ${res.status}`);
    agendaGeladenOm = Date.now();
    const dag = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const tijd = d => d.toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit'});
    const vandaag = dag(new Date()), morgen = dag(new Date(Date.now()+864e5));
    const groepen = new Map();
    for(const item of data.items){
      const start = item.allDay ? new Date(item.start+'T00:00:00') : new Date(item.start);
      const eind = item.allDay ? new Date(item.end+'T00:00:00') : new Date(item.end);
      const key = dag(start);
      if(!groepen.has(key)) groepen.set(key, []);
      groepen.get(key).push({...item, start, eind});
    }
    const nu = Date.now();
    lijst.innerHTML = groepen.size ? [...groepen.entries()].map(([key, items]) => `
      <div class="agenda-dag"><div class="agenda-kop">${key===vandaag?'Vandaag':key===morgen?'Morgen':escapeHtml(items[0].start.toLocaleDateString('nl-NL',{weekday:'long', day:'numeric', month:'long'}))}</div>
      ${items.map(i => `<div class="agenda-item${!i.allDay && i.start<=nu && i.eind>nu ? ' nu' : ''}"><span class="agenda-tijd">${i.allDay ? 'hele dag' : tijd(i.start)+'–'+tijd(i.eind)}</span><span>${escapeHtml(i.title)}${i.location||i.calendar ? `<small>${escapeHtml([i.location, i.calendar].filter(Boolean).join(' · '))}</small>` : ''}</span></div>`).join('')}</div>`).join('')
      : '<p class="agenda-leeg">Geen afspraken de komende twee weken.</p>';
    status.textContent = `Bijgewerkt ${tijd(new Date())}` + (data.errors && data.errors.length ? ` · let op: ${data.errors.join('; ')}` : '');
  }catch(error){
    status.textContent = 'Agenda laden mislukt: ' + (error.message || error);
  }
}

async function loadVandaag(){
  loadAgenda();
  const [wkStart, wkEind] = weekBereik();
  const [tasks, dumps, uren] = await Promise.all([
    sb('work_tasks?status=neq.klaar&order=deadline.asc.nullslast'),
    sb('work_items?gesorteerd=eq.false&urgent=eq.true&order=created_at.desc'),
    sb(`work_load?select=code,uren,datum&datum=gte.${isoDatum(wkStart)}&datum=lte.${isoDatum(wkEind)}`)
  ]);

  const totaalUren = uren.reduce((s,r)=>s + Number(r.uren||0), 0);
  const perCode = urenPerCode(uren).slice(0,3).map(([c,u])=>`${c} ${fmtUren(u)}`).join(' · ');
  document.getElementById('wUren').innerHTML = totaalUren
    ? `${fmtUren(totaalUren)} u${perCode ? ` <span style="color:#cfe3f5">— ${escapeHtml(perCode)}</span>` : ''}`
    : '<span class="empty">nog niks geboekt</span>';
  const volgende = volgendeTaakVoorVandaag(tasks);
  document.getElementById('wDeadline').innerHTML = volgende
    ? `${escapeHtml(volgende.titel)} — ${fmtTaakDatumTijd(volgende)}`
    : '<span class="empty">geen deadlines</span>';

  const actief = tasks.find(t=>t.status==='bezig') || tasks.find(t=>t.status==='backlog' && t.taaktype!=='subtaak');
  document.getElementById('wActief').innerHTML = actief
    ? escapeHtml(actief.titel) : '<span class="empty">geen open taak</span>';

  const subtaken = tasks.filter(t=>t.taaktype==='subtaak' && t.status!=='klaar');
  document.getElementById('wSubtaken').innerHTML = subtaken.length
    ? `${subtaken.length} beschikbaar · ${escapeHtml(subtaken[0].titel)}`
    : '<span class="empty">geen subtaken</span>';

  document.getElementById('wUrgent').innerHTML = dumps.length
    ? escapeHtml(dumps[0].tekst||'(foto)') : '<span class="empty">geen urgente dumps</span>';

  document.getElementById('urenReminder').classList.toggle('hidden', !urenHerinneringNodig(uren));
}

document.querySelectorAll('[data-go]').forEach(button=>button.addEventListener('click',()=>switchTab(button.dataset.go)));

function volgendeTaakVoorVandaag(tasks, now = new Date()){
  const vandaag = isoDatum(now);
  const tijd = now.toTimeString().slice(0,5);
  const vandaagTaken = sortTakenOpDeadlineEnTijd(tasks.filter(t=>t.status!=='klaar' && t.deadline===vandaag && t.taaktype!=='subtaak'));
  const komende = vandaagTaken.filter(t=>!t.begin_tijd || t.begin_tijd.slice(0,5)>=tijd);
  if(komende.length) return komende[0];
  if(vandaagTaken.length) return vandaagTaken[0];
  return sortTakenOpDeadlineEnTijd(tasks.filter(t=>t.status!=='klaar' && t.deadline && t.taaktype!=='subtaak'))[0] || null;
}

function urenHerinneringNodig(uren, now = new Date()){
  const werkdag = now.getDay()>=1 && now.getDay()<=5;
  if(!werkdag || now.getHours()<15) return false;
  const vandaag = isoDatum(now);
  return uren.filter(r=>r.datum===vandaag).reduce((sum,row)=>sum+Number(row.uren||0),0)===0;
}
