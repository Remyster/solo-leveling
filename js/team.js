// ============ TEAM / PRET ============
const TEAM_TYPES = {
  koffie:'Koffie', lunch:'Lunch', borrel:'Borrel', uitje:'Uitje',
  feestdagen:'Kerst / feestdagen', verjaardag:'Verjaardag (met instemming)',
  attentie:'Kaartje / cadeautje / attentie', overig:'Ander teammoment'
};
const TEAM_STATUS = {
  moment:{idee:'Idee',afstemmen:'Afstemmen',gepland:'Gepland',afgerond:'Afgerond'},
  afspraak:{nog_te_bevestigen:'Nog te bevestigen',bevestigd:'Bevestigd',vervallen:'Vervallen'},
  notitie:{open:'Open',afgerond:'Afgerond'}
};
const TEAM_CHECKS = {
  voorkeur:'Toestemming / voorkeur discreet gecheckt',
  vrijwillig:'Inclusief en vrijblijvend; geen druk of verplichte bijdrage',
  praktisch:'Praktische zaken afgestemd',
  akkoord:'Eventuele voorafgaande goedkeuring volgens bevestigde afspraak geregeld',
  kosten:'Kostenafhandeling volgens bevestigde afspraak geregeld'
};
const TEAM_START = [
  ['budget','Budget en goedkeuring','[CONTROLEREN] Is er budget? Hoeveel, waarvoor en wie keurt uitgaven vooraf goed?'],
  ['kosten','Declaraties, cadeaus en inzamelingen','[CONTROLEREN] Welke regels gelden voor declaraties, cadeaus en vrijwillige inzamelingen?'],
  ['werktijd','Werktijd en vooraf akkoord','[CONTROLEREN] Wat kan tijdens werktijd en wat vraagt vooraf akkoord?'],
  ['privacy','Privacy en instemming','[CONTROLEREN] Welke privacyafspraken gelden voor verjaardagen, ziekte en persoonlijke gebeurtenissen? Geen medische details registreren.'],
  ['praktisch','Praktische afstemming','[CONTROLEREN] Stem locaties, reserveringen, catering, alcohol, wensen rond eten/toegankelijkheid en communicatiekanalen af. Geen persoonlijke allergie- of medische lijst opslaan.'],
  ['contact','Contactpersoon en vervanger','[CONTROLEREN] Wie is manager/contactpersoon voor toestemming en wie vervangt de Pret-coördinator?']
];
let teamItems = [], teamTasks = [], teamFilter = 'overzicht', teamLoadVersion = 0;

function teamDate(value){
  if(!value) return true;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date=new Date(value+'T12:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10)===value;
}
function teamText(value, label, max, required=false){
  if(typeof value!=='string' || value.length>max || (required && !value.trim())){
    throw new Error(label+': '+(required ? 'verplicht, ' : '')+'maximaal '+max+' tekens');
  }
}
function validateTeamItem(item){
  if(!TEAM_STATUS[item.soort] || !Object.hasOwn(TEAM_STATUS[item.soort],item.status)) throw new Error('Ongeldige soort of status');
  teamText(item.onderwerp,'Onderwerp',120,true);
  teamText(item.inhoud,'Neutrale omschrijving / afspraak',2000);
  teamText(item.verantwoordelijke,'Verantwoordelijke',120);
  teamText(item.helpers,'Helpers',200);
  if(!teamDate(item.datum) || !teamDate(item.herzieningsdatum)) throw new Error('Vul een geldige datum in');
  if(item.soort==='moment' && !Object.hasOwn(TEAM_TYPES,item.activiteitstype)) throw new Error('Kies een activiteitstype');
  if(item.soort!=='moment' && item.activiteitstype!==null) throw new Error('Activiteitstype hoort alleen bij momenten');
  if(item.soort!=='afspraak' && item.herzieningsdatum!==null) throw new Error('Herzieningsdatum hoort alleen bij afspraken');
  if(!item.checklist || Object.keys(item.checklist).length!==Object.keys(TEAM_CHECKS).length ||
    Object.keys(TEAM_CHECKS).some(key=>typeof item.checklist[key]!=='boolean')) throw new Error('Ongeldige checklist');
}
function validateTeamTask(payload){
  teamText(payload.titel,'Wat',120,true);
  teamText(payload.notitie,'Neutrale notitie',2000);
  teamText(payload.wie,'Verantwoordelijke',120);
  teamText(payload.waar,'Locatie',200);
}
function teamOptions(values, selected){
  return Object.entries(values).map(([key,label])=>`<option value="${key}" ${selected===key?'selected':''}>${escapeHtml(label)}</option>`).join('');
}
function teamError(error){
  console.error('WerkHub Team',error);
  const message=error.message || 'Onbekende fout';
  return /work_team|team_id|schema cache/i.test(message)
    ? 'Team laden mislukt: '+message+'. Controleer of TEAM-MIGRATIE.sql is uitgevoerd; er wordt niets lokaal als vervanging opgeslagen.'
    : 'Team laden mislukt: '+message;
}
async function loadTeam(){
  const version=++teamLoadVersion;
  const host=document.getElementById('teamList');
  host.innerHTML='<p role="status">Team laden…</p>';
  try{
    const [items,tasks]=await Promise.all([
      sb('work_team?order=created_at.desc'),
      sb('work_tasks?team_id=not.is.null&order=deadline.asc.nullslast')
    ]);
    if(version!==teamLoadVersion) return;
    teamItems=items;teamTasks=tasks;
    renderTeam();
  }catch(error){
    if(version!==teamLoadVersion) return;
    host.innerHTML=`<p class="team-error" role="alert">${escapeHtml(teamError(error))}</p><button class="btn ghost" id="teamRetry">Opnieuw laden</button>`;
    document.getElementById('teamRetry').addEventListener('click',loadTeam);
  }
}
function teamCard(item){
  const pending=item.soort==='afspraak' && item.status==='nog_te_bevestigen';
  return `<div class="card">
    <div class="titel">${escapeHtml(item.onderwerp)}</div>
    <div class="meta"><span class="badge ${pending?'wacht_op':'backlog'}">${pending?'[CONTROLEREN] ':''}${escapeHtml(TEAM_STATUS[item.soort][item.status])}</span>
    ${item.activiteitstype?`<span>${escapeHtml(TEAM_TYPES[item.activiteitstype])}</span>`:''}
    ${item.datum?`<span>${escapeHtml(item.datum)}</span>`:''}
    ${item.verantwoordelijke?`<span>Verantwoordelijke: ${escapeHtml(item.verantwoordelijke)}</span>`:''}
    ${item.helpers?`<span>Helpers: ${escapeHtml(item.helpers)}</span>`:''}
    ${item.herzieningsdatum?`<span>Herzien: ${escapeHtml(item.herzieningsdatum)}</span>`:''}</div>
    <p class="team-text">${escapeHtml(item.inhoud)}</p>
    ${item.soort==='moment'?`<p class="hintje">Checklist: ${Object.keys(TEAM_CHECKS).filter(key=>item.checklist[key]).length}/5 afgestemd. Geen automatische goedkeuring.</p>`:''}
    <div class="team-actions"><button class="btn ghost" data-team-edit="${item.id}">Bekijken / bewerken</button>
    <button class="btn ghost" data-team-action="${item.id}">+ Open actie</button></div>
  </div>`;
}
function teamActionCard(task){
  const item=teamItems.find(row=>row.id===task.team_id);
  return `<div class="card"><div class="titel">${escapeHtml(task.titel)}</div>
    <div class="meta"><span class="badge ${task.status}">${escapeHtml(statusLabels[task.status])}</span>
    ${task.deadline?`<span>${escapeHtml(fmtTaakDatumTijd(task))}</span>`:''}
    ${task.wie?`<span>${escapeHtml(task.wie)}</span>`:''}</div>
    <p class="hintje">${escapeHtml(item?.onderwerp || 'Gekoppeld teamonderwerp')}</p>
    <button class="btn ghost" data-team-task="${task.id}">Bewerken / afronden</button></div>`;
}
function renderTeam(){
  const today=isoDatum(new Date());
  const host=document.getElementById('teamList');
  const missing=TEAM_START.filter(([key])=>!teamItems.some(item=>item.seed_key===key));
  let html=missing.length ? `<div class="team-warning"><b>[CONTROLEREN] Nog te bevestigen</b>
    <ul>${missing.map(([,title,text])=>`<li><b>${escapeHtml(title)}</b>: ${escapeHtml(text)}</li>`).join('')}</ul>
    <p>Bewaar deze ${missing.length} basisvragen om ze te bewerken. Ze worden nooit automatisch bevestigd.</p><button class="btn ghost" id="teamSetup">Basisvragen toevoegen</button><p id="teamSetupError" role="alert"></p></div>`:'';
  function group(title,rows,renderer,empty){
    return `<h3>${title}</h3>${rows.length?rows.map(renderer).join(''):`<p class="empty-state">${empty}</p>`}`;
  }
  if(teamFilter==='overzicht'){
    const moments=teamItems.filter(item=>item.soort==='moment' && item.status!=='afgerond');
    const next=moments.filter(item=>item.datum && item.datum>=today).sort((a,b)=>a.datum.localeCompare(b.datum)).slice(0,3);
    const overdue=moments.filter(item=>item.datum && item.datum<today);
    const review=teamItems.filter(item=>item.soort==='afspraak' && (item.status==='nog_te_bevestigen' ||
      (item.status==='bevestigd' && item.herzieningsdatum && item.herzieningsdatum<=today)));
    html+=group('Eerstvolgende momenten',next,teamCard,'Nog geen aankomend teammoment.');
    if(overdue.length) html+=group('Verstreken, nog niet afgerond',overdue,teamCard,'');
    html+=group('Open acties',teamTasks.filter(task=>task.status!=='klaar'),teamActionCard,'Geen open teamacties.');
    html+=group('[CONTROLEREN] Afspraken te controleren',review,teamCard,'Geen afspraken die nu gecontroleerd moeten worden.');
    html+='<p class="hintje">Momenten zonder datum vind je bij Momenten. Bespreek elk kwartaal vrijwilligheid, inclusie, belasting en afspraken. Noteer de kwartaalcheck als teamactie.</p>';
  }else if(teamFilter==='acties'){
    html+=group('Open acties',teamTasks.filter(task=>task.status!=='klaar'),teamActionCard,'Geen open teamacties.');
    html+=group('Afgeronde acties',teamTasks.filter(task=>task.status==='klaar'),teamActionCard,'Nog geen afgeronde teamacties.');
  }else{
    html+=group({moment:'Momenten & attenties',afspraak:'Afspraken & besluiten',notitie:'Ideeën & neutrale notities'}[teamFilter],
      teamItems.filter(item=>item.soort===teamFilter),teamCard,'Nog niets hier. Gebruik de knop hierboven om iets toe te voegen.');
  }
  host.innerHTML=html;
  const setup=document.getElementById('teamSetup');
  if(setup) setup.addEventListener('click',async()=>{
    setup.disabled=true;
    try{
      const userId=getAuthSession()?.user?.id;
      if(!userId) throw new Error('Log opnieuw in voordat je basisvragen toevoegt');
      const payload=missing.map(([key,onderwerp,inhoud])=>({
        user_id:userId,seed_key:key,soort:'afspraak',onderwerp,inhoud,status:'nog_te_bevestigen'
      }));
      await sb('work_team?on_conflict=user_id,seed_key',{method:'POST',body:JSON.stringify(payload),prefer:'resolution=ignore-duplicates,return=representation'});
      await loadTeam();
    }catch(error){
      document.getElementById('teamSetupError').textContent='Toevoegen mislukt: '+error.message;
      console.error('WerkHub Team basisvragen',error);setup.disabled=false;
    }
  });
  host.querySelectorAll('[data-team-edit]').forEach(button=>button.addEventListener('click',()=>openTeamSheet(button.dataset.teamEdit)));
  host.querySelectorAll('[data-team-action]').forEach(button=>button.addEventListener('click',async()=>{
    try{await openTaskSheet(null,'pwn','',null,button.dataset.teamAction);}
    catch(error){toast('Teamactie openen mislukt: '+error.message);console.error(error);}
  }));
  host.querySelectorAll('[data-team-task]').forEach(button=>button.addEventListener('click',async()=>{
    try{await openTaskSheet(button.dataset.teamTask,'pwn');}
    catch(error){toast('Teamactie openen mislukt: '+error.message);console.error(error);}
  }));
}
function openTeamSheet(id, soort='moment'){
  const original=id?teamItems.find(item=>item.id===id):null;
  if(id && !original){toast('Teamonderwerp niet gevonden; laad opnieuw');return;}
  const item=original || {
    soort,status:Object.keys(TEAM_STATUS[soort])[0],onderwerp:'',inhoud:'',
    activiteitstype:soort==='moment'?'koffie':null,datum:null,herzieningsdatum:null,
    verantwoordelijke:'',helpers:'',checklist:Object.fromEntries(Object.keys(TEAM_CHECKS).map(key=>[key,false]))
  };
  soort=item.soort;
  openSheet(`<button class="closex" onclick="closeSheet()" aria-label="Sluiten">✕</button>
    <h2>${id?'Bewerken':'Nieuw'}: ${ {moment:'moment / attentie',afspraak:'afspraak / besluit',notitie:'idee / notitie'}[soort]}</h2>
    <p class="team-warning">Alleen neutrale teaminformatie. Geen medische details, geboortedata of privégegevens. Persoonlijke momenten alleen met instemming. Deelname en bijdragen blijven vrijwillig.</p>
    <div class="field"><label for="teamOnderwerp">Onderwerp</label><input id="teamOnderwerp" type="text" maxlength="120" value="${escapeHtml(item.onderwerp)}"></div>
    ${soort==='moment'?`<div class="field"><label for="teamType">Type</label><select id="teamType">${teamOptions(TEAM_TYPES,item.activiteitstype)}</select></div>`:''}
    <div class="field"><label for="teamInhoud">${soort==='afspraak'?'Afspraak / besluit en wie dit bevestigt':'Korte neutrale omschrijving / notitie'}</label><textarea id="teamInhoud" maxlength="2000">${escapeHtml(item.inhoud)}</textarea></div>
    <div class="field"><label for="teamDatum">Datum (optioneel, geen geboortedatum)</label><input id="teamDatum" type="date" value="${item.datum||''}"></div>
    <div class="field"><label for="teamOwner">Organisator / verantwoordelijke (rol of korte naam)</label><input id="teamOwner" type="text" maxlength="120" value="${escapeHtml(item.verantwoordelijke)}"></div>
    <div class="field"><label for="teamHelpers">Helpers / vervanger (optioneel)</label><input id="teamHelpers" type="text" maxlength="200" value="${escapeHtml(item.helpers)}"></div>
    <div class="field"><label for="teamStatus">Status</label><select id="teamStatus">${teamOptions(TEAM_STATUS[soort],item.status)}</select></div>
    ${soort==='afspraak'?`<p class="hintje">Nog te bevestigen = [CONTROLEREN]. Kies Bevestigd pas nadat Remy/team/manager de inhoud heeft bevestigd. Een verlopen herzieningsdatum betekent opnieuw controleren.</p>
      <div class="field"><label for="teamReview">Herzieningsdatum (optioneel)</label><input id="teamReview" type="date" value="${item.herzieningsdatum||''}"></div>`:''}
    ${soort==='moment'?`<div class="checklist">${Object.entries(TEAM_CHECKS).map(([key,label])=>`<label><input type="checkbox" data-team-check="${key}" ${item.checklist[key]?'checked':''}><span>${escapeHtml(label)}</span></label>`).join('')}</div>
      <p class="hintje">Vink alleen af wat echt afgestemd is. Ontbrekende PWN-regels blijven [CONTROLEREN]; een vinkje maakt geen nieuwe regel.</p>`:''}
    <label class="team-warning" style="display:block;margin-top:12px"><input type="checkbox" id="teamPrivacy"> Ik heb gecontroleerd: geen gevoelige details of onnodige persoonsgegevens; persoonlijke momenten zijn afgestemd.</label>
    <p id="teamFormError" class="team-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn primary" id="teamSave">Opslaan</button></div>
    ${id?'<button class="btn ghost" id="teamAddAction" style="width:100%;margin-top:12px">+ Actie bij dit onderwerp</button>':''}`);
  const action=document.getElementById('teamAddAction');
  if(action) action.addEventListener('click',()=>{
    if(!confirm('Niet-opgeslagen wijzigingen in dit onderwerp gaan verloren. Naar een nieuwe actie?')) return;
    openTaskSheet(null,'pwn','',null,id).catch(error=>{toast('Actie openen mislukt: '+error.message);console.error(error);});
  });
  const save=document.getElementById('teamSave');
  const errorBox=document.getElementById('teamFormError');
  const privacy=document.getElementById('teamPrivacy');
  document.getElementById('sheetHost').querySelectorAll('input:not(#teamPrivacy),textarea,select').forEach(input=>{
    input.addEventListener('input',()=>{privacy.checked=false;});
  });
  save.addEventListener('click',async()=>{
    if(save.disabled) return;
    errorBox.textContent='';
    try{
      if(!document.getElementById('teamPrivacy').checked) throw new Error('Controleer en bevestig eerst de privacy en instemming');
      const payload={
        soort,onderwerp:document.getElementById('teamOnderwerp').value.trim(),
        inhoud:document.getElementById('teamInhoud').value.trim(),
        activiteitstype:soort==='moment'?document.getElementById('teamType').value:null,
        datum:document.getElementById('teamDatum').value||null,
        herzieningsdatum:soort==='afspraak'?(document.getElementById('teamReview').value||null):null,
        verantwoordelijke:document.getElementById('teamOwner').value.trim(),
        helpers:document.getElementById('teamHelpers').value.trim(),
        status:document.getElementById('teamStatus').value,
        checklist:soort==='moment'?Object.fromEntries([...document.querySelectorAll('[data-team-check]')].map(input=>[input.dataset.teamCheck,input.checked])):Object.fromEntries(Object.keys(TEAM_CHECKS).map(key=>[key,false]))
      };
      validateTeamItem(payload);
      if(payload.status==='bevestigd' && (!original || original.status!=='bevestigd' || original.inhoud!==payload.inhoud || original.onderwerp!==payload.onderwerp)){
        if(!confirm('Is deze exacte afspraak daadwerkelijk bevestigd door Remy/team/manager? WerkHub bepaalt geen PWN-regels.')) return;
      }
      save.disabled=true;
      const rows=await sb(id?`work_team?id=eq.${id}`:'work_team',{method:id?'PATCH':'POST',body:JSON.stringify(payload)});
      if(!Array.isArray(rows) || rows.length!==1) throw new Error('Geen wijziging opgeslagen; controleer toegang en laad opnieuw');
      if(save.isConnected) closeSheet();
      toast('Teamonderwerp opgeslagen');await loadTeam();
    }catch(error){
      errorBox.textContent='Opslaan mislukt: '+error.message;
      console.error('WerkHub Team opslaan',error);
    }finally{save.disabled=false;}
  });
}
document.getElementById('teamNieuwMoment').addEventListener('click',()=>openTeamSheet(null,'moment'));
document.getElementById('teamNieuweAfspraak').addEventListener('click',()=>openTeamSheet(null,'afspraak'));
document.getElementById('teamNieuweNotitie').addEventListener('click',()=>openTeamSheet(null,'notitie'));
document.getElementById('teamFilters').addEventListener('click',event=>{
  const button=event.target.closest('[data-team-filter]');
  if(!button) return;
  teamFilter=button.dataset.teamFilter;
  document.querySelectorAll('[data-team-filter]').forEach(input=>input.classList.toggle('sel',input===button));
  loadTeam();
});
