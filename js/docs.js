// ============ DOCS TAB (offertes/bonnen/bestellingen) ============
const docTypeLabels = {offerte:'Offerte', bon:'Bon', bestelling:'Bestelling'};
const DOCS_BUCKET = 'werkhub-docs';
let huidigDocFilter = 'alle';

// --- pincodeslot op deze tab ---
function getDocsPinHash(){ return localStorage.getItem('werkhub_docs_pin') || ''; }
function setDocsPinHash(h){ h ? localStorage.setItem('werkhub_docs_pin', h) : localStorage.removeItem('werkhub_docs_pin'); }
async function hashPin(pin){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('werkhub:' + pin));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
let docsOntgrendeld = false;

function toonDocsSlot(){
  const vergrendeld = !!getDocsPinHash() && !docsOntgrendeld;
  document.getElementById('docsLock').classList.toggle('hidden', !vergrendeld);
  document.getElementById('docsBody').classList.toggle('hidden', vergrendeld);
  if(vergrendeld){
    const inp = document.getElementById('docsPinInput');
    inp.value = ''; document.getElementById('docsPinFout').textContent = '';
  }
  return vergrendeld;
}
document.getElementById('btnDocsUnlock').addEventListener('click', probeerOntgrendelen);
document.getElementById('docsPinInput').addEventListener('keydown', e=>{ if(e.key==='Enter') probeerOntgrendelen(); });
async function probeerOntgrendelen(){
  const pin = document.getElementById('docsPinInput').value.trim();
  if(!pin) return;
  if(await hashPin(pin) === getDocsPinHash()){
    docsOntgrendeld = true;
    toonDocsSlot();
    loadDocs();
  }else{
    document.getElementById('docsPinFout').textContent = 'Pincode klopt niet';
    document.getElementById('docsPinInput').value = '';
  }
}

document.getElementById('docFilterRow').addEventListener('click', e=>{
  const btn = e.target.closest('button[data-f]');
  if(!btn) return;
  huidigDocFilter = btn.dataset.f;
  document.querySelectorAll('#docFilterRow button').forEach(b=>b.classList.toggle('sel', b===btn));
  loadDocs();
});

document.getElementById('btnNieuwDoc').addEventListener('click', ()=>openDocSheet());

document.getElementById('scanInput').addEventListener('change', async e=>{
  const file = e.target.files[0];
  e.target.value='';
  if(file) await verwerkDocumentFoto(file);
});
document.getElementById('fileInput').addEventListener('change', async e=>{
  const file = e.target.files[0];
  e.target.value='';
  if(file) await verwerkDocumentFoto(file);
});

async function verwerkDocumentFoto(file){
  const save = document.getElementById('btnSaveDoc');
  if(!save || save.disabled){toast('Wacht tot de huidige verwerking klaar is');return;}
  save.disabled = true;
  setScanStatus('Bestand inlezen…');
  try{
    if(file.type === 'application/pdf' || /\.pdf$/i.test(file.name)){
      throw new Error('Maak van de productpagina een foto of schermafbeelding en kies die om bij te snijden. Een volledige PDF wordt niet overgenomen of verstuurd.');
    }
    const klein = await snijDocumentFoto(file);
    if(!save.isConnected) return;
    if(!klein){setScanStatus('Bijsnijden geannuleerd; de bestaande bijlage blijft behouden');return;}
    window._docBestandBlob = klein.blob;
    window._docBestandNaam = 'productregels_' + Date.now() + '.jpg';
    window._docScanBron = { soort:'image', media_type:'image/jpeg', base64: klein.base64 };
    toonScanPreview(klein.dataUrl, `Uitsnede — ${kbLabel(klein.blob.size)}`);
    toonAiScanKeuze();
  }catch(err){
    if(save.isConnected) setScanStatus('Inlezen mislukt: ' + (err.message||err), 'err');
  }finally{
    save.disabled = false;
  }
}

// bestandslinks: data uit data-attributen, nooit uit een inline onclick
document.addEventListener('click', e=>{
  const a = e.target.closest('a.doclink');
  if(!a) return;
  e.preventDefault(); e.stopPropagation();
  openDocBestand(a.dataset.path || '', a.dataset.url || '');
});

function kbLabel(bytes){ return bytes > 1048576 ? (bytes/1048576).toFixed(1)+' MB' : Math.round(bytes/1024)+' kB'; }
function setScanStatus(tekst, soort){
  const el = document.getElementById('docScanStatus');
  if(el){ el.textContent = tekst; el.className = 'status' + (soort ? ' '+soort : ''); }
}
function toonScanPreview(dataUrl, tekst){
  const host = document.getElementById('docScanThumb');
  if(host) host.innerHTML = dataUrl ? `<img class="scanthumb" src="${dataUrl}" alt="scan">` : '';
  setScanStatus(tekst + ' — wordt opgeslagen bij bewaren', 'ok');
}

function leesDataUrl(file){
  return new Promise((res,rej)=>{
    const r = new FileReader();
    r.onload = ()=>res(r.result);
    r.onerror = ()=>rej(new Error('bestand niet leesbaar'));
    r.readAsDataURL(file);
  });
}
async function leesBase64(file){ return (await leesDataUrl(file)).split(',')[1]; }

function maakDocumentUitsnede(img, rect){
  const {x,y,w,h} = rect;
  if(![x,y,w,h].every(Number.isFinite) || x<0 || y<0 || w<1 || h<1 ||
      x+w>img.naturalWidth || y+h>img.naturalHeight){
    throw new Error('Kies een geldig gebied binnen de foto');
  }
  const schaal = Math.min(1, 2000/Math.max(w,h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1,Math.round(w*schaal));
  canvas.height = Math.max(1,Math.round(h*schaal));
  canvas.getContext('2d').drawImage(img,x,y,w,h,0,0,canvas.width,canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg',0.9);
  return {dataUrl,base64:dataUrl.split(',')[1],w:canvas.width,h:canvas.height};
}

async function snijDocumentFoto(file){
  if(!file.type.startsWith('image/')) throw new Error('Kies een foto of schermafbeelding');
  const original = await leesDataUrl(file);
  const img = await new Promise((resolve,reject)=>{
    const image = new Image();
    image.onload = ()=>resolve(image);
    image.onerror = ()=>reject(new Error('Geen geldige afbeelding'));
    image.src = original;
  });
  return new Promise(resolve=>{
    const overlay = document.createElement('div');
    overlay.className = 'sheet-bg';
    overlay.style.zIndex = '1000';
    overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Productregels bijsnijden">
      <h2>Alleen productregels</h2>
      <p class="hintje">Sleep een kader op de foto of stel de vier randen hieronder in. Laat namen, adressen, klant-/ordernummers en andere niet-benodigde gegevens buiten het kader. De oorspronkelijke foto blijft alleen tijdelijk op dit toestel.</p>
      <canvas id="cropCanvas" style="width:100%;display:block;touch-action:none;border:1px solid var(--border)"></canvas>
      ${[['left','Links',0],['top','Boven',25],['right','Rechts',100],['bottom','Onder',85]].map(([key,label,value])=>`
        <div class="field"><label>${label} <output id="crop-${key}-value">${value}%</output>
        <input type="range" id="crop-${key}" min="0" max="100" value="${value}" style="width:100%"></label></div>`).join('')}
      <h3>Dit wordt bewaard</h3>
      <img id="cropPreview" alt="Voorbeeld van uitsluitend de geselecteerde productregels" style="max-width:100%;max-height:220px">
      <p id="cropError" class="hintje" role="status"></p>
      <div class="field"><label><input id="cropConfirm" type="checkbox"> Ik heb gecontroleerd: alleen de benodigde productregels staan in deze uitsnede.</label></div>
      <p class="hintje">Bijsnijden verstuurt niets naar AI. Met de aparte AI-knop verstuur je deze uitsnede naar Claude (Anthropic). Controleer zelf dat er geen persoonsgegevens of vertrouwelijke bedrijfsinformatie in staan.</p>
      <div class="sheet-actions"><button class="btn ghost" id="cropCancel">Annuleren</button><button class="btn primary" id="cropUse" disabled>Alleen deze uitsnede gebruiken</button></div>
    </div>`;
    document.body.appendChild(overlay);
    const get = id=>overlay.querySelector('#'+id);
    const canvas = get('cropCanvas');
    const scale = Math.min(1,700/Math.max(img.naturalWidth,img.naturalHeight));
    canvas.width = Math.max(1,Math.round(img.naturalWidth*scale));
    canvas.height = Math.max(1,Math.round(img.naturalHeight*scale));
    let cropped = null, dragStart = null, processing = false, finished = false;
    function render(){
      get('cropConfirm').checked = false;
      get('cropUse').disabled = true;
      const edges = Object.fromEntries(['left','top','right','bottom'].map(key=>{
        const value = Number(get('crop-'+key).value);
        get('crop-'+key+'-value').textContent = value+'%';
        return [key,value];
      }));
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      try{
        const x = Math.floor(img.naturalWidth*edges.left/100);
        const y = Math.floor(img.naturalHeight*edges.top/100);
        const right = Math.floor(img.naturalWidth*edges.right/100);
        const bottom = Math.floor(img.naturalHeight*edges.bottom/100);
        cropped = maakDocumentUitsnede(img,{x,y,w:right-x,h:bottom-y});
        get('cropPreview').src = cropped.dataUrl;
        get('cropError').textContent = '';
        ctx.strokeStyle = '#e53935'; ctx.lineWidth = 3;
        ctx.strokeRect(canvas.width*edges.left/100,canvas.height*edges.top/100,
          canvas.width*(edges.right-edges.left)/100,canvas.height*(edges.bottom-edges.top)/100);
      }catch(error){
        cropped = null; get('cropPreview').removeAttribute('src');
        get('cropError').textContent = error.message;
      }
    }
    function point(event){
      const box = canvas.getBoundingClientRect();
      return {x:Math.round(Math.min(100,Math.max(0,(event.clientX-box.left)/box.width*100))),
        y:Math.round(Math.min(100,Math.max(0,(event.clientY-box.top)/box.height*100)))};
    }
    canvas.addEventListener('pointerdown',event=>{
      if(processing) return;
      dragStart = point(event); canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove',event=>{
      if(processing || !dragStart) return;
      const end = point(event);
      get('crop-left').value = Math.min(dragStart.x,end.x);
      get('crop-top').value = Math.min(dragStart.y,end.y);
      get('crop-right').value = Math.max(dragStart.x,end.x);
      get('crop-bottom').value = Math.max(dragStart.y,end.y);
      render();
    });
    canvas.addEventListener('pointerup',()=>{dragStart=null;});
    canvas.addEventListener('pointercancel',()=>{dragStart=null;});
    overlay.querySelectorAll('input[type=range]').forEach(input=>input.addEventListener('input',render));
    get('cropConfirm').addEventListener('change',()=>{get('cropUse').disabled = !cropped || !get('cropConfirm').checked;});
    function finish(result){
      if(finished) return;
      finished = true; overlay.remove(); img.src=''; resolve(result);
    }
    get('cropCancel').addEventListener('click',()=>finish(null));
    get('cropUse').addEventListener('click',async()=>{
      if(processing || !cropped || !get('cropConfirm').checked) return;
      const selection = cropped;
      processing = true;
      get('cropUse').disabled = true;
      overlay.querySelectorAll('input').forEach(input=>{input.disabled=true;});
      try{
        const blob = await (await fetch(selection.dataUrl)).blob();
        finish({...selection,blob});
      }catch(error){
        if(finished) return;
        processing = false;
        overlay.querySelectorAll('input').forEach(input=>{input.disabled=false;});
        get('cropError').textContent='Uitsnede maken mislukt: '+error.message;
        get('cropUse').disabled=!cropped || !get('cropConfirm').checked;
      }
    });
    render();
  });
}

function toonAiScanKeuze(){
  const box = document.getElementById('docAiStatus');
  if(box){
    box.className='status';
    box.innerHTML='<p>Uitsnede klaar. Vul leverancier en datum zelf in. AI ontvangt alleen deze uitsnede.</p><button type="button" class="btn ghost" id="btnAiUitsnede">Productregels uitlezen met Claude</button>';
    document.getElementById('btnAiUitsnede').addEventListener('click',aiScanDocument);
  }
}

// Camerafoto's zijn 10+ MB; die eerst terugbrengen naar iets dat uploadt en dat de AI aankan.
async function verkleinAfbeelding(file, maxZijde = 2000, kwaliteit = 0.82){
  const dataUrl = await leesDataUrl(file);
  const img = await new Promise((res,rej)=>{
    const im = new Image();
    im.onload = ()=>res(im);
    im.onerror = ()=>rej(new Error('geen geldige afbeelding'));
    im.src = dataUrl;
  });
  const schaal = Math.min(1, maxZijde / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * schaal));
  const h = Math.max(1, Math.round(img.height * schaal));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  const jpeg = cv.toDataURL('image/jpeg', kwaliteit);
  return { dataUrl: jpeg, base64: jpeg.split(',')[1], w, h };
}

async function fotoNaarPdf(klein){
  const { jsPDF } = window.jspdf || {};
  if(!jsPDF) throw new Error('pdf-tool niet geladen (geen internet?)');
  const doc = new jsPDF({ orientation: klein.w > klein.h ? 'landscape' : 'portrait', unit:'px', format:[klein.w, klein.h] });
  doc.addImage(klein.dataUrl, 'JPEG', 0, 0, klein.w, klein.h);
  return doc.output('blob');
}

async function uploadDocBestand(blob, naam){
  const path = `docs/${Date.now()}_${naam.replace(/[^a-zA-Z0-9.]/g,'_')}`;
  const res = await fetch(`${SB_URL}/storage/v1/object/${DOCS_BUCKET}/${path}`, {
    method:'POST',
    headers:{ 'apikey': SB_KEY, 'Authorization': `Bearer ${getAccessToken() || SB_KEY}`, 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob
  });
  if(!res.ok){
    const body = await res.text().catch(()=> '');
    throw new Error(`${res.status} ${body.slice(0,140)}`);
  }
  return path;
}

// Prive bucket: bestanden zijn alleen bereikbaar via een link van 1 uur.
async function signedDocUrl(path){
  const res = await fetch(`${SB_URL}/storage/v1/object/sign/${DOCS_BUCKET}/${path}`, {
    method:'POST',
    headers:{ 'apikey': SB_KEY, 'Authorization': `Bearer ${getAccessToken() || SB_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ expiresIn: 3600 })
  });
  if(!res.ok) throw new Error('kon geen link maken (' + res.status + ')');
  const j = await res.json();
  return SB_URL + '/storage/v1' + j.signedURL;
}
async function openDocBestand(path, oudeUrl){
  const tab = window.open('', '_blank');
  try{
    const url = path ? await signedDocUrl(path) : oudeUrl;
    if(!url) throw new Error('geen bestand');
    if(tab) tab.location = url; else window.location = url;
  }catch(e){
    if(tab) tab.close();
    toast('Bestand openen mislukt: ' + (e.message||e));
  }
}
async function verwijderDocBestand(path){
  if(!path) return;
  try{
    const response = await fetch(`${SB_URL}/storage/v1/object/${DOCS_BUCKET}/${path}`, {
      method:'DELETE',
      headers:{ 'apikey': SB_KEY, 'Authorization': `Bearer ${getAccessToken() || SB_KEY}` }
    });
    if(!response.ok) throw new Error('Opslag verwijderen gaf HTTP ' + response.status);
    return true;
  }catch(error){
    console.error('WerkHub: documentbestand opruimen mislukt', error);
    toast('Bestand kon niet worden opgeruimd: ' + error.message);
    return false;
  }
}

// ---- AI: leest de scan uit en vult de velden ----
const AI_SCAN_SYSTEM = `Je leest Nederlandse bonnen, offertes en bestelbevestigingen en haalt daar de administratieve gegevens uit.
Antwoord UITSLUITEND met geldige JSON, geen uitleg, geen codeblok:
{"type":"offerte|bon|bestelling","titel":"","leverancier":"","factuurnummer":"","datum":"YYYY-MM-DD","bedrag_incl":null,"bedrag_excl":null,"btw_bedrag":null,"btw_pct":null,"regels":[{"omschrijving":"","aantal":null,"bedrag":null}]}
Regels:
- titel: korte omschrijving van max 6 woorden, in het Nederlands.
- leverancier: de partij die het document stuurt (winkel/bedrijf), niet de ontvanger.
- bedragen: gewoon getal met punt als decimaalteken, zonder euroteken of duizendtalscheiding.
- bedrag_incl is het eindtotaal inclusief btw, bedrag_excl het subtotaal exclusief btw.
- Verzin niets. Staat iets er niet, dan null (of "" bij tekstvelden). Enige uitzondering: staan incl en excl er allebei maar het btw-bedrag niet, dan mag je het verschil nemen.
- type: "bon" bij een kassabon/aankoopbewijs/factuur, "offerte" bij een prijsopgave, "bestelling" bij een bestelbevestiging.
- regels: de productregels, maximaal 25, bedrag per regel is de regelprijs.`;

async function aiScanDocument(){
  const bron = window._docScanBron;
  const box = document.getElementById('docAiStatus');
  const save = document.getElementById('btnSaveDoc');
  if(!bron || !box || !save || save.disabled){toast('Kies eerst een uitsnede en wacht tot de verwerking klaar is');return;}
  if(!confirm('Deze uitsnede wordt naar Claude (Anthropic) verstuurd. Bevestig dat er geen persoonsgegevens of vertrouwelijke bedrijfsinformatie in staan. Versturen?')) return;
  save.disabled=true;
  box.textContent='Claude leest de productregels…';
  try{
    const regels = await leesProductUitsnede(bron.base64);
    if(!save.isConnected) return;
    vulDocVelden({regels});
    window._docAiGescand=true;
    box.textContent='Productregels uitgelezen. Controleer omschrijvingen, aantallen en bedragen voordat je opslaat.';
  }catch(error){
    if(box.isConnected) box.textContent='AI-uitlezen mislukt: '+error.message;
    console.error('WerkHub AI-uitlezen mislukt',error);
  }finally{
    save.disabled=false;
    if(box.isConnected){
      const retry=document.createElement('button');
      retry.type='button';retry.className='btn ghost';
      retry.textContent='Productregels opnieuw uitlezen met Claude';
      retry.addEventListener('click',aiScanDocument);
      box.appendChild(retry);
    }
  }
}

async function leesProductUitsnede(base64){
  const data=await aiMessages({
    model:AI_SCAN_MODEL,max_tokens:2500,
    system:'Lees uitsluitend productregels uit deze uitsnede. Geef alleen JSON: {"regels":[{"omschrijving":"", "aantal":null, "bedrag":null}]}. Maximaal 25 regels. Verzin niets; onleesbare aantallen of bedragen zijn null. Geen persoonsgegevens, leverancier of documentgegevens teruggeven.',
    messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:base64}},{type:'text',text:'Lees de productregels uit.'}]}]
  });
  const raw=(data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('').trim();
  const parsed=JSON.parse(raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
  if(!Array.isArray(parsed.regels) || parsed.regels.length>25 ||
    parsed.regels.some(r=>!r || typeof r.omschrijving!=='string' ||
      (r.aantal!==null && (!Number.isFinite(r.aantal) || r.aantal<0)) ||
      (r.bedrag!==null && !Number.isFinite(r.bedrag)))){
    throw new Error('Ongeldig AI-resultaat; productregels niet overgenomen');
  }
  return parsed.regels.map(r=>({omschrijving:r.omschrijving,aantal:r.aantal,bedrag:r.bedrag}));
}

function zetVeld(id, waarde){
  const el = document.getElementById(id);
  if(el && waarde !== null && waarde !== undefined && waarde !== '') el.value = waarde;
}
function vulDocVelden(p){
  if((window._docRegels||[]).some(r=>typeof r.ontvangen==='boolean') &&
      !confirm('Een nieuwe scan vervangt de productregels en hun ontvangstvinkjes. Doorgaan?')){
    throw new Error('Scan niet overgenomen; bestaande productregels behouden');
  }
  if(p.type && docTypeLabels[p.type]) pickDocType(p.type);
  zetVeld('fDocTitel', p.titel);
  zetVeld('fDocLev', p.leverancier);
  zetVeld('fDocFactuur', p.factuurnummer);
  zetVeld('fDocBedrag', p.bedrag_incl);
  zetVeld('fDocBedragExcl', p.bedrag_excl);
  zetVeld('fDocBtw', p.btw_bedrag);
  zetVeld('fDocBtwPct', p.btw_pct);
  if(/^\d{4}-\d{2}-\d{2}$/.test(p.datum||'')) zetVeld('fDocDatum', p.datum);
  window._docRegels = Array.isArray(p.regels)
    ? p.regels.slice(0,25).map(r=>({...r, ontvangen:null})) : [];
  const ontvangst = document.getElementById('fDocOntvangen');
  if(ontvangst){ ontvangst.checked=false; ontvangst.indeterminate=true; }
  tekenRegels();
}
function productOntvangst(regels){
  if(!regels.length) return null;
  if(regels.every(r=>r.ontvangen===true)) return true;
  if(regels.some(r=>r.ontvangen===false)) return false;
  return null;
}
function syncProductOntvangst(){
  const veld = document.getElementById('fDocOntvangen');
  if(!veld || !(window._docRegels||[]).length) return;
  const status = productOntvangst(window._docRegels);
  veld.checked = status===true;
  veld.indeterminate = status===null;
}
function tekenRegels(){
  const host = document.getElementById('docRegels');
  if(!host) return;
  const r = window._docRegels || [];
  if(!r.length){ host.innerHTML = ''; return; }
  host.innerHTML = `
    <div class="field"><label>📦 Producten (${r.length})</label>
      <p class="hintje">Vink per product aan of het volledig binnen is. Een streepje betekent: ontvangst nog niet ingevuld. Bewaar met Opslaan.</p>
      <div class="regels">${r.map((x,i)=>`
        <div class="r">
          <label style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" data-product-ontvangst="${i}" aria-label="${escapeHtml(String(x.omschrijving||'Product'))} volledig binnen" ${x.ontvangen===true?'checked':''}>
            <span>${escapeHtml(String(x.omschrijving||'—'))}${x.aantal ? ` <em style="color:var(--sub)">×${escapeHtml(String(x.aantal))}</em>` : ''}</span>
          </label>
          <span>${x.bedrag != null && x.bedrag !== '' ? '€ ' + Number(x.bedrag).toFixed(2) : ''}</span>
        </div>`).join('')}
      </div>
    </div>`;
  host.querySelectorAll('[data-product-ontvangst]').forEach(veld=>{
    const regel = r[Number(veld.dataset.productOntvangst)];
    veld.indeterminate = typeof regel.ontvangen !== 'boolean';
    veld.addEventListener('change', ()=>{
      regel.ontvangen = veld.checked;
      syncProductOntvangst();
    });
  });
}

async function loadDocs(){
  if(toonDocsSlot()) return;
  const host = document.getElementById('docsList');
  host.innerHTML = '<div class="empty-state">Laden…</div>';
  const q = huidigDocFilter==='alle' ? '' : `&type=eq.${huidigDocFilter}`;
  const docs = await sb(`work_docs?order=datum.desc.nullslast,created_at.desc${q}`);
  if(!docs.length){ host.innerHTML = '<div class="empty-state">Nog niks hier. Scan een bonnetje of offerte.</div>'; return; }
  host.innerHTML = docs.map(d=>`
    <div class="card" onclick="openDocSheet('${d.id}')">
      <div class="titel">${escapeHtml(d.titel)}</div>
      <div class="meta">
        <span class="badge ${d.type}">${docTypeLabels[d.type]}</span>
        <span class="badge">${d.ontvangen === true ? '✓ Binnen / ontvangen' : d.ontvangen === false ? 'Nog niet binnen' : 'Ontvangst niet ingevuld'}</span>
        ${d.leverancier ? `<span>🏷️ ${escapeHtml(d.leverancier)}</span>` : ''}
        ${d.bedrag != null ? `<span>€ ${Number(d.bedrag).toFixed(2)}</span>` : ''}
        ${d.bedrag_excl != null ? `<span style="color:var(--sub)">excl. € ${Number(d.bedrag_excl).toFixed(2)}</span>` : ''}
        ${d.datum ? `<span>📅 ${new Date(d.datum).toLocaleDateString('nl-NL',{day:'numeric',month:'short'})}</span>` : ''}
        ${(d.regels||[]).length ? `<span style="color:var(--sub)">📦 ${d.regels.length}</span>` : ''}
        ${(d.levering_fotos||[]).length ? `<span>📷 ${d.levering_fotos.length} leveringsfoto('s)</span>` : ''}
        ${(d.bestand_path || d.bestand_url) ? `<a href="#" class="doclink" data-path="${escapeHtml(d.bestand_path||'')}" data-url="${escapeHtml(d.bestand_url||'')}" style="color:var(--blue); font-weight:600">bestand ↗</a>` : ''}
      </div>
    </div>
  `).join('');
}

function getal(id){
  const el = document.getElementById(id);
  const raw = (el ? el.value : '').trim().replace(/[€\s]/g,'').replace(',', '.');
  if(!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

async function openDocSheet(id){
  let d = {type:'offerte', titel:'', leverancier:'', bedrag:'', bedrag_excl:'', btw_bedrag:'', btw_pct:'',
           factuurnummer:'', datum:'', notitie:'', bestand_url:'', bestand_path:'', regels:[]};
  if(id){ const rows = await sb(`work_docs?id=eq.${id}`); d = rows[0]; }
  window._docBestandBlob = null;
  window._docBestandNaam = null;
  window._docScanBron = null;
  window._docAiGescand = false;
  window._docStatusType = d.type;
  window._docRegels = Array.isArray(d.regels) ? d.regels.map(r=>({...r})) : [];
  const leveringFotos = Array.isArray(d.levering_fotos) ? d.levering_fotos.map(f=>({...f})) : [];
  const nieuweFotos = [];

  openSheet(`
    <button class="closex" onclick="closeSheet()">✕</button>
    <h2>${id ? 'Bewerken' : 'Nieuw'} — offerte / bon / bestelling</h2>

    <div class="scanbox">
      <div class="sheet-actions" style="margin-top:0">
        <button class="btn ghost" type="button" onclick="document.getElementById('scanInput').click()">📷 Scan met camera</button>
        <button class="btn ghost" type="button" onclick="document.getElementById('fileInput').click()">📎 Kies bestand</button>
      </div>
      <div id="docScanThumb"></div>
      <div class="status" id="docScanStatus">${
        (d.bestand_path || d.bestand_url)
          ? `Er hangt al een bestand aan. <a href="#" class="doclink" data-path="${escapeHtml(d.bestand_path||'')}" data-url="${escapeHtml(d.bestand_url||'')}" style="color:var(--blue); font-weight:600">bekijken ↗</a>`
          : 'Fotografeer de productregels en snijd bij. Daarna kun je de uitsnede met Claude uitlezen.'
      }</div>
      <div class="status" id="docAiStatus"></div>
    </div>

    <div class="field"><label>Type</label>
      <div class="segrow" id="docTypeRow">
        ${Object.keys(docTypeLabels).map(t=>`<button data-t="${t}" class="${d.type===t?'sel':''}" onclick="pickDocType('${t}')">${docTypeLabels[t]}</button>`).join('')}
      </div>
    </div>
    <div class="field"><label>Titel / omschrijving</label><input type="text" id="fDocTitel" value="${escapeHtml(d.titel)}" placeholder="bijv. Offerte loodgieter pompstation"></div>
    <div class="field"><label>🏷️ Leverancier / winkel</label><input type="text" id="fDocLev" value="${escapeHtml(d.leverancier||'')}"></div>
    <div class="field"><label><input type="checkbox" id="fDocOntvangen" ${d.ontvangen?'checked':''}> Alles binnen / ontvangen</label>
      <p class="hintje">Met producten: dit vinkje zet alle productregels binnen of niet binnen. Een streepje betekent nog niet volledig ingevuld. Bewaar je keuze met Opslaan.</p>
    </div>

    <div class="bedragrij">
      <div class="field"><label>€ Incl. btw</label><input type="text" inputmode="decimal" id="fDocBedrag" value="${d.bedrag ?? ''}" placeholder="149.95"></div>
      <div class="field"><label>€ Excl. btw</label><input type="text" inputmode="decimal" id="fDocBedragExcl" value="${d.bedrag_excl ?? ''}" placeholder="123.93"></div>
    </div>
    <div class="bedragrij">
      <div class="field"><label>€ Btw</label><input type="text" inputmode="decimal" id="fDocBtw" value="${d.btw_bedrag ?? ''}" placeholder="26.02"></div>
      <div class="field"><label>Btw %</label><input type="text" inputmode="decimal" id="fDocBtwPct" value="${d.btw_pct ?? ''}" placeholder="21"></div>
    </div>
    <div class="bedragrij">
      <div class="field"><label>📅 Datum</label><input type="date" id="fDocDatum" value="${d.datum||''}"></div>
      <div class="field"><label># Factuur / bon</label><input type="text" id="fDocFactuur" value="${escapeHtml(d.factuurnummer||'')}"></div>
    </div>

    <div id="docRegels"></div>

    <div class="field">
      <label>📷 Nieuwe levering / pakbon fotograferen</label>
      <div class="field"><label>Leverancier bij deze levering</label><input id="fLeveringBedrijf" type="text" value="${escapeHtml(d.leverancier||'')}"></div>
      <div class="field"><label>Leverdatum</label><input id="fLeveringDatum" type="date" value="${isoDatum(new Date())}"></div>
      <input type="file" id="fLeveringFoto" accept="image/*" capture="environment">
      <p class="hintje">Snijd alleen de productregels uit. Alleen die uitsnede wordt bewaard. Met de aparte AI-knop kun je productregels uitlezen; ontvangst bevestig je zelf.</p>
      <div id="leveringFotoList"></div>
      <div id="leveringFotoStatus" class="hintje" role="status"></div>
    </div>

    <div class="field"><label>Notitie</label><textarea id="fDocNotitie">${escapeHtml(d.notitie||'')}</textarea></div>

    <div class="sheet-actions">
      ${id ? `<button class="btn danger" onclick="deleteDoc('${id}')">Verwijder</button>` : ''}
      <button class="btn primary" id="btnSaveDoc">Opslaan</button>
    </div>
  `);
  tekenRegels();
  document.getElementById('fDocOntvangen').indeterminate = !!id && d.ontvangen == null;
  syncProductOntvangst();
  document.getElementById('fDocOntvangen').addEventListener('change', e=>{
    if(!window._docRegels.length) return;
    window._docRegels.forEach(r=>{ r.ontvangen=e.target.checked; });
    tekenRegels();
  });
  const fotoStatus = document.getElementById('leveringFotoStatus');
  const fotoInput = document.getElementById('fLeveringFoto');
  function renderLeveringFotos(){
    document.getElementById('leveringFotoList').innerHTML = leveringFotos.map(f=>`
      <p><a href="#" class="doclink" data-path="${escapeHtml(f.path)}" style="color:var(--blue)">📷 ${escapeHtml(f.naam||'Leveringsfoto')} ↗</a>
      ${f.created_at ? escapeHtml(new Date(f.created_at).toLocaleDateString('nl-NL')) : ''}</p>
      ${f.leverdatum ? `<p>${escapeHtml(f.leverdatum)} · ${escapeHtml(f.leverancier||'')}</p>` : ''}
      ${Array.isArray(f.ai_regels) ? `<p>${f.ai_regels.map(r=>escapeHtml(r.omschrijving)+' × '+escapeHtml(String(r.aantal??'[CONTROLEREN]'))).join('<br>')}</p>` : ''}
    `).join('') + nieuweFotos.map((f,i)=>`<p>📷 ${escapeHtml(f.naam)} · ${escapeHtml(f.leverdatum)} · ${escapeHtml(f.leverancier)} (opslaan met de offerte)</p>
      <button type="button" class="btn ghost" data-levering-ai="${i}">Pakbonregels uitlezen met Claude</button>
      ${f.ai_regels ? `<p>${f.ai_regels.map(r=>escapeHtml(r.omschrijving)+' × '+escapeHtml(String(r.aantal??'[CONTROLEREN]'))).join('<br>')}</p>` : ''}`).join('');
    document.querySelectorAll('[data-levering-ai]').forEach(button=>button.addEventListener('click',async()=>{
      const save=document.getElementById('btnSaveDoc');
      if(save.disabled) return;
      if(!confirm('Alleen deze pakbonuitsnede wordt naar Claude (Anthropic) verstuurd. Bevestig dat er geen persoonsgegevens of vertrouwelijke bedrijfsinformatie in staan. Versturen?')) return;
      const foto=nieuweFotos[Number(button.dataset.leveringAi)];
      save.disabled=true;button.disabled=true;
      fotoStatus.textContent='Claude leest de pakbonregels…';
      try{
        const regels=await leesProductUitsnede(await leesBase64(foto.blob));
        if(!save.isConnected) return;
        foto.ai_regels=regels;
        renderLeveringFotos();
        fotoStatus.textContent='Pakbonregels uitgelezen. Vergelijk met de offerte; ontvangstvinkjes zijn niet aangepast.';
      }catch(error){
        fotoStatus.textContent='AI-uitlezen mislukt: '+error.message;
        console.error('WerkHub pakbon uitlezen mislukt',error);
      }finally{save.disabled=false;button.disabled=false;}
    }));
  }
  renderLeveringFotos();
  fotoInput.addEventListener('change', async ()=>{
    const file = fotoInput.files[0];
    if(!file) return;
    const leverancier = document.getElementById('fLeveringBedrijf').value.trim();
    const leverdatum = document.getElementById('fLeveringDatum').value;
    if(!leverancier || !leverdatum){fotoStatus.textContent='Vul leverancier en leverdatum in voordat je een foto kiest';fotoInput.value='';return;}
    const save = document.getElementById('btnSaveDoc');
    if(save.disabled){fotoStatus.textContent='Wacht tot de huidige verwerking klaar is';fotoInput.value='';return;}
    fotoInput.disabled = true; save.disabled = true;
    fotoStatus.textContent = 'Foto voorbereiden…';
    try{
      const klein = await snijDocumentFoto(file);
      if(!save.isConnected) return;
      if(!klein){fotoStatus.textContent='Bijsnijden geannuleerd; geen foto toegevoegd';return;}
      nieuweFotos.push({blob:klein.blob, naam:'levering_productregels_'+Date.now()+'.jpg',
        leverancier,leverdatum,created_at:new Date().toISOString(), path:null});
      renderLeveringFotos();
      fotoStatus.textContent = 'Foto klaar. Vergelijk de producten en klik op Opslaan. Sluiten zonder opslaan bewaart de foto niet.';
    }catch(error){
      fotoStatus.textContent = 'Foto verwerken mislukt: ' + error.message;
    }finally{
      fotoInput.value = ''; fotoInput.disabled = false; save.disabled = false;
    }
  });

  document.getElementById('btnSaveDoc').addEventListener('click', async ()=>{
    const btn = document.getElementById('btnSaveDoc');
    if(btn.disabled) return;
    const titel = document.getElementById('fDocTitel').value.trim();
    if(!titel){ toast('Vul een titel/omschrijving in'); return; }
    if(window._docBestandBlob && (!document.getElementById('fDocLev').value.trim() || !document.getElementById('fDocDatum').value)){
      toast('Vul leverancier en documentdatum in voor deze uitsnede'); return;
    }
    btn.disabled = true;
    fotoInput.disabled = true;
    try{
      let bestand_path = d.bestand_path || null;
      let bestand_url  = d.bestand_url || null;
      if(window._docBestandBlob){
        toast('Bestand uploaden…');
        bestand_path = await uploadDocBestand(window._docBestandBlob, window._docBestandNaam);
        bestand_url = null;               // nieuw bestand staat in de prive bucket
      }
      for(const foto of nieuweFotos){
        if(!foto.path) foto.path = await uploadDocBestand(foto.blob, foto.naam);
      }
      const payload = {
        type: window._docStatusType,
        titel,
        leverancier: document.getElementById('fDocLev').value.trim(),
        ontvangen: window._docRegels.length ? productOntvangst(window._docRegels)
          : document.getElementById('fDocOntvangen').indeterminate
            ? null : document.getElementById('fDocOntvangen').checked,
        bedrag: getal('fDocBedrag'),
        bedrag_excl: getal('fDocBedragExcl'),
        btw_bedrag: getal('fDocBtw'),
        btw_pct: getal('fDocBtwPct'),
        factuurnummer: document.getElementById('fDocFactuur').value.trim() || null,
        datum: document.getElementById('fDocDatum').value || null,
        notitie: document.getElementById('fDocNotitie').value.trim(),
        regels: window._docRegels || [],
        levering_fotos: [...leveringFotos, ...nieuweFotos.map(({path,naam,created_at,leverancier,leverdatum,ai_regels})=>({path,naam,created_at,leverancier,leverdatum,...(ai_regels?{ai_regels}:{})}))],
        bestand_path,
        bestand_url,
        ...(window._docAiGescand ? { ai_gescand_op: new Date().toISOString() } : {})
      };
      if(id){
        await sb(`work_docs?id=eq.${id}`, {method:'PATCH', body: JSON.stringify(payload)});
      }else{
        await sb('work_docs', {method:'POST', body: JSON.stringify(payload)});
      }
      if(d.bestand_path && d.bestand_path!==bestand_path) await verwijderDocBestand(d.bestand_path);
      closeSheet(); toast('Opgeslagen'); loadDocs();
    }catch(e){
      btn.disabled = false;
      fotoInput.disabled = false;
      toast('Opslaan mislukt: ' + (e.message||e));
      console.error('opslaan doc mislukt', e);
    }
  });
}
function pickDocType(t){
  window._docStatusType = t;
  document.querySelectorAll('#docTypeRow button').forEach(b=>b.classList.toggle('sel', b.dataset.t===t));
}
async function deleteDoc(id){
  if(!confirm('Deze offerte / bon / bestelling en bijbehorende leveringsfoto’s verwijderen?')) return;
  const rows = await sb(`work_docs?id=eq.${id}&select=bestand_path,levering_fotos`);
  await sb(`work_docs?id=eq.${id}`, {method:'DELETE'});
  if(rows && rows[0] && rows[0].bestand_path) verwijderDocBestand(rows[0].bestand_path);
  for(const foto of rows?.[0]?.levering_fotos||[]) await verwijderDocBestand(foto.path);
  closeSheet(); toast('Verwijderd'); loadDocs();
}

async function dumpNaarProject(id){
  const items = await sb(`work_items?id=eq.${id}`);
  const item = items[0];
  openTaskSheet(null, 'pwn', item.tekst, item.id);
}
