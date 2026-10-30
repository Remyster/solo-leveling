// ============ DUMP TAB ============
// v31: de Dump sorteert zichzelf. Je gooit iets erin (tekst, spraak, link, foto), AI stelt
// voor waar het hoort en jij tikt ✓. Taken en subtaken gaan naar PWN, kopen blijft hier in
// de Kopen-lijst, een notitie wordt een schriftblad in de Werkplek (map "📥 Uit de Dump").
// Wat nog geen plek heeft blijft in "Nog te sorteren". Leeg = alles verwerkt.
let dumpItems = [];
// Oude lijstjes (AKF/DWAT, UF-RO, LAB) bestaan nog in de database maar zijn geen keuze meer:
// die mappen staan in de Werkplek. Een oud item met zo'n lijstje verschijnt onder Nog te sorteren.
const DUMP_CATEGORIEEN = {inbox:'Inbox', kopen:'Kopen', akf_dwat:'AKF/DWAT', uf_ro:'UF-RO', lab:'LAB/Analyseruimte'};
const DUMP_BESTEMMINGEN = [
  ['urgent',     '🔥 Doen (urgent + belangrijk)'],
  ['belangrijk', '📌 Plannen (belangrijk)'],
  ['delegeren',  '🤝 Delegeren (urgent, niet belangrijk)'],
  ['subtaak',    '🧩 Rest (tussendoor)'],
  ['kopen',      '🛒 Kopen'],
  ['notitie',    '📝 Notitie → Werkmap'],
  ['inbox',      '📥 Later sorteren']
];
const DUMP_WERKMAP_MAP = '📥 Uit de Dump';

document.getElementById('dumpTekst').addEventListener('click', ()=>openDumpSheet('tekst'));
document.getElementById('dumpLink').addEventListener('click', ()=>openDumpSheet('link'));
document.getElementById('fabDump').addEventListener('click', ()=>openDumpSheet('tekst'));
document.getElementById('dumpFoto').addEventListener('click', ()=>document.getElementById('fotoInput').click());
document.getElementById('fotoInput').addEventListener('change', async e=>{
  const file = e.target.files[0];
  if(!file) return;
  toast('Foto uploaden…');
  try{
    const url = await uploadFoto(file);
    openDumpSheet('foto', {tekst:'', foto_url:url});
  }catch(err){ toast('Upload mislukt: ' + err.message); }
  e.target.value='';
});

document.getElementById('dumpSpraak').addEventListener('click', ()=>{
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ openDumpSheet('spraak'); return; }
  const rec = new SR();
  rec.lang = 'nl-NL';
  rec.onresult = async (ev)=>{
    const tekst = ev.results[0][0].transcript;
    openDumpSheet('spraak', {tekst});
  };
  rec.onerror = ()=>openDumpSheet('spraak');
  rec.start();
});

function lokaalDatumTijd(value){
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}

// ---- AI: waar hoort dit? ----
// Eén goedkope Haiku-call via de bestaande ai-proxy. Gaat het mis, dan blijft de keuze op
// "Later sorteren" en kun je zelf kiezen: de Dump werkt dus ook zonder AI.
async function dumpAiVoorstel(tekst){
  const data = await aiMessages({
    model: AI_MODEL, max_tokens: 1024, output_config: AI_OPTS,
    system: `Vandaag is ${isoDatum(new Date())}. Je sorteert een snelle notitie van Remy, operator/monteur bij drinkwaterbedrijf PWN, die hij onderweg op zijn telefoon heeft ingesproken of getypt. Kies precies één bestemming:
- "urgent": urgent én belangrijk, zelf doen: zo snel mogelijk (storing, vandaag/morgen, iemand wacht erop).
- "belangrijk": belangrijk maar niet urgent: moet gebeuren en krijgt een moment in de agenda.
- "delegeren": moet snel maar is niet belangrijk voor Remy zelf: kan iemand anders doen (doorsturen, iemand vragen).
- "subtaak": niet urgent, niet belangrijk: klein klusje voor tussendoor, geen datum.
- "kopen": iets wat gekocht of besteld moet worden.
- "notitie": informatie om te bewaren (meetwaarde, uitleg, idee, gespreksnotitie), geen actie.
- "inbox": alleen als het echt onduidelijk is.
Antwoord UITSLUITEND met geldige JSON: {"bestemming":"...","titel":"korte titel, max 8 woorden","deadline":"YYYY-MM-DD of leeg","waar":"locatie of leeg","wie":"persoon/bedrijf of leeg","reden":"één korte zin waarom"}. Deadline alleen als die expliciet genoemd of duidelijk af te leiden is.`,
    messages:[{role:'user', content: tekst.slice(0,1500)}]
  });
  const raw = aiTekst(data) || '{}';
  const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');
  const geldig = DUMP_BESTEMMINGEN.map(([k])=>k);
  return {
    bestemming: geldig.includes(j.bestemming) ? j.bestemming : 'inbox',
    titel: String(j.titel||'').slice(0,120),
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(j.deadline||'') ? j.deadline : '',
    waar: String(j.waar||'').slice(0,200),
    wie: String(j.wie||'').slice(0,120),
    reden: String(j.reden||'').slice(0,200)
  };
}

function dumpTitelUit(tekst){
  const eerste = String(tekst||'').trim().split(/\n|[.!?](\s|$)/)[0] || '';
  return eerste.length > 80 ? eerste.slice(0,77).trimEnd()+'…' : eerste;
}

// Het schriftblad dat de Werkplek bij de volgende sync binnenhaalt. Nieuw id, dus het kan nooit
// een bestaand schrift overschrijven; de Werkplek controleert het met M.validate en maakt de
// map "📥 Uit de Dump" zelf aan als die er nog niet is.
function dumpWerkplekBlad(titel, tekst, item){
  const id = crypto.randomUUID();
  const datum = new Date().toLocaleString('nl-NL',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const regels = [tekst.trim(), '', `Uit de WerkHub-dump · ${datum}`];
  if(item.foto_url) regels.push(`Foto: ${item.foto_url}`);
  const doc = {id, kind:'page', title:titel.slice(0,120), text:'', strokes:[], pages:1,
    view:{x:0,y:0,scale:1}, textBlocks:[{x:60, y:80, text:regels.join('\n').slice(0,20000)}]};
  return {id, kind:'page', title:doc.title, folder_title:DUMP_WERKMAP_MAP, data:doc};
}

function openDumpSheet(type, item = {}){
  const labels = {tekst:'📝 Tekst', link:'🔗 Link', spraak:'🎙️ Spraaknotitie', foto:'📷 Foto'};
  const bestaand = !!item.id;
  const startKeuze = item.categorie==='kopen' ? 'kopen' : 'inbox';
  openSheet(`
    <button class="closex" onclick="closeSheet()">✕</button>
    <h2>${labels[type]||type}</h2>
    ${item.foto_url ? `<p class="hintje"><a href="${item.foto_url}" target="_blank" rel="noopener" style="color:var(--teal)">📷 foto bekijken</a></p>` : ''}
    <div class="field"><textarea id="dumpTekstVal" placeholder="${type==='link' ? 'Plak de link…' : type==='foto' ? 'Wat staat erop? (optioneel)' : 'Typ of spreek het even in…'}" autofocus>${escapeHtml(item.tekst||'')}</textarea></div>
    <div class="field"><label>Waar hoort het?</label>
      <div class="segrow dumpkeuze" id="dumpKeuzeRow">
        ${DUMP_BESTEMMINGEN.map(([k,l])=>`<button type="button" data-k="${k}" class="${k===startKeuze?'sel':''}">${l}</button>`).join('')}
      </div>
      <div class="statushelp" id="dumpAiStatus"></div>
    </div>
    <div id="dumpTaakVelden" class="hidden">
      <div class="field"><label>Titel</label><input type="text" id="dumpTitelVal" maxlength="120"></div>
      <div class="field" id="dumpDeadlineVeld"><label>📅 Deadline (optioneel)</label><input type="date" id="dumpDeadlineVal"></div>
    </div>
    <div id="dumpLaterVelden">
      <div class="field"><label>Herinner me op (optioneel)</label>
        <input type="datetime-local" id="dumpHerinnerVal" value="${item.herinner_at ? lokaalDatumTijd(item.herinner_at) : ''}">
        <p class="hintje">Op dit tijdstip, niet 45 minuten vooraf. Verzending kan tot ongeveer 5 minuten later zijn. Gebruik je ingestelde e-mail- en/of pushkanaal.</p>
      </div>
    </div>
    <div class="sheet-actions">
      <button class="btn ghost" onclick="closeSheet()">Annuleren</button>
      <button class="btn primary" id="dumpSaveBtn">✓ Opslaan</button>
    </div>
  `);

  let keuze = startKeuze;
  let zelfGekozen = bestaand && item.categorie==='kopen';
  let voorstel = null;
  const tekstEl = document.getElementById('dumpTekstVal');
  const status = document.getElementById('dumpAiStatus');

  function toonVelden(){
    const taakAchtig = ['urgent','belangrijk','delegeren','subtaak','notitie'].includes(keuze);
    document.getElementById('dumpTaakVelden').classList.toggle('hidden', !taakAchtig);
    document.getElementById('dumpDeadlineVeld').classList.toggle('hidden', !['urgent','belangrijk'].includes(keuze));
    document.getElementById('dumpLaterVelden').classList.toggle('hidden', taakAchtig);
    const titelEl = document.getElementById('dumpTitelVal');
    if(taakAchtig && !titelEl.value) titelEl.value = voorstel?.titel || dumpTitelUit(tekstEl.value);
  }
  function kies(k, doorMij){
    keuze = k;
    if(doorMij) zelfGekozen = true;
    document.querySelectorAll('#dumpKeuzeRow button').forEach(b=>b.classList.toggle('sel', b.dataset.k===k));
    toonVelden();
  }
  document.getElementById('dumpKeuzeRow').addEventListener('click', e=>{
    const b = e.target.closest('button[data-k]');
    if(b) kies(b.dataset.k, true);
  });

  let aiTimer = null, aiVoor = '';
  async function vraagAi(){
    const tekst = tekstEl.value.trim();
    if(tekst.length < 3 || tekst === aiVoor) return;
    aiVoor = tekst;
    status.textContent = '✨ AI kijkt waar dit hoort…';
    try{
      const v = await dumpAiVoorstel(tekst);
      if(tekstEl.value.trim() !== tekst || !document.getElementById('dumpSaveBtn')) return; // intussen veranderd of gesloten
      voorstel = v;
      const label = DUMP_BESTEMMINGEN.find(([k])=>k===v.bestemming)[1];
      status.textContent = `✨ AI denkt: ${label}${v.reden ? ' — '+v.reden : ''}${zelfGekozen ? ' (jouw keuze blijft staan)' : ''}`;
      const titelEl = document.getElementById('dumpTitelVal');
      if(v.titel) titelEl.value = v.titel;
      if(v.deadline) document.getElementById('dumpDeadlineVal').value = v.deadline;
      if(!zelfGekozen) kies(v.bestemming, false);
    }catch(error){
      status.textContent = 'AI-voorstel lukte niet; kies zelf waar het hoort.';
    }
  }
  tekstEl.addEventListener('input', ()=>{ clearTimeout(aiTimer); aiTimer = setTimeout(vraagAi, 1200); });
  toonVelden();
  if(tekstEl.value.trim()) vraagAi();

  document.getElementById('dumpSaveBtn').addEventListener('click', async ()=>{
    const tekst = tekstEl.value.trim();
    if(!tekst && !item.foto_url){ toast('Vul iets in om te onthouden'); return; }
    const btn = document.getElementById('dumpSaveBtn');
    btn.disabled = true;
    try{
      const doel = await dumpVerwerk({type, item, tekst, keuze, voorstel,
        titel: document.getElementById('dumpTitelVal').value.trim(),
        deadline: document.getElementById('dumpDeadlineVal').value,
        herinnerVeld: document.getElementById('dumpHerinnerVal').value});
      closeSheet();
      toast(doel);
      loadDump(); loadVandaag();
      if(typeof loadProjecten==='function') loadProjecten();
    }catch(error){ toast('Opslaan mislukt: ' + error.message); }
    finally{ if(btn.isConnected) btn.disabled = false; }
  });
}

// Eerst de bestemming aanmaken, pas daarna de dump als verwerkt markeren. Mislukt de
// bestemming, dan blijft de dump gewoon staan: er gaat nooit iets verloren.
async function dumpVerwerk({type, item, tekst, keuze, voorstel, titel, deadline, herinnerVeld}){
  const tekstOfFoto = tekst || '(foto)';
  // Spoor in work_items: bij een bestaande dump alleen gesorteerd + verwerkt_als, zodat het
  // oude lijstje, de tekst en een ingestelde herinnering gewoon blijven staan.
  const markeer = async (verwerkt_als)=>{
    if(item.id) await sb(`work_items?id=eq.${item.id}`, {method:'PATCH', body:JSON.stringify({gesorteerd:true, verwerkt_als})});
    else await sb('work_items', {method:'POST', body:JSON.stringify({type, tekst:tekstOfFoto, foto_url:item.foto_url||null, urgent:false, categorie:'inbox', gesorteerd:true, verwerkt_als})});
  };

  if(['urgent','belangrijk','delegeren','subtaak'].includes(keuze)){
    const subtaak = keuze==='subtaak' || keuze==='delegeren';
    const payload = {project:'pwn', titel: titel || dumpTitelUit(tekstOfFoto) || 'Taak uit de dump',
      waar: voorstel?.waar || '', wie: voorstel?.wie || '', status:'backlog',
      taaktype: subtaak ? 'subtaak' : 'taak', deadline: subtaak ? null : (deadline || null),
      notitie: tekst, bijlage_url: item.foto_url || '', updated_at: new Date().toISOString()};
    if(!subtaak) payload.prioriteit = keuze;
    if(keuze==='delegeren') payload.prioriteit = 'delegeren';
    await sb('work_tasks', {method:'POST', body:JSON.stringify(payload)});
    await markeer(subtaak ? 'subtaak' : 'taak');
    if(!subtaak && whatsappWakeVoorTaak({id:null, project:'pwn', teamId:null, taaktype:'taak'})){
      reminderApi('dispatch-whatsapp', {}).catch(error=>console.warn('WerkHub WhatsApp wake-up mislukt', error?.message || 'request_failed'));
    }
    return keuze==='delegeren' ? '🤝 Toegevoegd bij Delegeren' : subtaak ? '🧩 Toegevoegd bij Rest' : (keuze==='urgent' ? '🔥 Toegevoegd bij Doen' : '📌 Toegevoegd bij Plannen');
  }

  if(keuze==='notitie'){
    const rij = dumpWerkplekBlad(titel || dumpTitelUit(tekstOfFoto) || 'Notitie uit de dump', tekstOfFoto, item);
    await sb('werkplek_documents', {method:'POST', body:JSON.stringify([rij])});
    await markeer('notitie');
    return `📝 In je Werkmap gezet (${DUMP_WERKMAP_MAP})`;
  }

  // kopen of later sorteren: blijft in work_items, met eventuele herinnering
  const herinner_at = herinnerVeld
    ? (item.herinner_at && herinnerVeld === lokaalDatumTijd(item.herinner_at) ? item.herinner_at : new Date(herinnerVeld).toISOString())
    : null;
  const herinneringGewijzigd = herinner_at !== (item.herinner_at || null);
  if(herinneringGewijzigd && herinner_at && new Date(herinner_at).getTime() <= Date.now()) throw new Error('Kies een tijdstip in de toekomst');
  if(herinner_at && herinneringGewijzigd){
    const status = await reminderApi('status');
    if(!status.settings?.task_email && !status.settings?.task_push)
      throw new Error('Zet eerst e-mail of push aan via Instellingen > Herinneringen');
    if(status.settings?.task_push && !status.settings?.task_email && !status.subscriptions)
      throw new Error('Registreer eerst je iPhone via Instellingen > Herinneringen');
  }
  const categorie = keuze==='kopen' ? 'kopen' : ((item.categorie && item.categorie!=='kopen') ? item.categorie : 'inbox');
  const payload = {type, tekst:tekstOfFoto, urgent:!!item.urgent, categorie, herinner_at, gesorteerd:false,
    verwerkt_als: keuze==='kopen' ? 'kopen' : null,
    herinner_user_id: herinner_at ? getAuthSession()?.user?.id : null};
  if(herinner_at && !payload.herinner_user_id) throw new Error('Log opnieuw in voordat je een herinnering opslaat');
  if(item.foto_url) payload.foto_url = item.foto_url;
  await sb(item.id ? `work_items?id=eq.${item.id}` : 'work_items', {method:item.id?'PATCH':'POST', body:JSON.stringify(payload)});
  return keuze==='kopen' ? '🛒 Op je kooplijst' : '📥 Bewaard om later te sorteren';
}

function dumpKaart(it, metSorteer){
  return `
    <div class="card">
      <div class="titel">${iconVoorType(it.type)} ${escapeHtml(it.tekst||'')}</div>
      ${it.foto_url ? `<div class="meta"><a href="${it.foto_url}" target="_blank" style="color:var(--teal)">bekijk foto</a></div>` : ''}
      <div class="meta">
        ${it.urgent ? '<span class="badge urgent">🔥 urgent</span>' : ''}
        ${(it.categorie && !['inbox','kopen'].includes(it.categorie)) ? `<span class="badge">${escapeHtml(DUMP_CATEGORIEEN[it.categorie]||it.categorie)}</span>` : ''}
        ${it.herinner_at ? `<span>⏰ ${escapeHtml(new Date(it.herinner_at).toLocaleString('nl-NL'))}</span>` : ''}
        <span>${new Date(it.created_at).toLocaleDateString('nl-NL',{day:'numeric',month:'short'})}</span>
      </div>
      <div class="sheet-actions" style="margin-top:10px">
        ${metSorteer
          ? `<button class="btn primary" onclick="bewerkDump('${it.id}')">✨ Sorteer</button>`
          : `<button class="btn ghost" onclick="bewerkDump('${it.id}')">Bewerk</button>`}
        <button class="btn ghost" onclick="archiveerDump('${it.id}')">${metSorteer ? 'Weg ermee' : '✓ Gekocht'}</button>
      </div>
    </div>`;
}

async function loadDump(){
  const list = document.getElementById('dumpList');
  const kopenList = document.getElementById('dumpKopenList');
  list.innerHTML = '<div class="empty-state">Laden…</div>';
  try{
    dumpItems = await sb('work_items?gesorteerd=eq.false&order=created_at.desc');
  }catch(error){
    list.textContent = 'Dump laden mislukt: ' + error.message;
    return;
  }
  const teSorteren = dumpItems.filter(it=>(it.categorie||'inbox')!=='kopen');
  const kopen = dumpItems.filter(it=>it.categorie==='kopen');
  document.getElementById('dumpTeSorterenTelling').textContent = teSorteren.length ? String(teSorteren.length) : '';
  list.innerHTML = teSorteren.length
    ? teSorteren.map(it=>dumpKaart(it, true)).join('')
    : '<div class="empty-state">Alles verwerkt. Lekker leeg 🙂</div>';
  document.getElementById('dumpKopenTelling').textContent = String(kopen.length);
  kopenList.innerHTML = kopen.length
    ? kopen.map(it=>dumpKaart(it, false)).join('')
    : '<div class="empty-state">Niks te kopen.</div>';
}
// ---- Subtaken in de Dump: kleine klussen zonder datum (work_tasks.taaktype = 'subtaak') ----
async function loadDumpSubtaken(){
  const lijst = document.getElementById('dumpSubtakenList');
  const telling = document.getElementById('dumpSubtakenTelling');
  if(!lijst) return;
  const sectie = document.getElementById('dumpSubtaken');
  if(!sectie.dataset.init){ sectie.dataset.init = '1'; sectie.open = takenSectieOpen('dumpSubtaken'); }
  let rows;
  try{
    rows = await sb('work_tasks?project=eq.pwn&taaktype=eq.subtaak&status=neq.klaar&order=created_at.desc');
  }catch(error){
    telling.textContent = '!';
    lijst.innerHTML = /taaktype/i.test(error.message||'')
      ? '<div class="empty-state">Subtaken zijn nog niet aangezet: voer TAKEN-SUBTAKEN-MIGRATIE.sql uit in Supabase.</div>'
      : `<div class="empty-state">Subtaken laden mislukt: ${escapeHtml(error.message||'onbekende fout')}</div>`;
    return;
  }
  telling.textContent = String(rows.length);
  if(!rows.length){ lijst.innerHTML = '<div class="empty-state">Geen subtaken. Voeg er hierboven één toe.</div>'; return; }
  lijst.innerHTML = rows.map(t=>`
    <div class="card subtaak-kaart">
      <div class="titel" onclick="openTaskSheet('${t.id}','pwn')">${escapeHtml(t.titel)}
        ${t.belangrijk_vanaf ? `<div class="meta"><span>⏰ belangrijk vanaf ${fmtKorteDatum(t.belangrijk_vanaf)}</span></div>` : ''}
        ${t.notitie ? `<div class="meta"><span>${escapeHtml(t.notitie.slice(0,80))}${t.notitie.length>80?'…':''}</span></div>` : ''}
      </div>
      <button class="klaarbtn" aria-label="Subtaak klaar" title="Klaar" onclick="subtaakKlaar('${t.id}')">✓</button>
    </div>`).join('');
}
async function subtaakKlaar(id){
  try{
    await sb(`work_tasks?id=eq.${id}`, {method:'PATCH', body: JSON.stringify({status:'klaar', updated_at:new Date().toISOString()})});
  }catch(error){ toast('Afvinken mislukt: '+(error.message||'onbekende fout')); return; }
  toast('Subtaak klaar'); loadDumpSubtaken();
  if(typeof loadVandaag==='function') loadVandaag();
}
document.getElementById('subtaakSnelForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const input = document.getElementById('subtaakSnelTitel');
  const titel = input.value.trim();
  if(!titel) return;
  const btn = document.getElementById('subtaakSnelBtn');
  btn.disabled = true;
  try{
    await sb('work_tasks', {method:'POST', body: JSON.stringify({project:'pwn', titel, status:'backlog', taaktype:'subtaak', updated_at:new Date().toISOString()})});
    input.value = '';
    toast('Subtaak toegevoegd');
    document.getElementById('dumpSubtaken').open = true;
    loadDumpSubtaken();
    if(typeof loadVandaag==='function') loadVandaag();
  }catch(error){
    const msg = (error && error.message) || '';
    toast(/taaktype/i.test(msg) ? 'Kan subtaak niet opslaan: voer eerst TAKEN-SUBTAKEN-MIGRATIE.sql uit in Supabase.' : 'Opslaan mislukt: '+(msg||'onbekende fout'));
  }finally{ btn.disabled = false; }
});
document.getElementById('dumpSubtaken').addEventListener('toggle', ()=>onthoudTakenSectie('dumpSubtaken', document.getElementById('dumpSubtaken').open));

function iconVoorType(t){ return {tekst:'📝',link:'🔗',foto:'📷',spraak:'🎙️'}[t]||'📝'; }
function bewerkDump(id){
  const item = dumpItems.find(it=>it.id===id);
  if(item) openDumpSheet(item.type, item);
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function archiveerDump(id){
  const item = dumpItems.find(it=>it.id===id);
  try{
    await sb(`work_items?id=eq.${id}`, {method:'PATCH', body: JSON.stringify({gesorteerd:true})});
  }catch(error){ toast('Mislukt: '+error.message); return; }
  // Archiveren wist niks: het item blijft in de database, alleen gesorteerd=true.
  toastActie(item?.categorie==='kopen' ? '✓ Gekocht' : 'Weg uit de Dump', 'Ongedaan', async ()=>{
    await sb(`work_items?id=eq.${id}`, {method:'PATCH', body: JSON.stringify({gesorteerd:false})});
    loadDump();
  });
  loadDump();
}
