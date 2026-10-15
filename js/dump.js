// ============ DUMP TAB ============
let huidigeDumpType = 'tekst';
const DUMP_CATEGORIEEN = {inbox:'Inbox', kopen:'Kopen', akf_dwat:'AKF/DWAT', uf_ro:'UF-RO', lab:'LAB/Analyseruimte'};
let dumpCategorie = 'inbox';
let dumpItems = [];
document.getElementById('dumpCategorieRow').addEventListener('click', e=>{
  const button = e.target.closest('button[data-c]');
  if(!button) return;
  dumpCategorie = button.dataset.c;
  document.querySelectorAll('#dumpCategorieRow button').forEach(b=>b.classList.toggle('sel', b===button));
  loadDump();
});
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
    openDumpSheet('foto', {tekst:file.name, foto_url:url});
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

function openDumpSheet(type, item = {}){
  const labels = {tekst:'📝 Tekst', link:'🔗 Link', spraak:'🎙️ Spraaknotitie', foto:'📷 Foto'};
  openSheet(`
    <button class="closex" onclick="closeSheet()">✕</button>
    <h2>${labels[type]||type}</h2>
    <div class="field"><textarea id="dumpTekstVal" placeholder="${type==='link' ? 'Plak de link…' : 'Typ het even neer…'}" autofocus>${escapeHtml(item.tekst||'')}</textarea></div>
    <div class="field"><label>Lijstje</label><select id="dumpCategorieVal">
      ${Object.entries(DUMP_CATEGORIEEN).map(([key,label])=>`<option value="${key}" ${(item.categorie||dumpCategorie)===key?'selected':''}>${label}</option>`).join('')}
    </select></div>
    <div class="field"><label>Herinner me op (optioneel)</label>
      <input type="datetime-local" id="dumpHerinnerVal" value="${item.herinner_at ? lokaalDatumTijd(item.herinner_at) : ''}">
      <p class="hintje">Op dit tijdstip, niet 45 minuten vooraf. Verzending kan tot ongeveer 5 minuten later zijn. Gebruik je ingestelde e-mail- en/of pushkanaal.</p>
    </div>
    <div class="field">
      <label><input type="checkbox" id="dumpUrgent" ${item.urgent?'checked':''}> 🔥 Urgent — moet naar de Vandaag-widget</label>
    </div>
    <div class="sheet-actions">
      <button class="btn ghost" onclick="closeSheet()">Annuleren</button>
      <button class="btn primary" id="dumpSaveBtn">Opslaan</button>
    </div>
  `);
  document.getElementById('dumpSaveBtn').addEventListener('click', async ()=>{
    const tekst = document.getElementById('dumpTekstVal').value.trim();
    const urgent = document.getElementById('dumpUrgent').checked;
    const categorie = document.getElementById('dumpCategorieVal').value;
    const herinnerVeld = document.getElementById('dumpHerinnerVal').value;
    if(!tekst){ toast('Vul iets in om te onthouden'); return; }
    const herinner_at = herinnerVeld
      ? (item.herinner_at && herinnerVeld === lokaalDatumTijd(item.herinner_at)
        ? item.herinner_at : new Date(herinnerVeld).toISOString())
      : null;
    const herinneringGewijzigd = herinner_at !== (item.herinner_at || null);
    if(herinneringGewijzigd && herinner_at && new Date(herinner_at).getTime() <= Date.now()){ toast('Kies een tijdstip in de toekomst'); return; }
    const btn = document.getElementById('dumpSaveBtn');
    btn.disabled = true;
    try{
      if(herinner_at && herinneringGewijzigd){
        const status = await reminderApi('status');
        if(!status.settings?.task_email && !status.settings?.task_push)
          throw new Error('Zet eerst e-mail of push aan via Instellingen > Herinneringen');
        if(status.settings?.task_push && !status.settings?.task_email && !status.subscriptions)
          throw new Error('Registreer eerst je iPhone via Instellingen > Herinneringen');
      }
      const payload = {type, tekst, urgent, categorie, herinner_at,
        herinner_user_id: herinner_at ? getAuthSession()?.user?.id : null};
      if(herinner_at && !payload.herinner_user_id) throw new Error('Log opnieuw in voordat je een herinnering opslaat');
      if(item.foto_url) payload.foto_url = item.foto_url;
      await sb(item.id ? `work_items?id=eq.${item.id}` : 'work_items',
        {method:item.id?'PATCH':'POST', body:JSON.stringify(payload)});
      closeSheet(); toast('Opgeslagen in ' + DUMP_CATEGORIEEN[categorie]); loadDump(); loadVandaag();
    }catch(error){ toast('Opslaan mislukt: ' + error.message); }
    finally{ btn.disabled = false; }
  });
}

async function loadDump(){
  const list = document.getElementById('dumpList');
  list.innerHTML = '<div class="empty-state">Laden…</div>';
  let items;
  try{
    dumpItems = await sb('work_items?gesorteerd=eq.false&order=created_at.desc');
    items = dumpItems.filter(it=>(it.categorie||'inbox')===dumpCategorie);
  }catch(error){
    list.textContent = 'Lijstje laden mislukt: ' + error.message;
    return;
  }
  if(!items.length){ list.innerHTML = '<div class="empty-state">Niks in de dump. Rustig hoor 🙂</div>'; return; }
  list.innerHTML = items.map(it=>`
    <div class="card">
      <div class="titel">${iconVoorType(it.type)} ${escapeHtml(it.tekst||'')}</div>
      ${it.foto_url ? `<div class="meta"><a href="${it.foto_url}" target="_blank" style="color:var(--teal)">bekijk foto</a></div>` : ''}
      <div class="meta">
        ${it.urgent ? '<span class="badge urgent">🔥 urgent</span>' : ''}
        ${it.herinner_at ? `<span>⏰ ${escapeHtml(new Date(it.herinner_at).toLocaleString('nl-NL'))}</span>` : ''}
        <span>${new Date(it.created_at).toLocaleDateString('nl-NL',{day:'numeric',month:'short'})}</span>
      </div>
      <div class="sheet-actions" style="margin-top:10px">
        <button class="btn ghost" onclick="bewerkDump('${it.id}')">Lijst / herinnering</button>
        <button class="btn ghost" onclick="dumpNaarProject('${it.id}')">→ PWN-taak</button>
        <button class="btn danger" onclick="archiveerDump('${it.id}')">Archiveer</button>
      </div>
    </div>
  `).join('');
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
  await sb(`work_items?id=eq.${id}`, {method:'PATCH', body: JSON.stringify({gesorteerd:true})});
  toast('Gearchiveerd'); loadDump();
}
