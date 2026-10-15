// ============ INIT ============
async function boot(){
  const ok = await requireAuth();
  if(ok){
    document.getElementById('loginGate').classList.add('hidden');
    document.getElementById('appHeader').classList.remove('hidden');
    document.getElementById('appMain').classList.remove('hidden');
    document.getElementById('appNav').classList.remove('hidden');
    const requestedTab = new URL(location.href).searchParams.get('tab');
    if(requestedTab && tabs.includes(requestedTab)) switchTab(requestedTab);
    else loadVandaag();
  }else{
    document.getElementById('loginGate').classList.remove('hidden');
    document.getElementById('appHeader').classList.add('hidden');
    document.getElementById('appMain').classList.add('hidden');
    document.getElementById('appNav').classList.add('hidden');
  }
}
document.getElementById('btnLogin').addEventListener('click', async ()=>{
  const button = document.getElementById('btnLogin');
  if(button.disabled) return;
  const email = document.getElementById('fLoginEmail').value.trim();
  const pass = document.getElementById('fLoginPass').value;
  const errBox = document.getElementById('loginError');
  errBox.classList.add('hidden');
  if(!email || !pass){ errBox.textContent = 'Vul e-mail en wachtwoord in'; errBox.classList.remove('hidden'); return; }
  button.disabled = true;
  button.textContent = 'Inloggen…';
  errBox.setAttribute('role','alert');
  try{
    await authLogin(email, pass);
    await boot();
  }catch(e){
    errBox.textContent = e.message || 'Inloggen mislukt';
    errBox.classList.remove('hidden');
  }finally{
    button.disabled = false;
    button.textContent = 'Inloggen';
  }
});
boot().catch(error=>{
  const errBox = document.getElementById('loginError');
  errBox.textContent = 'WerkHub starten mislukt: ' + (error.message || 'onbekende fout');
  errBox.classList.remove('hidden');
  errBox.setAttribute('role','alert');
});
if('serviceWorker' in navigator && location.protocol !== 'file:'){
  navigator.serviceWorker.register('./sw.js').catch(error=>{
    console.error('WerkHub service worker registreren mislukt', error);
    toast('Meldingen niet beschikbaar: heropen WerkHub online');
  });
}
