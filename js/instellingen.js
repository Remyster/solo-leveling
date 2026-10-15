// ============ SETTINGS ============
async function reminderApi(action, body){
  if(!await requireAuth()) throw new Error('Log opnieuw in om herinneringen in te stellen');
  const response = await fetch(`${SB_URL}/functions/v1/werkhub-reminders/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${getAccessToken()}`,
      'Content-Type':'application/json'
    },
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  const data = await response.json();
  if(!response.ok){
    if(response.status === 404) throw new Error('Herinneringenserver is nog niet gepubliceerd');
    throw new Error(`Herinneringenserver: ${data.error || response.status}`);
  }
  return data;
}

function vapidBytes(key){
  const padded = (key + '='.repeat((4-key.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(padded), c=>c.charCodeAt(0));
}

async function openReminderSettings(){
  openSheet(`
    <button class="closex" onclick="closeSheet()">✕</button>
    <h2>Herinneringen</h2>
    <p style="font-size:13px">Nederlandse tijd. E-mail en push bevatten geen taaknamen of locaties. WhatsApp gebruikt alleen de titel en eventueel de deadline van een nieuwe persoonlijke PWN-taak. WhatsApp en de provider verwerken dit extern.</p>
    <div class="field"><label><input type="checkbox" id="rDaily"> Overzichtsmail om 20:00 voor morgen</label></div>
    <div class="field"><label><input type="checkbox" id="rEmail"> E-mail 45 minuten voor begintijd</label></div>
    <div class="field"><label><input type="checkbox" id="rPush"> Push 45 minuten voor begintijd</label></div>
    <div class="field"><label><input type="checkbox" id="rWa"> Ik geef opt-in voor WhatsApp bij een nieuwe persoonlijke PWN-taak</label></div>
    <p style="font-size:12px">Teamacties, subtaken en wijzigingen aan bestaande taken sturen geen WhatsApp. WhatsApp vereist een geregistreerde afzender en goedgekeurde template. Zet dit pas aan nadat die inrichting klaar is.</p>
    <div id="rStatus" role="status" style="font-size:13px; margin-bottom:12px">Serverstatus laden...</div>
    <div class="sheet-actions"><button class="btn ghost" id="rRegister" disabled>Meldingen op dit toestel toestaan</button></div>
    <div class="sheet-actions"><button class="btn primary" id="rSave" disabled>Herinneringen opslaan</button></div>
    <div class="sheet-actions"><button class="btn ghost" id="rTestEmail" disabled>Testmail</button><button class="btn ghost" id="rTestPush" disabled>Testmelding</button><button class="btn ghost" id="rTestWa" disabled>Test WhatsApp</button></div>
    <p style="font-size:12px">In mockmodus verstuurt de WhatsApp-test niets. In livemodus verstuurt de test na jouw klik één goedgekeurd templatebericht. Controleer daarna echte ontvangst.</p>
  `);
  const status = document.getElementById('rStatus');
  const daily = document.getElementById('rDaily');
  const email = document.getElementById('rEmail');
  const push = document.getElementById('rPush');
  const whatsapp = document.getElementById('rWa');
  const save = document.getElementById('rSave');
  const register = document.getElementById('rRegister');
  const testEmail = document.getElementById('rTestEmail');
  const testPush = document.getElementById('rTestPush');
  const testWa = document.getElementById('rTestWa');
  let publicKey;
  try{
    const data = await reminderApi('status');
    if(!status.isConnected) return;
    daily.checked = !!data.settings?.daily_email;
    email.checked = !!data.settings?.task_email;
    push.checked = !!data.settings?.task_push;
    whatsapp.checked = !!data.whatsappEnabled;
    publicKey = data.vapidPublicKey;
    const checked = data.settings?.last_checked_at;
    const recent = checked && Date.now()-new Date(checked).getTime() < 10*60000;
    status.textContent = recent
      ? `Servercontrole: ${new Date(checked).toLocaleTimeString('nl-NL')}. ${data.subscriptions} toestel(len) geregistreerd.`
      : 'Nog geen recente servercontrole. Herinneringen zijn niet bewezen actief; controleer de cron-instelling.';
    if(data.failures.length) status.textContent += ` ${data.failures.length} verzending(en) mislukt; controleer de server.`;
    if(!data.emailConfigured) status.textContent += ' Maildienst nog niet ingesteld.';
    if(!data.whatsappConfigured) status.textContent += ' WhatsApp nog niet geconfigureerd; zet Twilio/Meta met template en opt-in op in Supabase-secrets.';
    else if(data.whatsappMode === 'mock') status.textContent += ' WhatsApp staat in veilige mockmodus; er wordt niets extern verstuurd.';
    if(data.whatsappIssues?.length) status.textContent += ` WhatsApp heeft ${data.whatsappIssues.length} niet-afgeronde verzending(en); controleer de veilige foutcodes in Supabase.`;
    save.disabled = false;
    register.disabled = !publicKey || !('PushManager' in window) || !('Notification' in window);
    testEmail.disabled = !data.emailConfigured;
    testWa.disabled = !data.whatsappConfigured;
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    const subscription = registration?.pushManager ? await registration.pushManager.getSubscription() : null;
    const onIphone = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const beginscherm = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const toegestaan = 'Notification' in window && Notification.permission === 'granted';
    const ditToestel = !!subscription && toegestaan;
    testPush.disabled = !publicKey || data.subscriptions === 0 || !ditToestel;
    if(onIphone && !beginscherm){
      register.disabled = true;
      status.textContent += ' Open WerkHub via het beginscherm, niet als Safari-tabblad. Safari > Deel > Zet op beginscherm.';
    }else if(!ditToestel){
      status.textContent += ' Dit toestel is nog niet aangemeld of meldingen zijn geblokkeerd. Gebruik de registratieknop.';
    }else{
      status.textContent += ' Dit toestel heeft meldingstoestemming. Registreer opnieuw als een test niet aankomt.';
    }
    if(data.failures.length) status.textContent += ' Foutcode: ' + data.failures.map(f=>f.last_error||'onbekend').join(', ');
    if(register.disabled) status.textContent += ' Push niet beschikbaar: controleer serverinstellingen en open op iPhone vanuit het beginscherm.';
  }catch(error){
    status.textContent = error.message;
    return;
  }
  save.addEventListener('click', async ()=>{
    save.disabled = true;
    try{
      await reminderApi('settings', {
        daily_email: daily.checked,
        task_email: email.checked,
        task_push: push.checked,
        whatsapp_enabled: whatsapp.checked,
      });
      status.textContent = 'Instellingen opgeslagen. Gebruik de tests en controleer daarna of de servercontrole recent is.';
    }catch(error){ status.textContent = error.message; }
    finally{ save.disabled = false; }
  });
  register.addEventListener('click', async ()=>{
    register.disabled = true;
    try{
      const permission = await Notification.requestPermission();
      if(permission !== 'granted') throw new Error('Meldingen niet toegestaan. Zet WerkHub aan bij iPhone > Instellingen > Meldingen en probeer opnieuw vanuit het beginscherm.');
      const registration = await navigator.serviceWorker.getRegistration();
      if(!registration?.active) throw new Error('Service worker nog niet actief. Heropen WerkHub vanaf het beginscherm.');
      let subscription = await registration.pushManager.getSubscription();
      if(subscription){
        const key = subscription.options.applicationServerKey;
        const expected = vapidBytes(publicKey);
        const actual = key ? new Uint8Array(key) : null;
        if(!actual || actual.length!==expected.length || actual.some((value,i)=>value!==expected[i])){
          const endpoint = subscription.endpoint;
          if(!await subscription.unsubscribe()) throw new Error('Oude toestelregistratie kon niet worden verwijderd');
          await reminderApi('unsubscribe', {endpoint});
          subscription = null;
        }
      }
      if(!subscription) subscription = await registration.pushManager.subscribe({
        userVisibleOnly:true, applicationServerKey:vapidBytes(publicKey)
      });
      await reminderApi('subscribe', subscription.toJSON());
      push.checked = true;
      testPush.disabled = false;
      await reminderApi('settings', {daily_email:daily.checked, task_email:email.checked, task_push:true});
      status.textContent = 'Dit toestel geregistreerd en push ingeschakeld. Stuur nu een testmelding en controleer ontvangst (ook Focus/Niet storen).';
    }catch(error){ status.textContent = error.message; }
    finally{ register.disabled = false; }
  });
  [[testEmail,'test-email'],[testPush,'test-push'],[testWa,'test-whatsapp']].forEach(([button,action])=>{
    button.addEventListener('click', async ()=>{
      button.disabled = true;
      try{
        const result = await reminderApi(action, {});
        const modeText = result?.mode === 'mock' ? 'testmodus' : 'verzenddienst';
        status.textContent = `Test door ${modeText} geaccepteerd. Controleer echt de inbox, meldingen of WhatsApp.`;
      }catch(error){ status.textContent = error.message; }
      finally{ button.disabled = false; }
    });
  });
}

document.getElementById('btnSettings').addEventListener('click', ()=>{
  openSheet(`
    <button class="closex" onclick="closeSheet()">✕</button>
    <h2>⚙️ Instellingen</h2>
    <div class="field"><button class="btn ghost" id="btnReminders" style="width:100%">E-mail en iPhone-meldingen instellen</button></div>
    <div class="field">
      <label>Anthropic API-key — reserve, meestal niet nodig</label>
      <input type="text" id="fAiKey" value="${escapeHtml(getAiKey())}" placeholder="sk-ant-...">
      <div style="font-size:12px; color:var(--sub); margin-top:6px">
        De AI loopt via de Supabase-proxy, dus dit hoeft normaal niet ingevuld.
        Vul je hier wel iets in, dan wordt dat alleen gebruikt als de proxy niet reageert.
        Blijft dan lokaal op dit toestel.
      </div>
    </div>
    <div class="field">
      <label>🔒 Pincode op Offertes &amp; bonnen</label>
      <input type="password" inputmode="numeric" id="fDocsPin" placeholder="${getDocsPinHash() ? 'ingesteld — leeg laten = ongewijzigd' : 'bijv. 4 cijfers'}">
      <div style="font-size:12px; color:var(--sub); margin-top:6px">
        Schermt de tab af op dit toestel. Je documenten staan in een privé-opslag; losse links werken niet meer.
        ${getDocsPinHash() ? '<a href="#" id="lnkPinWeg" style="color:var(--blue); font-weight:600"> Pincode verwijderen</a>' : ''}
      </div>
    </div>
    <div class="sheet-actions">
      <button class="btn primary" id="btnSaveKey" style="width:100%">Opslaan</button>
      <button class="btn" id="btnLogout" style="width:100%; margin-top:8px;">Uitloggen</button>
    </div>
  `);
  document.getElementById('btnReminders').addEventListener('click', openReminderSettings);
  document.getElementById('btnLogout').addEventListener('click', authLogout);
  const lnk = document.getElementById('lnkPinWeg');
  if(lnk) lnk.addEventListener('click', e=>{
    e.preventDefault(); setDocsPinHash(''); docsOntgrendeld = true;
    closeSheet(); toast('Pincode verwijderd'); toonDocsSlot();
  });
  document.getElementById('btnSaveKey').addEventListener('click', async ()=>{
    setAiKey(document.getElementById('fAiKey').value);
    const pin = document.getElementById('fDocsPin').value.trim();
    if(pin){ setDocsPinHash(await hashPin(pin)); docsOntgrendeld = true; }
    closeSheet(); toast('Instellingen opgeslagen');
  });
});
