// ============ CONFIG ============
const AI_MODEL = 'claude-haiku-4-5-20251001';
const AI_SCAN_MODEL = 'claude-sonnet-5';   // leest bonnen/offertes uit, heeft beeld + pdf nodig

function getAiKey(){ return localStorage.getItem('werkhub_ai_key') || ''; }
function setAiKey(k){ localStorage.setItem('werkhub_ai_key', k.trim()); }

// AI-calls lopen via de Supabase-proxy; die houdt de Anthropic-key server-side,
// zodat hij niet in deze (publieke) HTML hoeft te staan en op elk toestel werkt.
// Staat er lokaal toch een key, dan is dat de noodoplossing als de proxy plat ligt.
const AI_PROXY = `${SB_URL}/functions/v1/ai-proxy`;

async function aiMessages(body){
  let proxyFout = '';
  try{
    const res = await fetch(AI_PROXY, {
      method:'POST',
      headers:{ 'content-type':'application/json', 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
      body: JSON.stringify(body)
    });
    if(res.ok) return await res.json();
    proxyFout = res.status + ' ' + (await res.text().catch(()=> '')).slice(0,120);
  }catch(e){
    proxyFout = String(e.message || e);
  }
  const key = getAiKey();
  if(!key) throw new Error('AI-proxy: ' + proxyFout);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{
      'content-type':'application/json',
      'x-api-key': key,
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true'
    },
    body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error(res.status + ' ' + (await res.text().catch(()=> '')).slice(0,120));
  return await res.json();
}

// ============ AUTH ============
// Alleen ingelogde gebruikers (Supabase Auth) mogen data lezen/schrijven — zie RLS-policies.
// Sessie (access/refresh token) staat lokaal op dit toestel, niet in de broncode.
function getAuthSession(){
  try{ return JSON.parse(localStorage.getItem('werkhub_auth') || 'null'); }catch(e){ return null; }
}
function setAuthSession(session){
  if(session) localStorage.setItem('werkhub_auth', JSON.stringify(session));
  else localStorage.removeItem('werkhub_auth');
}
function getAccessToken(){
  const s = getAuthSession();
  return s ? s.access_token : null;
}

async function authLogin(email, password){
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 15000);
  try{
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method:'POST',
      headers:{ 'apikey': SB_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ email, password }),
      signal: controller.signal
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error_description || data.msg || 'Inloggen mislukt');
    try{ setAuthSession(data); }
    catch(error){ throw new Error('Deze browser kan de login niet bewaren. Controleer of websiteopslag is toegestaan.'); }
    return data;
  }catch(error){
    if(controller.signal.aborted) throw new Error('Inloggen duurt te lang. Controleer je internetverbinding en probeer opnieuw.');
    if(error instanceof TypeError) throw new Error('Geen verbinding met de loginserver. Controleer internet, VPN of een browserblokkering.');
    throw error;
  }finally{
    clearTimeout(timeout);
  }
}

async function authRefresh(){
  const s = getAuthSession();
  if(!s || !s.refresh_token) return null;
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
    method:'POST',
    headers:{ 'apikey': SB_KEY, 'Content-Type':'application/json' },
    body: JSON.stringify({ refresh_token: s.refresh_token })
  });
  if(!res.ok){ setAuthSession(null); return null; }
  const data = await res.json();
  setAuthSession(data);
  return data;
}

function authLogout(){
  setAuthSession(null);
  location.reload();
}

async function requireAuth(){
  let token = getAccessToken();
  if(!token) return false;
  // token 1 uur geldig; ververs 'm zodra hij korter dan 5 min mee kan.
  const s = getAuthSession();
  if(s && s.expires_at && (s.expires_at * 1000 - Date.now() < 5*60*1000)){
    const refreshed = await authRefresh();
    if(!refreshed) return false;
  }
  return true;
}

// ============ SUPABASE REST HELPER ============
async function sb(path, opts={}){
  const token = getAccessToken() || SB_KEY;
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers:{
      'apikey': SB_KEY,
      'Authorization': `Bearer ${token}`,
      'Content-Type':'application/json',
      'Prefer': opts.prefer || 'return=representation',
      ...(opts.headers||{})
    }
  });
  if(res.status === 401){ authLogout(); throw new Error('Sessie verlopen, opnieuw inloggen'); }
  if(!res.ok){
    const bodyText = await res.text();
    console.error('sb error', path, bodyText);
    let msg = 'Supabase-fout';
    try{ const j = JSON.parse(bodyText); if(j && j.message) msg = j.message; }catch(_){}
    throw new Error(msg);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function uploadFoto(file){
  const path = `werkhub/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g,'_')}`;
  const res = await fetch(`${SB_URL}/storage/v1/object/notitie-fotos/${path}`, {
    method:'POST',
    headers:{ 'apikey': SB_KEY, 'Authorization': `Bearer ${getAccessToken() || SB_KEY}`, 'Content-Type': file.type },
    body:file
  });
  if(!res.ok) throw new Error('upload mislukt');
  return `${SB_URL}/storage/v1/object/public/notitie-fotos/${path}`;
}

// Melding met knop (bijv. Ongedaan), blijft 6 seconden staan.
let toastActieTimer = null;
function toastActie(msg, label, actie){
  const t = document.getElementById('toast');
  t.textContent = '';
  const tekst = document.createElement('span'); tekst.textContent = msg;
  const knop = document.createElement('button'); knop.type = 'button'; knop.className = 'toast-actie'; knop.textContent = label;
  knop.addEventListener('click', async ()=>{ t.classList.remove('show'); try{ await actie(); }catch(e){ toast('Mislukt: '+e.message); } });
  t.append(tekst, knop); t.classList.add('show');
  clearTimeout(toastActieTimer);
  toastActieTimer = setTimeout(()=>t.classList.remove('show'), 6000);
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1800);
}

// ============ TABS ============
const tabs = ['vandaag','dump','docs','projecten','team','uren','ritten'];
document.querySelectorAll('nav.tabs button').forEach(btn=>{
  btn.addEventListener('click', ()=>switchTab(btn.dataset.tab));
});
function switchTab(name){
  tabs.forEach(t=>{
    document.getElementById('tab-'+t).classList.toggle('hidden', t!==name);
  });
  document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  document.getElementById('fabDump').classList.toggle('hidden', name!=='dump');
  if(name==='vandaag') loadVandaag();
  if(name==='dump'){ loadDump(); loadDumpSubtaken(); }
  if(name==='docs') loadDocs();
  if(name==='projecten') loadProjecten();
  if(name==='team') loadTeam();
  if(name==='uren') loadUren();
  if(name==='ritten') loadRitten();
}

// ============ SHEET (bottom modal) ============
function openSheet(html){
  const host = document.getElementById('sheetHost');
  host.innerHTML = `<div class="sheet-bg" id="sheetBg"><div class="sheet">${html}</div></div>`;
  document.getElementById('sheetBg').addEventListener('click', e=>{ if(e.target.id==='sheetBg') closeSheet(); });
}
function closeSheet(){ document.getElementById('sheetHost').innerHTML=''; }
