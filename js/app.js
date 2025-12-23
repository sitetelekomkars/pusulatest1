const BAKIM_MODU = false;

function showGlobalError(message){
  // KullanÄ±cÄ±lara kÄ±rmÄ±zÄ± bant gÃ¶sterme (istek: ekran temiz kalsÄ±n)
  // Sadece konsola yaz ve (locadmin/admin ise) kÃ¼Ã§Ã¼k bir toast gÃ¶ster.
  try{ console.warn("[Pusula]", message); }catch(e){}
  try{
    const role = localStorage.getItem("sSportRole")||"";
    if(role==="admin" || role==="locadmin"){
      Swal.fire({toast:true,position:'bottom-end',icon:'warning',title:String(message||'UyarÄ±'),showConfirmButton:false,timer:2500});
    }
  }catch(e){}
}

// Apps Script URL'si
let SCRIPT_URL = localStorage.getItem("PUSULA_SCRIPT_URL") || "https://script.google.com/macros/s/AKfycby3kd04k2u9XdVDD1-vdbQQAsHNW6WLIn8bNYxTlVCL3U1a0WqZo6oPp9zfBWIpwJEinQ/exec"; // Apps Script Web App URL

// ---- API CALL helper (Menu/Yetki vs iÃ§in gerekli) ----
async function apiCall(action, payload = {}) {
  const username = (typeof currentUser !== "undefined" && currentUser) ? currentUser : (localStorage.getItem("sSportUser") || "");
  const token = (typeof getToken === "function" ? getToken() : localStorage.getItem("sSportToken")) || "";
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, username, token, ...payload })
  });
  const json = await res.json();
  if (json.result !== "success") throw new Error(json.message || json.error || "API error");
  return json;
}

// SweetAlert2 yoksa minimal yedek (sessiz kÄ±rÄ±lma olmasÄ±n)
if (typeof Swal === "undefined") {
  window.Swal = { 
    fire: (a,b,c)=>{ try{ alert((a&&a.title)||a||b||c||""); }catch(e){} },
  };
}



// Oyun DeÄiÅkenleri
let jokers = { call: 1, half: 1, double: 1 };
let doubleChanceUsed = false;
let firstAnswerIndex = -1;
const VALID_CATEGORIES = ['Teknik', 'Ä°kna', 'Kampanya', 'Bilgi'];
const MONTH_NAMES = ["Ocak", "Åubat", "Mart", "Nisan", "MayÄ±s", "Haziran", "Temmuz", "AÄustos", "EylÃ¼l", "Ekim", "KasÄ±m", "AralÄ±k"];
// --- GLOBAL DEÄÄ°ÅKENLER ---
let database = [], cardsData = [], newsData = [], sportsData = [], salesScripts = [], quizQuestions = [], quickDecisionQuestions = [];

// Data load barrier (prevents Tech/Telesales first-render flicker)
let __dataLoadedResolve;
window.__dataLoadedPromise = new Promise(r=>{ __dataLoadedResolve = r; });
let techWizardData = {}; // Teknik Sihirbaz Verisi
let currentUser = "";

// -------------------- Menu Permissions (LocAdmin) --------------------
let menuPermissions = null; // { key: {allowedGroups:[], allowedRoles:[]} }

// -------------------- HomeBlocks (Ana Sayfa blok iÃ§erikleri) --------------------
let homeBlocks = {}; // { quote:{...}, ... }

function loadHomeBlocks(){
  // herkes iÃ§in okunabilir (sheet'ten)
  return apiCall("getHomeBlocks", {}).then(res=>{
    homeBlocks = (res && res.blocks) ? res.blocks : {};
    // local fallback cache
    try{ localStorage.setItem('homeBlocksCache', JSON.stringify(homeBlocks||{})); }catch(e){}
    try{ renderHomePanels(); }catch(e){}
    return homeBlocks;
  }).catch(e=>{
    // sessiz fallback
    try{ homeBlocks = JSON.parse(localStorage.getItem('homeBlocksCache')||'{}') || {}; }catch(_){ homeBlocks = {}; }
    try{ renderHomePanels(); }catch(_){}
    return homeBlocks;
  });
}

function normalizeRole(v){
  return String(v||'').trim().toLowerCase();
}
function normalizeGroup(v){
  // normalize Turkish chars & case so comparisons work
  const s = String(v||'').trim().toLowerCase();
  const tr = s.replaceAll('Å','s').replaceAll('Å','s')
              .replaceAll('Ä±','i').replaceAll('Ä°','i')
              .replaceAll('Ä','g').replaceAll('Ä','g')
              .replaceAll('Ã¼','u').replaceAll('Ã','u')
              .replaceAll('Ã¶','o').replaceAll('Ã','o')
              .replaceAll('Ã§','c').replaceAll('Ã','c');
  // map common variants to display names used in permissions table
  if(tr.includes('telesat')) return 'TelesatÄ±Å';
  if(tr.includes('teknik')) return 'Teknik';
  if(tr.includes('chat')) return 'Chat';
  return String(v||'').trim();
}

function normalizeList(v){
  if(!v) return [];
  return String(v).split(',').map(s=>s.trim()).filter(Boolean);
}
function getMyGroup(){ return normalizeGroup(localStorage.getItem("sSportGroup")||""); }
function getMyRole(){ return normalizeRole(localStorage.getItem("sSportRole")||""); }

function isAllowedByPerm(perm){
  if(!perm) return true;
  if(perm.enabled === false) return false;
  const role=getMyRole(), grp=getMyGroup();
  const roles=perm.allowedRoles||[];
  let groups=perm.allowedGroups||[];
  // "ALL" varsa herkese aÃ§Ä±k kabul et
  if(groups.indexOf("ALL")>-1) groups=[];
  if(roles.length && roles.indexOf(role)===-1) return false;
  if(groups.length && groups.indexOf(grp)===-1) return false;
  return true;
}
function applyMenuPermissions(){
  try{
    const navButtons = document.querySelectorAll('[data-menu-key]');
    navButtons.forEach(btn=>{
      const key = btn.getAttribute('data-menu-key');
      const perm = menuPermissions && menuPermissions[key];
      btn.style.display = isAllowedByPerm(perm) ? '' : 'none';
    });
    // HÄ±zlÄ± kÄ±sayollar (ana sayfa)
    document.querySelectorAll('[data-shortcut-key]').forEach(el=>{
      const key=el.getAttribute('data-shortcut-key');
      const perm = menuPermissions && menuPermissions[key];
      el.style.display = isAllowedByPerm(perm) ? '' : 'none';
    });
  }catch(e){}
}
function loadMenuPermissions(){
  // herkes iÃ§in okunabilir
  return apiCall("getMenuPermissions", {}).then(res=>{
    if(res && res.result==="success"){
      menuPermissions = {};
      (res.items||[]).forEach(it=>{
        menuPermissions[it.key] = {
          allowedGroups: normalizeList(it.allowedGroups),
          enabled: (it.enabled === false || String(it.enabled).toUpperCase()==="FALSE") ? false : true,
          allowedRoles: normalizeList(it.allowedRoles) // backward-compat if still present
        };
      });
      applyMenuPermissions();
    }
  }).catch(()=>{});
}

// LocAdmin panel
function openMenuPermissions(){
  const role=getMyRole();
  // Ä°stek: Yetki YÃ¶netimi sadece LocAdmin rolÃ¼nde gÃ¶rÃ¼nsÃ¼n ve Ã§alÄ±ÅsÄ±n
  if(role!=="locadmin"){
    Swal.fire("Yetkisiz", "Yetki YÃ¶netimi sadece LocAdmin rolÃ¼nde kullanÄ±labilir.", "warning");
    return;
  }
  apiCall("getMenuPermissions",{}).then(res=>{
    if(!res || res.result!=="success"){
      Swal.fire("Hata","Yetkiler okunamadÄ±","error");
      return;
    }

    // GruplarÄ± backend'den al, yoksa items iÃ§inden tÃ¼ret
    let groups = (res.groups||[]).map(g=>String(g||"").trim()).filter(Boolean);
    if(!groups.length){
      const set=new Set();
      (res.items||[]).forEach(it=>{
        normalizeList(it.allowedGroups).forEach(g=>{
          const gg=String(g||"").trim();
          if(gg && gg.toUpperCase()!=="ALL") set.add(gg);
        });
      });
      groups=[...set];
    }
    // Hepsini baÅ harf bÃ¼yÃ¼t, yaygÄ±n isimleri normalize et
    const normMap={"chat":"Chat","telesatÄ±Å":"TelesatÄ±Å","telesatis":"TelesatÄ±Å","yÃ¶netim":"YÃ¶netim","yonetim":"YÃ¶netim","teknik":"Teknik"};
    groups = groups.map(g=>{
      const k=g.toLowerCase();
      return normMap[k] || (g.charAt(0).toUpperCase()+g.slice(1));
    });

    const menus = (res.items||[]);

    const rowsHtml = menus.map(m=>{
      const allowed = normalizeList(m.allowedGroups);
      const enabled = !(m.enabled === false || String(m.enabled).toUpperCase()==="FALSE");
      const cells = groups.map(g=>{
        const checked = (allowed.length===0 || allowed.indexOf("ALL")>-1) ? true : (allowed.indexOf(g)>-1);
        return `<td style="text-align:center">
          <input type="checkbox" data-mk="${m.key}" data-g="${g}" ${checked?'checked':''}/>
        </td>`;
      }).join('');
      return `<tr>
        <td style="font-weight:600">${escapeHtml(m.title||m.label||m.key)}</td>
        <td style="text-align:center"><input type="checkbox" data-enabled="${m.key}" ${enabled?'checked':''}/></td>
        ${cells}
      </tr>`;
    }).join('');

    const tableHtml = `
      <div style="text-align:left;margin-bottom:10px;color:#444">
        MenÃ¼/sekme bazlÄ± âhangi grup gÃ¶rsÃ¼nâ ayarÄ±. Ä°Åaretli olmayan gruplar menÃ¼yÃ¼ gÃ¶rmez.
      </div>
      <div style="max-height:420px;overflow:auto;border:1px solid rgba(0,0,0,.08);border-radius:12px">
        <table style="width:100%;border-collapse:collapse">
          <thead style="position:sticky;top:0;background:#f7f7f7;z-index:1">
            <tr>
              <th style="text-align:left;padding:12px">MenÃ¼</th>
              <th style="text-align:center;padding:12px;width:90px">Aktif</th>
              ${groups.map(g=>`<th style="text-align:center;padding:12px">${escapeHtml(g)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>`;

    Swal.fire({
      title: "Yetki YÃ¶netimi",
      html: tableHtml,
      width: 980,
      showCancelButton: true,
      confirmButtonText: "Kaydet",
      cancelButtonText: "VazgeÃ§",
      preConfirm: ()=>{
        const out = {};
        menus.forEach(m=>{ out[m.key] = { allowedGroups: [], enabled: true }; });
        // enabled
        document.querySelectorAll('input[type="checkbox"][data-enabled]').forEach(cb=>{
          const k=cb.getAttribute('data-enabled');
          if(out[k]) out[k].enabled = !!cb.checked;
        });
        // groups
        document.querySelectorAll('input[type="checkbox"][data-mk]').forEach(cb=>{
          const k=cb.getAttribute('data-mk');
          const g=cb.getAttribute('data-g');
          if(cb.checked && out[k]) out[k].allowedGroups.push(g);
        });
        // Hepsi seÃ§iliyse "ALL" olarak yaz (daha temiz)
        Object.keys(out).forEach(k=>{
          const arr = out[k].allowedGroups||[];
          if(arr.length===groups.length){
            out[k].allowedGroups = ["ALL"];
          }
        });
        return out;
      }
    }).then(r=>{
      if(!r.isConfirmed) return;
      const payload = r.value || {};
      apiCall("setMenuPermissions",{ items: payload }).then(sv=>{
        if(sv && sv.result==="success"){
          Swal.fire("Kaydedildi","Yetkiler gÃ¼ncellendi.","success");
          loadMenuPermissions();
        } else {
          Swal.fire("Hata", (sv&&sv.message)||"Kaydedilemedi", "error");
        }
      });
    });
  });
}
// --------------------------------------------------------------------
let isAdminMode = false;
let isLocAdmin = false;
let isEditingActive = false;
let sessionTimeout;
let activeCards = [];
let currentCategory = "home";
let adminUserList = [];
let allEvaluationsData = [];
let wizardStepsData = {};
let trainingData = [];
// YENÄ°: Chart instance'Ä± tutmak iÃ§in
let dashboardChart = null;
let dashboardChartChat = null;
let dashboardChartTele = null;
// YENÄ°: Feedback Log Verisi (Manuel kayÄ±t detaylarÄ± iÃ§in)
let feedbackLogsData = [];
// ==========================================================
// --- KALÄ°TE PUANLAMA LOGÄ°ÄÄ°: CHAT (BUTON TABANLI) ---
// ==========================================================
window.setButtonScore = function(index, score, max) {
    const row = document.getElementById(`row-${index}`);
    const badge = document.getElementById(`badge-${index}`);
    const noteInput = document.getElementById(`note-${index}`);
    const buttons = row.querySelectorAll('.eval-button');
    
    buttons.forEach(b => b.classList.remove('active'));
    
    const activeBtn = row.querySelector('.eval-button[data-score="' + score + '"]');
    if (activeBtn) activeBtn.classList.add('active');
    
    badge.innerText = score;
    
    if (score < max) {
        noteInput.style.display = 'block';
        badge.style.background = '#d32f2f'; 
        row.style.borderColor = '#ffcdd2';
        row.style.background = '#fff5f5';
    } else {
        noteInput.style.display = 'none';
        noteInput.value = ''; 
        badge.style.background = '#2e7d32'; 
        row.style.borderColor = '#eee';
        row.style.background = '#fff';
    }
    window.recalcTotalScore();
};
window.recalcTotalScore = function() {
    let currentTotal = 0;
    let maxTotal = 0;
    
    const scoreBadges = document.querySelectorAll('.score-badge');
    scoreBadges.forEach(b => { currentTotal += parseInt(b.innerText) || 0; });
    
    const maxScores = document.querySelectorAll('.criteria-row');
    maxScores.forEach(row => { maxTotal += parseInt(row.getAttribute('data-max-score')) || 0; });
    
    const liveScoreEl = document.getElementById('live-score');
    const ringEl = document.getElementById('score-ring');
    
    if(liveScoreEl) liveScoreEl.innerText = currentTotal;
    if(ringEl) {
        let color = '#2e7d32';
        let ratio = maxTotal > 0 ? (currentTotal / maxTotal) * 100 : 0;
        if(ratio < 50) color = '#d32f2f';
        else if(ratio < 85) color = '#ed6c02';
        else if(ratio < 95) color = '#fabb00';
        ringEl.style.background = `conic-gradient(${color} ${ratio}%, #444 ${ratio}%)`;
    }
};
// ==========================================================
// --- KALÄ°TE PUANLAMA LOGÄ°ÄÄ°: TELE SATIÅ (SLIDER TABANLI) ---
// ==========================================================
window.updateRowSliderScore = function(index, max) {
    const slider = document.getElementById(`slider-${index}`);
    const badge = document.getElementById(`badge-${index}`);
    const noteInput = document.getElementById(`note-${index}`);
    const row = document.getElementById(`row-${index}`);
    if(!slider) return;
    const val = parseInt(slider.value);
    badge.innerText = val;
    
    if (val < max) {
        noteInput.style.display = 'block';
        badge.style.background = '#d32f2f';
        row.style.borderColor = '#ffcdd2';
        row.style.background = '#fff5f5';
    } else {
        noteInput.style.display = 'none';
        noteInput.value = '';
        badge.style.background = '#2e7d32';
        row.style.borderColor = '#eee';
        row.style.background = '#fff';
    }
    window.recalcTotalSliderScore();
};
window.recalcTotalSliderScore = function() {
    let currentTotal = 0;
    let maxTotal = 0;
    const sliders = document.querySelectorAll('.slider-input');
    
    sliders.forEach(s => {
        currentTotal += parseInt(s.value) || 0;
        maxTotal += parseInt(s.getAttribute('max')) || 0;
    });
    const liveScoreEl = document.getElementById('live-score');
    const ringEl = document.getElementById('score-ring');
    
    if(liveScoreEl) liveScoreEl.innerText = currentTotal;
    if(ringEl) {
        let color = '#2e7d32';
        let ratio = maxTotal > 0 ? (currentTotal / maxTotal) * 100 : 0;
        if(ratio < 50) color = '#d32f2f';
        else if(ratio < 85) color = '#ed6c02';
        else if(ratio < 95) color = '#fabb00';
        ringEl.style.background = `conic-gradient(${color} ${ratio}%, #444 ${ratio}%)`;
    }
};
// --- YARDIMCI FONKSÄ°YONLAR ---
function getToken() { return localStorage.getItem("sSportToken"); }
function setHomeWelcomeUser(name){
  try{
    const el = document.getElementById("home-welcome-user");
    if(el) el.textContent = (name||"Misafir");
  }catch(e){}
}

function getFavs() { return JSON.parse(localStorage.getItem('sSportFavs') || '[]'); }
function toggleFavorite(title) {
    event.stopPropagation();
    let favs = getFavs();
    if (favs.includes(title)) { favs = favs.filter(t => t !== title); } 
    else { favs.push(title); }
    localStorage.setItem('sSportFavs', JSON.stringify(favs));
    try {
        const added = favs.includes(title);
        Swal.fire({toast:true, position:'top-end', icon: added ? 'success' : 'info', title: added ? 'Favorilere eklendi' : 'Favorilerden kaldÄ±rÄ±ldÄ±', showConfirmButton:false, timer:1200});
    } catch(e) {}

    if (currentCategory === 'fav') { filterCategory(document.querySelector('.btn-fav'), 'fav'); } 
    else { renderCards(activeCards); }
    try { updateSearchResultCount(activeCards.length || 0, database.length); } catch(e) {}
}
function isFav(title) { return getFavs().includes(title); }
function formatDateToDDMMYYYY(dateString) {
    if (!dateString) return 'N/A';
    // EÄer format dd.MM.yyyy olarak geliyorsa direkt dÃ¶n
    if (dateString.match(/^\d{2}\.\d{2}\.\d{4}/)) { return dateString.split(' ')[0]; }
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) { return dateString; }
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}.${month}.${year}`;
    } catch (e) { return dateString; }
}

function parseDateTRToTS(s){
    try{
        if(!s) return 0;
        const clean = String(s).split(' ')[0];
        if(clean.includes('.')){
            const parts = clean.split('.');
            if(parts.length >= 3){
                const dd = parseInt(parts[0],10);
                const mm = parseInt(parts[1],10);
                const yy = parseInt(parts[2],10);
                const d = new Date(yy, mm-1, dd);
                return d.getTime() || 0;
            }
        }
        const d = new Date(s);
        return d.getTime() || 0;
    }catch(e){ return 0; }
}

function isNew(dateStr) {
    if (!dateStr) return false;
    let date;
    if (dateStr.indexOf('.') > -1) {
        const cleanDate = dateStr.split(' ')[0];
        const parts = cleanDate.split('.');
        // GG.AA.YYYY -> YYYY-AA-GG formatÄ±na Ã§evir
        date = new Date(parts[2], parts[1] - 1, parts[0]);
    } else {
        date = new Date(dateStr);
    }
    if (isNaN(date.getTime())) return false;
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 3;
}
function getCategorySelectHtml(currentCategory, id) {
    let options = VALID_CATEGORIES.map(cat => `<option value="${cat}" ${cat === currentCategory ? 'selected' : ''}>${cat}</option>`).join('');
    if (currentCategory && !VALID_CATEGORIES.includes(currentCategory)) {
        options = `<option value="${currentCategory}" selected>${currentCategory} (Hata)</option>` + options;
    }
    return `<select id="${id}" class="swal2-input" style="width:100%; margin-top:5px;">${options}</select>`;
}
function escapeForJsString(text) {
    if (!text) return "";
    return text.toString().replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '');
}
function copyScriptContent(encodedText) {
    const text = decodeURIComponent(encodedText);
    copyText(text);
}
function copyText(t) {
    // navigator.clipboard.writeText yerine execCommand kullanÄ±ldÄ± (iFrame uyumluluÄu iÃ§in)
    const textarea = document.createElement('textarea');
    textarea.value = t.replace(/\\n/g, '\n');
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        Swal.fire({icon:'success', title:'KopyalandÄ±', toast:true, position:'top-end', showConfirmButton:false, timer:1500});
    } catch (err) {
        Swal.fire({icon:'error', title:'KopyalanamadÄ±', text:'LÃ¼tfen manuel kopyalayÄ±n.', toast:true, position:'top-end', showConfirmButton:false, timer:2500});
    }
    document.body.removeChild(textarea);
}
document.addEventListener('contextmenu', event => event.preventDefault());
document.onkeydown = function(e) { if(e.keyCode == 123) return false; }
document.addEventListener('DOMContentLoaded', () => { checkSession(); });
// --- SESSION & LOGIN ---
function checkSession() {
    const savedUser = localStorage.getItem("sSportUser");
    const savedToken = localStorage.getItem("sSportToken");
    const savedRole = localStorage.getItem("sSportRole");
    const savedGroup = localStorage.getItem("sSportGroup");

    // â Oturumun tarayÄ±cÄ±/PC kapat-aÃ§ sonrasÄ± ertesi gÃ¼ne sarkmamasÄ± iÃ§in:
    // - AynÄ± gÃ¼n deÄilse otomatik Ã§Ä±kÄ±Å
    // - AyrÄ±ca 12 saati geÃ§tiyse otomatik Ã§Ä±kÄ±Å
    const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const sessionDay = localStorage.getItem("sSportSessionDay") || "";
    const loginAt = parseInt(localStorage.getItem("sSportLoginAt") || "0", 10);
    const maxAgeMs = 12 * 60 * 60 * 1000; // 12 saat

    if (savedUser && savedToken) {
        const isOtherDay = (!sessionDay || sessionDay !== todayKey);
        const isTooOld = (!loginAt || (Date.now() - loginAt) > maxAgeMs);

        if (isOtherDay || isTooOld) {
            try { logout(); } catch (e) {
                localStorage.removeItem("sSportUser");
                localStorage.removeItem("sSportToken");
                localStorage.removeItem("sSportRole");
                localStorage.removeItem("sSportGroup");
                localStorage.removeItem("sSportSessionDay");
                localStorage.removeItem("sSportLoginAt");
            }
            return;
        }

        currentUser = savedUser;
        document.getElementById("login-screen").style.display = "none";
        document.getElementById("user-display").innerText = currentUser;
        setHomeWelcomeUser(currentUser);

        checkAdmin(savedRole);

        try{
            if(savedGroup){
                const el=document.getElementById("t-side-role"); if(el) el.textContent=savedGroup;
                const el2=document.getElementById("tech-side-role"); if(el2) el2.textContent=savedGroup;
            }
        }catch(e){}

        startSessionTimer();

        // â YENÄ°: Yenilemede de menÃ¼/blok yetkilerini uygula
        try{ loadMenuPermissions(); }catch(e){}
        try{ loadHomeBlocks(); }catch(e){}

        if (BAKIM_MODU) {
            document.getElementById("maintenance-screen").style.display = "flex";
        } else {
            document.getElementById("main-app").style.display = "block";

            loadContentData();
            loadWizardData();
            loadTechWizardData();

            // EÄer qusers rolÃ¼ndeyse, ana iÃ§eriÄi gizle ve kalite modÃ¼lÃ¼nÃ¼ aÃ§
            if (savedRole === 'qusers') {
                const grid = document.getElementById('cardGrid'); if (grid) grid.style.display = 'none';
                const controls = document.querySelector('.control-wrapper'); if (controls) controls.style.display = 'none';
                const ticker = document.querySelector('.news-ticker-box'); if (ticker) ticker.style.display = 'none';

                openQualityArea(); // Yeni Full Screen ModÃ¼l
            }
        }
    }
}
function enterBas(e) { if (e.key === "Enter") girisYap(); }
function girisYap() {
    const uName = document.getElementById("usernameInput").value.trim();
    const uPass = document.getElementById("passInput").value.trim();
    const loadingMsg = document.getElementById("loading-msg");
    const errorMsg = document.getElementById("error-msg");
    if(!uName || !uPass) { errorMsg.innerText = "LÃ¼tfen bilgileri giriniz."; errorMsg.style.display = "block"; return; }
    
    loadingMsg.style.display = "block";
    loadingMsg.innerText = "DoÄrulanÄ±yor...";
    errorMsg.style.display = "none";
    document.querySelector('.login-btn').disabled = true;
    
    const hashedPass = CryptoJS.SHA256(uPass).toString();
    fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "login", username: uName, password: hashedPass })
    }).then(response => response.json())
    .then(data => {
        loadingMsg.style.display = "none";
        document.querySelector('.login-btn').disabled = false;
        
        if (data.result === "success") {
            currentUser = data.username;
            localStorage.setItem("sSportUser", currentUser);
            localStorage.setItem("sSportToken", data.token);
            localStorage.setItem("sSportRole", data.role);
            if (data.group) localStorage.setItem("sSportGroup", data.group);
            // â Oturum zaman damgasÄ± (ertesi gÃ¼n otomatik Ã§Ä±kÄ±Å iÃ§in)
            localStorage.setItem("sSportSessionDay", new Date().toISOString().slice(0, 10));
            localStorage.setItem("sSportLoginAt", String(Date.now()));
            
            const savedRole = data.role;
            if (data.forceChange === true) {
                Swal.fire({
                    icon: 'warning', title: ' â ï¸  GÃ¼venlik UyarÄ±sÄ±',
                    text: 'Ä°lk giriÅiniz. LÃ¼tfen Åifrenizi deÄiÅtirin.',
                    allowOutsideClick: false, allowEscapeKey: false, confirmButtonText: 'Åifremi DeÄiÅtir'
                }).then(() => { changePasswordPopup(true); });
            } else {
                document.getElementById("login-screen").style.display = "none";
                document.getElementById("user-display").innerText = currentUser;
                setHomeWelcomeUser(currentUser);
                const savedGroup = data.group || localStorage.getItem('sSportGroup') || '';
                checkAdmin(savedRole);
                startSessionTimer();
                // MenÃ¼ yetkilerini ve ana sayfa bloklarÄ±nÄ± login sonrasÄ± yÃ¼kle
                try{ loadMenuPermissions(); }catch(e){}
                try{ loadHomeBlocks(); }catch(e){}
                
                if (BAKIM_MODU) {
                    document.getElementById("maintenance-screen").style.display = "flex";
                } else {
                    document.getElementById("main-app").style.display = "block";
                    loadContentData();
                    loadWizardData();
                    loadTechWizardData();
                    
                    if (savedRole === 'qusers') { 
                        const grid = document.getElementById('cardGrid'); if (grid) grid.style.display = 'none';
                        const controls = document.querySelector('.control-wrapper'); if (controls) controls.style.display = 'none';
                        const ticker = document.querySelector('.news-ticker-box'); if (ticker) ticker.style.display = 'none';
                        openQualityArea();
                    }
                }
            }
        } else {
            errorMsg.innerText = data.message || "HatalÄ± giriÅ!";
            errorMsg.style.display = "block";
        }
    }).catch(error => {
        loadingMsg.style.display = "none";
        document.querySelector('.login-btn').disabled = false;
        errorMsg.innerText = "Sunucu hatasÄ±! LÃ¼tfen sayfayÄ± yenileyin.";
        errorMsg.style.display = "block";
    });
    if (key === "chat") dashboardChartChat = chartRef; else if (key === "tele") dashboardChartTele = chartRef; else dashboardChart = chartRef;
}
function checkAdmin(role) {
    const addCardDropdown = document.getElementById('dropdownAddCard');
    const quickEditDropdown = document.getElementById('dropdownQuickEdit');
    
    isAdminMode = (role === "admin" || role === "locadmin");
    isLocAdmin = (role === "locadmin");
    isEditingActive = false;
    document.body.classList.remove('editing');
    
    const isQualityUser = (role === 'qusers');
    const filterButtons = document.querySelectorAll('.filter-btn:not(.btn-fav)'); 
    
    if (isQualityUser) {
        filterButtons.forEach(btn => {
            if (btn.innerText.indexOf('Kalite') === -1) {
                btn.style.opacity = '0.5';
                btn.style.pointerEvents = 'none';
                btn.style.filter = 'grayscale(100%)';
            } else { btn.style.filter = 'none'; }
        });
        const searchInput = document.getElementById('searchInput');
        if (searchInput) { searchInput.disabled = true; searchInput.placeholder = "Arama devre dÄ±ÅÄ± (Kalite Modu)"; searchInput.style.opacity = '0.6'; }
    } else {
        filterButtons.forEach(btn => {
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
            btn.style.filter = 'none';
        });
        const searchInput = document.getElementById('searchInput');
        if (searchInput) { searchInput.disabled = false; searchInput.placeholder = "Ä°Ã§eriklerde hÄ±zlÄ± ara..."; searchInput.style.opacity = '1'; }
    }
    
    if(isAdminMode) {
        if(addCardDropdown) addCardDropdown.style.display = 'flex';
        if(quickEditDropdown) {
            quickEditDropdown.style.display = 'flex';
            // Ä°stek: Yetki YÃ¶netimi sadece LocAdmin rolÃ¼nde gÃ¶rÃ¼nsÃ¼n
            const perms = document.getElementById('dropdownPerms');
            if(perms) perms.style.display = (isLocAdmin ? 'flex' : 'none');
            quickEditDropdown.innerHTML = '<i class="fas fa-pen" style="color:var(--secondary);"></i> DÃ¼zenlemeyi AÃ§';
            quickEditDropdown.classList.remove('active');
        }
    } else {
        if(addCardDropdown) addCardDropdown.style.display = 'none';
        if(quickEditDropdown) quickEditDropdown.style.display = 'none';
        const perms = document.getElementById('dropdownPerms');
        if(perms) perms.style.display = 'none';
    }
}
function logout() {
    currentUser = ""; isAdminMode = false; isEditingActive = false;
    try{ document.getElementById("user-display").innerText = "Misafir"; }catch(e){}
    setHomeWelcomeUser("Misafir");
    document.body.classList.remove('editing');
    localStorage.removeItem("sSportUser"); localStorage.removeItem("sSportToken"); localStorage.removeItem("sSportRole"); localStorage.removeItem("sSportGroup"); localStorage.removeItem("sSportSessionDay"); localStorage.removeItem("sSportLoginAt");
    if (sessionTimeout) clearTimeout(sessionTimeout);
    document.getElementById("main-app").style.display = "none";
    document.getElementById("login-screen").style.display = "flex";
    document.getElementById("passInput").value = "";
    document.getElementById("usernameInput").value = "";
    document.getElementById("error-msg").style.display = "none";
    
    // Fullscreen'i kapat
    document.getElementById('quality-fullscreen').style.display = 'none';
    try{ document.getElementById('tech-fullscreen').style.display='none'; }catch(e){}
    try{ document.getElementById('telesales-fullscreen').style.display='none'; }catch(e){}
}
function startSessionTimer() {
    if (sessionTimeout) clearTimeout(sessionTimeout);
    // 8 saat (28800000 ms)
    sessionTimeout = setTimeout(() => {
        Swal.fire({ icon: 'warning', title: 'Oturum SÃ¼resi Doldu', text: 'GÃ¼venlik nedeniyle otomatik Ã§Ä±kÄ±Å yapÄ±ldÄ±.', confirmButtonText: 'Tamam' }).then(() => { logout(); });
    },  28800000); 
}
function openUserMenu() { toggleUserDropdown(); }
async function changePasswordPopup(isMandatory = false) {
    const { value: formValues } = await Swal.fire({
        title: isMandatory ? 'Yeni Åifre Belirleyin' : 'Åifre DeÄiÅtir',
        html: `${isMandatory ? '<p style="font-size:0.9rem; color:#d32f2f;">Ä°lk giriÅ Åifrenizi deÄiÅtirmeden devam edemezsiniz.</p>' : ''}<input id="swal-old-pass" type="password" class="swal2-input" placeholder="Eski Åifre (Mevcut)"><input id="swal-new-pass" type="password" class="swal2-input" placeholder="Yeni Åifre">`,
        focusConfirm: false, showCancelButton: !isMandatory, allowOutsideClick: !isMandatory, allowEscapeKey: !isMandatory,
        confirmButtonText: 'DeÄiÅtir', cancelButtonText: 'Ä°ptal',
        preConfirm: () => {
            const o = document.getElementById('swal-old-pass').value;
            const n = document.getElementById('swal-new-pass').value;
            if(!o || !n) { Swal.showValidationMessage('Alanlar boÅ bÄ±rakÄ±lamaz'); }
            return [ o, n ]
        }
    });
    if (formValues) {
        Swal.fire({ title: 'Ä°Åleniyor...', didOpen: () => { Swal.showLoading() } });
        fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
                action: "changePassword", username: currentUser,
                oldPass: CryptoJS.SHA256(formValues[0]).toString(),
                newPass: CryptoJS.SHA256(formValues[1]).toString(),
                token: getToken()
            })
        }).then(response => response.json()).then(data => {
            if(data.result === "success") {
                Swal.fire('BaÅarÄ±lÄ±!', 'Åifreniz gÃ¼ncellendi. Yeniden giriÅ yapÄ±nÄ±z.', 'success').then(() => { logout(); });
            } else {
                Swal.fire('Hata', data.message || 'Ä°Ålem baÅarÄ±sÄ±z.', 'error').then(() => { if(isMandatory) changePasswordPopup(true); });
            }
        }).catch(err => { Swal.fire('Hata', 'Sunucu hatasÄ±.', 'error'); if(isMandatory) changePasswordPopup(true); });
    } else if (isMandatory) { changePasswordPopup(true); }
}
// --- DATA FETCHING ---
function loadContentData() {
    document.getElementById('loading').style.display = 'block';
    fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "fetchData" })
    }).then(response => response.json()).then(data => {
        document.getElementById('loading').style.display = 'none';
        if (data.result === "success") {
            const rawData = data.data;
            database = rawData.filter(i => ['card','bilgi','teknik','kampanya','ikna'].includes(i.Type.toLowerCase())).map(i => ({
                title: i.Title, category: i.Category, text: i.Text, script: i.Script, code: i.Code, link: i.Link, date: formatDateToDDMMYYYY(i.Date)
            }));
            // Yeni eklenenleri Ã¼stte gÃ¶stermek iÃ§in tarihe gÃ¶re (azalan) sÄ±rala
            database.sort((a,b) => parseDateTRToTS(b.date) - parseDateTRToTS(a.date));
            newsData = rawData.filter(i => i.Type.toLowerCase() === 'news').map(i => ({
                date: formatDateToDDMMYYYY(i.Date), title: i.Title, desc: i.Text, type: i.Category, status: i.Status
            }));
            sportsData = rawData.filter(i => i.Type.toLowerCase() === 'sport').map(i => ({
                title: i.Title, icon: i.Icon, desc: i.Text, tip: i.Tip, detail: i.Detail, pronunciation: i.Pronunciation
            }));
            try{ applySportsRights(); }catch(e){}

            salesScripts = rawData.filter(i => i.Type.toLowerCase() === 'sales').map(i => ({ title: i.Title, text: i.Text }));
            quizQuestions = rawData.filter(i => i.Type.toLowerCase() === 'quiz').map(i => ({
                q: i.Text, opts: i.QuizOptions ? i.QuizOptions.split(',').map(o => o.trim()) : [], a: parseInt(i.QuizAnswer)
            }));
            // HÄ±zlÄ± Karar sorularÄ± (Google Sheet'ten): Type = quickdecision
            // Beklenen: Text | QuizOptions (| ile ayrÄ±lmÄ±Å) | QuizAnswer (0-based index) | Detail (opsiyonel)
            quickDecisionQuestions = rawData
                .filter(i => (i.Type || '').toLowerCase() === 'quickdecision')
                .map(i => {
                    const opts = String(i.QuizOptions || '').split('|').map(x => x.trim()).filter(Boolean);
                    let a = parseInt(i.QuizAnswer, 10);
                    if (isNaN(a)) a = 0;
                    if (a < 0) a = 0;
                    if (opts.length && a >= opts.length) a = opts.length - 1;
                    const exp = (i.Detail || '').toString().trim();
                    return { q: (i.Text || '').toString().trim(), opts, a, exp };
                })
                .filter(x => x.q && Array.isArray(x.opts) && x.opts.length >= 2);

            
            if(currentCategory === 'fav') { filterCategory(document.querySelector('.btn-fav'), 'fav'); } 
            else { activeCards = database; if(currentCategory==='home'){ showHomeScreen(); } else { hideHomeScreen(); renderCards(database); } }
            startTicker();
            try { updateSearchResultCount(activeCards.length || database.length, database.length); } catch(e) {}
        } else { document.getElementById('loading').innerHTML = `Veriler alÄ±namadÄ±: ${data.message || 'Bilinmeyen Hata'}`; }
    }).catch(error => { document.getElementById('loading').innerHTML = 'BaÄlantÄ± HatasÄ±! Sunucuya ulaÅÄ±lamÄ±yor.'; }).finally(()=>{ try{ __dataLoadedResolve && __dataLoadedResolve(); }catch(e){} });
            cardsData = database; // geriye dÃ¶nÃ¼k uyumluluk

}
function loadWizardData() {
    return new Promise((resolve, reject) => {
        fetch(SCRIPT_URL, {
            method: 'POST', headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "getWizardData" })
        }).then(response => response.json()).then(data => {
            if (data.result === "success" && data.steps) { wizardStepsData = data.steps; resolve(); } 
            else { wizardStepsData = {}; reject(new Error("Wizard verisi yÃ¼klenemedi.")); }
        }).catch(error => { wizardStepsData = {}; reject(error); });
    });
}
function loadTechWizardData() {
    return new Promise((resolve, reject) => {
        fetch(SCRIPT_URL, {
            method: 'POST', headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "getTechWizardData" })
        }).then(response => response.json()).then(data => {
            if (data.result === "success" && data.steps) { techWizardData = data.steps; resolve(); } 
            else { techWizardData = {}; }
        }).catch(error => { techWizardData = {}; });
    });
}
// --- RENDER & FILTERING ---
function renderCards(data) {
    activeCards = data;
    const container = document.getElementById('cardGrid');
    container.innerHTML = '';
    
    if (data.length === 0) { container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#777;">KayÄ±t bulunamadÄ±.</div>'; return; }
    data.forEach((item, index) => {
        const safeTitle = escapeForJsString(item.title);
        const isFavorite = isFav(item.title);
        const favClass = isFavorite ? 'fas fa-star active' : 'far fa-star';
        const newBadge = isNew(item.date) ? '<span class="new-badge">YENÄ°</span>' : '';
        const editIconHtml = (isAdminMode && isEditingActive) ? `<i class="fas fa-pencil-alt edit-icon" onclick="editContent(${index})" style="display:block;"></i>` : '';
        let formattedText = (item.text || "").replace(/\n/g, '<br>').replace(/\*(.*?)\*/g, '<b>$1</b>');
        
        container.innerHTML += `<div class="card ${item.category}">${newBadge}
            <div class="icon-wrapper">${editIconHtml}<i class="${favClass} fav-icon" onclick="toggleFavorite('${safeTitle}')"></i></div>
            <div class="card-header"><h3 class="card-title">${highlightText(item.title)}</h3><span class="badge">${item.category}</span></div>
            <div class="card-content" onclick="showCardDetail('${safeTitle}', '${escapeForJsString(item.text)}')">
                <div class="card-text-truncate">${highlightText(formattedText)}</div>
                <div style="font-size:0.8rem; color:#999; margin-top:5px; text-align:right;">(TamamÄ±nÄ± oku)</div>
            </div>
            <div class="script-box">${highlightText(item.script)}</div>
            <div class="card-actions">
                <button class="btn btn-copy" onclick="copyText('${escapeForJsString(item.script)}')"><i class="fas fa-copy"></i> Kopyala</button>
                ${item.code ? `<button class="btn btn-copy" style="background:var(--secondary); color:#333;" onclick="copyText('${escapeForJsString(item.code)}')">Kod</button>` : ''}
                ${item.link ? `<a href="${item.link}" target="_blank" class="btn btn-link"><i class="fas fa-external-link-alt"></i> Link</a>` : ''}
            </div>
        </div>`;
    });
}
function highlightText(htmlContent) {
    if (!htmlContent) return "";
    const searchTerm = document.getElementById('searchInput').value.toLocaleLowerCase('tr-TR').trim();
    if (!searchTerm) return htmlContent;
    try { const regex = new RegExp(`(${searchTerm})`, "gi"); return htmlContent.toString().replace(regex, '<span class="highlight">$1</span>'); } catch(e) { return htmlContent; }
}

function updateSearchResultCount(count, total) {
    const el = document.getElementById('searchResultCount');
    if(!el) return;
    // sadece arama yazÄ±ldÄ±ÄÄ±nda veya filtre fav/tekil seÃ§ildiÄinde gÃ¶ster
    const search = (document.getElementById('searchInput')?.value || '').trim();
    const show = !!search || (currentCategory && currentCategory !== 'all');
    if(!show) { el.style.display = 'none'; el.innerText = ''; return; }
    el.style.display = 'block';
    el.innerText = `ð ${count} sonuÃ§${total != null ? ' / ' + total : ''}`;
}



function filterCategory(btn, cat) {
    // Ana Sayfa Ã¶zel ekran
    if (cat === "home") {
        currentCategory = "home";
        setActiveFilterButton(btn);
        showHomeScreen();
        return;
    }


    // Tam ekran modÃ¼ller
    const catNorm = String(cat||'').toLowerCase();
    if (catNorm.includes('teknik')) {
        hideHomeScreen();
        openTechArea('broadcast');
        return;
    }
    if (catNorm.includes('telesat')) {
        hideHomeScreen();
        openTelesalesArea();
        return;
    }
    if (catNorm.includes('kalite')) {
        hideHomeScreen();
        // kalite iÃ§in mevcut davranÄ±Å: card list (varsa) - burada Ã¶zel modÃ¼l yoksa devam
    }
    currentCategory = cat;
    hideHomeScreen();

    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterContent();
}
function filterContent() {
    const search = document.getElementById('searchInput').value.toLocaleLowerCase('tr-TR').trim();
    // Ana sayfa (home) Ã¶zel ekran:
    // - Arama boÅsa ana sayfa kartlarÄ± gÃ¶rÃ¼nÃ¼r (home-screen)
    // - Arama yapÄ±lÄ±rsa ana sayfadan Ã§Ä±kÄ±p kartlar Ã¼zerinde filtre uygulanÄ±r
    if (currentCategory === 'home') {
        if (!search) {
            updateSearchResultCount(database.length, database.length);
            showHomeScreen();
            return;
        }
        // Arama varsa: home ekranÄ±nÄ± gizle ve tÃ¼m kartlar iÃ§inde ara
        hideHomeScreen();
    }

    let filtered = database;
    if (currentCategory === 'fav') { filtered = filtered.filter(i => isFav(i.title)); }
    else if (currentCategory !== 'all' && currentCategory !== 'home') { filtered = filtered.filter(i => i.category === currentCategory); }
    
    if (search) {
        filtered = filtered.filter(item => {
            const title = (item.title || "").toString().toLocaleLowerCase('tr-TR');
            const text = (item.text || "").toString().toLocaleLowerCase('tr-TR');
            const script = (item.script || "").toString().toLocaleLowerCase('tr-TR');
            const code = (item.code || "").toString().toLocaleLowerCase('tr-TR');
            return title.includes(search) || text.includes(search) || script.includes(search) || code.includes(search);
        });
    }
    activeCards = filtered;
    updateSearchResultCount(filtered.length, database.length);
    renderCards(filtered);
}
function showCardDetail(title, text) {
    // Geriye dÃ¶nÃ¼k uyumluluk: showCardDetail(cardObj) Ã§aÄrÄ±sÄ±nÄ± da destekle
    if (title && typeof title === 'object') {
        const c = title;
        const t = c.title || c.name || 'Detay';
        const body = (c.text || c.desc || '').toString();
        const script = (c.script || '').toString();
        const alertTxt = (c.alert || '').toString();
        const link = (c.link || '').toString();
        const html = `
          <div style="text-align:left; font-size:1rem; line-height:1.6; white-space:pre-line;">
            ${escapeHtml(body).replace(/\n/g,'<br>')}
            ${link ? `<div style="margin-top:12px"><a href="${escapeHtml(link)}" target="_blank" rel="noreferrer" style="font-weight:800;color:var(--info);text-decoration:none"><i class=\"fas fa-link\"></i> Link</a></div>` : ''}
            ${script ? `<div class="tech-script-box" style="margin-top:12px">
                <span class="tech-script-label">MÃ¼Återiye iletilecek:</span>${escapeHtml(script).replace(/\n/g,'<br>')}
              </div>` : ''}
            ${alertTxt ? `<div class="tech-alert" style="margin-top:12px">${escapeHtml(alertTxt).replace(/\n/g,'<br>')}</div>` : ''}
          </div>`;
        Swal.fire({ title: t, html, showCloseButton: true, showConfirmButton: false, width: '820px', background: '#f8f9fa' });
        return;
    }

    const safeText = (text ?? '').toString();
    Swal.fire({
        title: title,
        html: `<div style="text-align:left; font-size:1rem; line-height:1.6;">${escapeHtml(safeText).replace(/\n/g,'<br>')}</div>`,
        showCloseButton: true, showConfirmButton: false, width: '600px', background: '#f8f9fa'
    });
}

function toggleEditMode() {
    if (!isAdminMode) return;
    isEditingActive = !isEditingActive;
    document.body.classList.toggle('editing', isEditingActive);
    
    const btn = document.getElementById('dropdownQuickEdit');
    if(isEditingActive) {
        btn.classList.add('active');
        btn.innerHTML = '<i class="fas fa-times" style="color:var(--accent);"></i> DÃ¼zenlemeyi Kapat';
        Swal.fire({ icon: 'success', title: 'DÃ¼zenleme Modu AÃIK', text: 'Kalem ikonlarÄ±na tÄ±klayarak iÃ§erikleri dÃ¼zenleyebilirsiniz.', timer: 1500, showConfirmButton: false });
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fas fa-pen" style="color:var(--secondary);"></i> DÃ¼zenlemeyi AÃ§';
    }
    filterContent();
    try{ if(currentCategory==='home') renderHomePanels(); }catch(e){}
    if(document.getElementById('guide-modal').style.display === 'flex') openGuide();
    if(document.getElementById('sales-modal').style.display === 'flex') openSales();
    if(document.getElementById('news-modal').style.display === 'flex') openNews();
}
function sendUpdate(o, c, v, t='card') {
    if (!Swal.isVisible()) Swal.fire({ title: 'Kaydediliyor...', didOpen: () => { Swal.showLoading() } });
    fetch(SCRIPT_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: "updateContent", title: o, column: c, value: v, type: t, originalText: o, username: currentUser, token: getToken() })
    }).then(r => r.json()).then(data => {
        if (data.result === "success") {
            Swal.fire({icon: 'success', title: 'BaÅarÄ±lÄ±', timer: 1500, showConfirmButton: false});
            setTimeout(loadContentData, 1600);
        } else { Swal.fire('Hata', 'Kaydedilemedi: ' + (data.message || 'Bilinmeyen Hata'), 'error'); }
    }).catch(err => Swal.fire('Hata', 'Sunucu hatasÄ±.', 'error'));
}
// --- CRUD OPERASYONLARI (ADMIN) ---
async function addNewCardPopup() {
    const catSelectHTML = getCategorySelectHtml('Bilgi', 'swal-new-cat');
    const { value: formValues } = await Swal.fire({
        title: 'Yeni Ä°Ã§erik Ekle',
        html: `
        <div style="margin-bottom:15px; text-align:left;">
            <label style="font-weight:bold; font-size:0.9rem;">Ne Ekleyeceksin?</label>
            <select id="swal-type-select" class="swal2-input" style="width:100%; margin-top:5px; height:35px; font-size:0.9rem;" onchange="toggleAddFields()">
                <option value="card"> ð  Bilgi KartÄ±</option>
                <option value="news"> ð¢  Duyuru</option>
                <option value="sales"> ð  TelesatÄ±Å Scripti</option>
                <option value="sport"> ð  Spor Ä°Ã§eriÄi</option>
                <option value="quiz"> â  Quiz Sorusu</option>
            </select>
        </div>
        <div id="preview-card" class="card Bilgi" style="text-align:left; box-shadow:none; border:1px solid #e0e0e0; margin-top:10px;">
            <div class="card-header" style="align-items: center; gap: 10px;">
                <input id="swal-new-title" class="swal2-input" style="margin:0; height:40px; flex-grow:1; border:none; border-bottom:2px solid #eee; padding:0 5px; font-weight:bold; color:#0e1b42;" placeholder="BaÅlÄ±k Giriniz...">
                <div id="cat-container" style="width: 110px;">${catSelectHTML}</div>
            </div>
            <div class="card-content" style="margin-bottom:10px;">
                <textarea id="swal-new-text" class="swal2-textarea" style="margin:0; width:100%; box-sizing:border-box; border:none; resize:none; font-family:inherit; min-height:100px; padding:10px; background:#f9f9f9;" placeholder="Ä°Ã§erik metni..."></textarea>
            </div>
            <div id="script-container" class="script-box" style="padding:0; border:1px solid #f0e68c;">
                <textarea id="swal-new-script" class="swal2-textarea" style="margin:0; width:100%; box-sizing:border-box; border:none; background:transparent; font-style:italic; min-height:80px; font-size:0.9rem;" placeholder="Script metni (Ä°steÄe baÄlÄ±)..."></textarea>
            </div>
            <div id="extra-container" class="card-actions" style="margin-top:15px; display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <div style="position:relative;"><i class="fas fa-code" style="position:absolute; left:10px; top:10px; color:#aaa;"></i><input id="swal-new-code" class="swal2-input" style="margin:0; height:35px; font-size:0.85rem; padding-left:30px;" placeholder="Kod"></div>
                <div style="position:relative;"><i class="fas fa-link" style="position:absolute; left:10px; top:10px; color:#aaa;"></i><input id="swal-new-link" class="swal2-input" style="margin:0; height:35px; font-size:0.85rem; padding-left:30px;" placeholder="Link"></div>
            </div>
            <div id="sport-extra" style="display:none; padding:10px;">
                <label style="font-weight:bold;">KÄ±sa AÃ§Ä±klama (Desc)</label><input id="swal-sport-tip" class="swal2-input" placeholder="KÄ±sa Ä°pucu/Tip">
                <label style="font-weight:bold;">DetaylÄ± Metin (Detail)</label><input id="swal-sport-detail" class="swal2-input" placeholder="DetaylÄ± AÃ§Ä±klama (Alt Metin)">
                <label style="font-weight:bold;">OkunuÅu (Pronunciation)</label><input id="swal-sport-pron" class="swal2-input" placeholder="OkunuÅu">
                <label style="font-weight:bold;">Ä°kon SÄ±nÄ±fÄ± (Icon)</label><input id="swal-sport-icon" class="swal2-input" placeholder="FontAwesome Ä°kon SÄ±nÄ±fÄ± (e.g., fa-futbol)">
            </div>
            <div id="news-extra" style="display:none; padding:10px;">
                <label style="font-weight:bold;">Duyuru Tipi</label><select id="swal-news-type" class="swal2-input"><option value="info">Bilgi</option><option value="update">DeÄiÅiklik</option><option value="fix">ÃÃ¶zÃ¼ldÃ¼</option></select>
                <label style="font-weight:bold;">Durum</label><select id="swal-news-status" class="swal2-input"><option value="Aktif">Aktif</option><option value="Pasif">Pasif (Gizle)</option></select>
            </div>
            <div id="quiz-extra" style="display:none; padding:10px;">
                <label style="font-weight:bold;">Soru Metni (Text)</label><textarea id="swal-quiz-q" class="swal2-textarea" placeholder="Quiz sorusu..."></textarea>
                <label style="font-weight:bold;">SeÃ§enekler (VirgÃ¼lle AyÄ±rÄ±n)</label><input id="swal-quiz-opts" class="swal2-input" placeholder="Ãrn: ÅÄ±k A,ÅÄ±k B,ÅÄ±k C,ÅÄ±k D">
                <label style="font-weight:bold;">DoÄru Cevap Ä°ndeksi</label><input id="swal-quiz-ans" type="number" class="swal2-input" placeholder="0 (A), 1 (B), 2 (C) veya 3 (D)" min="0" max="3">
            </div>
        </div>`,
        width: '700px', showCancelButton: true, confirmButtonText: '<i class="fas fa-plus"></i> Ekle', cancelButtonText: 'Ä°ptal', focusConfirm: false,
        didOpen: () => {
            const selectEl = document.getElementById('swal-new-cat');
            const cardEl = document.getElementById('preview-card');
            selectEl.style.margin = "0"; selectEl.style.height = "30px"; selectEl.style.fontSize = "0.8rem"; selectEl.style.padding = "0 5px";
            selectEl.addEventListener('change', function() { cardEl.className = 'card ' + this.value; });
            
            window.toggleAddFields = function() {
                const type = document.getElementById('swal-type-select').value;
                const catCont = document.getElementById('cat-container');
                const scriptCont = document.getElementById('script-container');
                const extraCont = document.getElementById('extra-container');
                const sportExtra = document.getElementById('sport-extra');
                const newsExtra = document.getElementById('news-extra');
                const quizExtra = document.getElementById('quiz-extra');
                const cardPreview = document.getElementById('preview-card');
                
                catCont.style.display = 'none'; scriptCont.style.display = 'none'; extraCont.style.display = 'none';
                sportExtra.style.display = 'none'; newsExtra.style.display = 'none'; quizExtra.style.display = 'none';
                document.getElementById('swal-new-title').value = ''; document.getElementById('swal-new-text').value = '';
                cardPreview.style.borderLeft = "5px solid var(--info)"; cardPreview.className = 'card Bilgi';
                
                if (type === 'card') {
                    catCont.style.display = 'block'; scriptCont.style.display = 'block'; extraCont.style.display = 'grid';
                    cardPreview.className = 'card ' + document.getElementById('swal-new-cat').value;
                    document.getElementById('swal-new-title').placeholder = "BaÅlÄ±k Giriniz..."; document.getElementById('swal-new-text').placeholder = "Ä°Ã§erik metni...";
                } else if (type === 'sales') {
                    scriptCont.style.display = 'block';
                    document.getElementById('swal-new-script').placeholder = "SatÄ±Å Metni...";
                    cardPreview.style.borderLeft = "5px solid var(--sales)";
                    document.getElementById('swal-new-title').placeholder = "Script BaÅlÄ±ÄÄ±..."; document.getElementById('swal-new-text').placeholder = "Sadece buraya metin girilecek.";
                } else if (type === 'sport') {
                    sportExtra.style.display = 'block';
                    cardPreview.style.borderLeft = "5px solid var(--primary)";
                    document.getElementById('swal-new-title').placeholder = "Spor Terimi BaÅlÄ±ÄÄ±..."; document.getElementById('swal-new-text').placeholder = "KÄ±sa AÃ§Ä±klama (Desc)...";
                } else if (type === 'news') {
                    newsExtra.style.display = 'block';
                    cardPreview.style.borderLeft = "5px solid var(--secondary)";
                    document.getElementById('swal-new-title').placeholder = "Duyuru BaÅlÄ±ÄÄ±..."; document.getElementById('swal-new-text').placeholder = "Duyuru Metni (Desc)...";
                } else if (type === 'quiz') {
                    quizExtra.style.display = 'block';
                    document.getElementById('swal-new-title').placeholder = "Quiz BaÅlÄ±ÄÄ± (Ãrn: Soru 1)"; document.getElementById('swal-new-text').placeholder = "Bu alan boÅ bÄ±rakÄ±lacak.";
                    cardPreview.style.borderLeft = "5px solid var(--quiz)";
                }
            };
        },
        preConfirm: () => {
            const type = document.getElementById('swal-type-select').value;
            const today = new Date();
            const dateStr = today.getDate() + "." + (today.getMonth()+1) + "." + today.getFullYear();
            const quizOpts = type === 'quiz' ? document.getElementById('swal-quiz-opts').value : '';
            const quizAns = type === 'quiz' ? document.getElementById('swal-quiz-ans').value : '';
            const quizQ = type === 'quiz' ? document.getElementById('swal-quiz-q').value : '';
            if (type === 'quiz' && (!quizQ || !quizOpts || quizAns === '')) { Swal.showValidationMessage('Quiz sorusu iÃ§in tÃ¼m alanlar zorunludur.'); return false; }
            return {
                cardType: type,
                category: type === 'card' ? document.getElementById('swal-new-cat').value : (type === 'news' ? document.getElementById('swal-news-type').value : ''),
                title: document.getElementById('swal-new-title').value,
                text: type === 'quiz' ? quizQ : document.getElementById('swal-new-text').value,
                script: (type === 'card' || type === 'sales') ? document.getElementById('swal-new-script').value : '',
                code: type === 'card' ? document.getElementById('swal-new-code').value : '',
                status: type === 'news' ? document.getElementById('swal-news-status').value : '',
                link: type === 'card' ? document.getElementById('swal-new-link').value : '',
                tip: type === 'sport' ? document.getElementById('swal-sport-tip').value : '',
                detail: type === 'sport' ? document.getElementById('swal-sport-detail').value : '',
                pronunciation: type === 'sport' ? document.getElementById('swal-sport-pron').value : '',
                icon: type === 'sport' ? document.getElementById('swal-sport-icon').value : '',
                date: dateStr, quizOptions: quizOpts, quizAnswer: quizAns
            }
        }
    });
    if (formValues) {
        if(!formValues.title) { Swal.fire('Hata', 'BaÅlÄ±k zorunlu!', 'error'); return; }
        Swal.fire({ title: 'Ekleniyor...', didOpen: () => { Swal.showLoading() } });
        fetch(SCRIPT_URL, {
            method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: "addCard", username: currentUser, token: getToken(), ...formValues })
        }).then(response => response.json()).then(data => {
            if (data.result === "success") {
                Swal.fire({icon: 'success', title: 'BaÅarÄ±lÄ±', text: 'Ä°Ã§erik eklendi.', timer: 2000, showConfirmButton: false});
                setTimeout(loadContentData, 3500);
            } else { Swal.fire('Hata', data.message || 'Eklenemedi.', 'error'); }
        }).catch(err => Swal.fire('Hata', 'Sunucu hatasÄ±: ' + err, 'error'));
    }
}
async function editContent(index) {
    const item = activeCards[index];
    const catSelectHTML = getCategorySelectHtml(item.category, 'swal-cat');
    const { value: formValues } = await Swal.fire({
        title: 'KartÄ± DÃ¼zenle',
        html: `
        <div id="preview-card-edit" class="card ${item.category}" style="text-align:left; box-shadow:none; border:1px solid #e0e0e0; margin-top:10px;">
            <div class="card-header" style="align-items: center; gap: 10px;">
                <input id="swal-title" class="swal2-input" style="margin:0; height:40px; flex-grow:1; border:none; border-bottom:2px solid #eee; padding:0 5px; font-weight:bold; color:#0e1b42;" value="${item.title}" placeholder="BaÅlÄ±k">
                <div style="width: 110px;">${catSelectHTML}</div>
            </div>
            <div class="card-content" style="margin-bottom:10px;">
                <textarea id="swal-text" class="swal2-textarea" style="margin:0; width:100%; box-sizing:border-box; border:none; resize:none; font-family:inherit; min-height:120px; padding:10px; background:#f9f9f9;" placeholder="Ä°Ã§erik metni...">${(item.text || '').toString().replace(/<br>/g,'\n')}</textarea>
            </div>
            <div class="script-box" style="padding:0; border:1px solid #f0e68c;">
                <textarea id="swal-script" class="swal2-textarea" style="margin:0; width:100%; box-sizing:border-box; border:none; background:transparent; font-style:italic; min-height:80px; font-size:0.9rem;" placeholder="Script metni...">${(item.script || '').toString().replace(/<br>/g,'\n')}</textarea>
            </div>
            <div class="card-actions" style="margin-top:15px; display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <div style="position:relative;"><i class="fas fa-code" style="position:absolute; left:10px; top:10px; color:#aaa;"></i><input id="swal-code" class="swal2-input" style="margin:0; height:35px; font-size:0.85rem; padding-left:30px;" value="${item.code || ''}" placeholder="Kod"></div>
                <div style="position:relative;"><i class="fas fa-link" style="position:absolute; left:10px; top:10px; color:#aaa;"></i><input id="swal-link" class="swal2-input" style="margin:0; height:35px; font-size:0.85rem; padding-left:30px;" value="${item.link || ''}" placeholder="Link"></div>
            </div>
        </div>`,
        width: '700px', showCancelButton: true, confirmButtonText: '<i class="fas fa-save"></i> Kaydet', cancelButtonText: 'Ä°ptal', focusConfirm: false,
        didOpen: () => {
            const selectEl = document.getElementById('swal-cat');
            const cardEl = document.getElementById('preview-card-edit');
            selectEl.style.margin = "0"; selectEl.style.height = "30px"; selectEl.style.fontSize = "0.8rem"; selectEl.style.padding = "0 5px";
            selectEl.addEventListener('change', function() { cardEl.className = 'card ' + this.value; });
        },
        preConfirm: () => {
            return {
                cat: document.getElementById('swal-cat').value,
                title: document.getElementById('swal-title').value,
                text: document.getElementById('swal-text').value,
                script: document.getElementById('swal-script').value,
                code: document.getElementById('swal-code').value,
                link: document.getElementById('swal-link').value
            }
        }
    });
    if (formValues) {
        if(formValues.cat !== item.category) sendUpdate(item.title, "Category", formValues.cat, 'card');
        if(formValues.text !== (item.text || '').replace(/<br>/g,'\n')) setTimeout(() => sendUpdate(item.title, "Text", formValues.text, 'card'), 500);
        if(formValues.script !== (item.script || '').replace(/<br>/g,'\n')) setTimeout(() => sendUpdate(item.title, "Script", formValues.script, 'card'), 1000);
        if(formValues.code !== (item.code || '')) setTimeout(() => sendUpdate(item.title, "Code", formValues.code, 'card'), 1500);
        if(formValues.link !== (item.link || '')) setTimeout(() => sendUpdate(item.title, "Link", formValues.link, 'card'), 2000);
        if(formValues.title !== item.title) setTimeout(() => sendUpdate(item.title, "Title", formValues.title, 'card'), 2500);
    }
}
async function editSport(title) {
    event.stopPropagation();
    const s = sportsData.find(item => item.title === title);
    if (!s) return Swal.fire('Hata', 'Ä°Ã§erik bulunamadÄ±.', 'error');
    const { value: formValues } = await Swal.fire({
        title: 'Spor Ä°Ã§eriÄini DÃ¼zenle',
        html: `
        <div class="card" style="text-align:left; border-left: 5px solid var(--primary); padding:15px; background:#f8f9fa;">
            <label style="font-weight:bold;">BaÅlÄ±k</label><input id="swal-title" class="swal2-input" style="width:100%; margin-bottom:10px;" value="${s.title}">
            <label style="font-weight:bold;">AÃ§Ä±klama (KÄ±sa)</label><textarea id="swal-desc" class="swal2-textarea" style="margin-bottom:10px;">${s.desc || ''}</textarea>
            <label style="font-weight:bold;">Ä°pucu (Tip)</label><input id="swal-tip" class="swal2-input" style="width:100%; margin-bottom:10px;" value="${s.tip || ''}">
            <label style="font-weight:bold;">Detay (Alt Metin)</label><textarea id="swal-detail" class="swal2-textarea" style="margin-bottom:10px;">${s.detail || ''}</textarea>
            <label style="font-weight:bold;">OkunuÅu</label><input id="swal-pron" class="swal2-input" style="width:100%; margin-bottom:10px;" value="${s.pronunciation || ''}">
            <label style="font-weight:bold;">Ä°kon SÄ±nÄ±fÄ±</label><input id="swal-icon" class="swal2-input" style="width:100%;" value="${s.icon || ''}">
        </div>`,
        width: '700px', showCancelButton: true, confirmButtonText: 'Kaydet',
        preConfirm: () => [
            document.getElementById('swal-title').value, document.getElementById('swal-desc').value, document.getElementById('swal-tip').value,
            document.getElementById('swal-detail').value, document.getElementById('swal-pron').value, document.getElementById('swal-icon').value
        ]
    });
    if (formValues) {
        const originalTitle = s.title;
        if(formValues[1] !== s.desc) sendUpdate(originalTitle, "Text", formValues[1], 'sport');
        if(formValues[2] !== s.tip) setTimeout(() => sendUpdate(originalTitle, "Tip", formValues[2], 'sport'), 500);
        if(formValues[3] !== s.detail) setTimeout(() => sendUpdate(originalTitle, "Detail", formValues[3], 'sport'), 1000);
        if(formValues[4] !== s.pronunciation) setTimeout(() => sendUpdate(originalTitle, "Pronunciation", formValues[4], 'sport'), 1500);
        if(formValues[5] !== s.icon) setTimeout(() => sendUpdate(originalTitle, "Icon", formValues[5], 'sport'), 2000);
        if(formValues[0] !== originalTitle) setTimeout(() => sendUpdate(originalTitle, "Title", formValues[0], 'sport'), 2500);
    }
}
async function editSales(title) {
    event.stopPropagation();
    const s = salesScripts.find(item => item.title === title);
    if (!s) return Swal.fire('Hata', 'Ä°Ã§erik bulunamadÄ±.', 'error');
    const { value: formValues } = await Swal.fire({
        title: 'SatÄ±Å Metnini DÃ¼zenle',
        html: `<div class="card" style="text-align:left; border-left: 5px solid var(--sales); padding:15px; background:#ecfdf5;"><label style="font-weight:bold;">BaÅlÄ±k</label><input id="swal-title" class="swal2-input" style="width:100%; margin-bottom:10px;"
        value="${s.title}"><label style="font-weight:bold;">Metin</label><textarea id="swal-text" class="swal2-textarea" style="min-height:150px;">${s.text || ''}</textarea></div>`,
        width: '700px', showCancelButton: true, confirmButtonText: 'Kaydet',
        preConfirm: () => [ document.getElementById('swal-title').value, document.getElementById('swal-text').value ]
    });
    if (formValues) {
        const originalTitle = s.title;
        if(formValues[1] !== s.text) sendUpdate(originalTitle, "Text", formValues[1], 'sales');
        if(formValues[0] !== originalTitle) setTimeout(() => sendUpdate(originalTitle, "Title", formValues[0], 'sales'), 500);
    }
}
async function editNews(index) {
    const i = newsData[index];
    let statusOptions = `<option value="Aktif" ${i.status !== 'Pasif' ? 'selected' : ''}>Aktif</option><option value="Pasif" ${i.status === 'Pasif' ? 'selected' : ''}>Pasif</option>`;
    let typeOptions = `<option value="info" ${i.type === 'info' ? 'selected' : ''}>Bilgi</option><option value="update" ${i.type === 'update' ? 'selected' : ''}>DeÄiÅiklik</option><option value="fix" ${i.type === 'fix' ? 'selected' : ''}>ÃÃ¶zÃ¼ldÃ¼</option>`;
    
    const { value: formValues } = await Swal.fire({
        title: 'Duyuruyu DÃ¼zenle',
        html: `<div class="card" style="text-align:left; border-left: 5px solid var(--secondary); padding:15px; background:#fff8e1;"><label style="font-weight:bold;">BaÅlÄ±k</label><input id="swal-title" class="swal2-input" style="width:100%; margin-bottom:10px;"
        value="${i.title || ''}"><div style="display:flex; gap:10px; margin-bottom:10px;"><div style="flex:1;"><label style="font-weight:bold;">Tarih</label><input id="swal-date" class="swal2-input" style="width:100%;"
        value="${i.date || ''}"></div><div style="flex:1;"><label style="font-weight:bold;">TÃ¼r</label><select id="swal-type" class="swal2-input" style="width:100%;">${typeOptions}</select></div></div><label style="font-weight:bold;">Metin</label><textarea id="swal-desc" class="swal2-textarea" style="margin-bottom:10px;">${i.desc || ''}</textarea><label style="font-weight:bold;">Durum</label><select id="swal-status" class="swal2-input" style="width:100%;">${statusOptions}</select></div>`,
        width: '600px', showCancelButton: true, confirmButtonText: 'Kaydet',
        preConfirm: () => [
            document.getElementById('swal-title').value, document.getElementById('swal-date').value,
            document.getElementById('swal-desc').value, document.getElementById('swal-type').value, document.getElementById('swal-status').value
        ]
    });
    if (formValues) {
        const originalTitle = i.title;
        if(formValues[1] !== i.date) sendUpdate(originalTitle, "Date", formValues[1], 'news');
        if(formValues[2] !== i.desc) setTimeout(() => sendUpdate(originalTitle, "Text", formValues[2], 'news'), 500);
        if(formValues[3] !== i.type) setTimeout(() => sendUpdate(originalTitle, "Category", formValues[3], 'news'), 1000);
        if(formValues[4] !== i.status) setTimeout(() => sendUpdate(originalTitle, "Status", formValues[4], 'news'), 1500);
        if(formValues[0] !== originalTitle) setTimeout(() => sendUpdate(originalTitle, "Title", formValues[0], 'news'), 2000);
    }
}
// --- STANDARD MODALS (TICKER, NEWS, GUIDE, SALES) ---
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function startTicker() {
    const t = document.getElementById('ticker-content');
    const activeNews = newsData.filter(i => i.status !== 'Pasif');
    if(activeNews.length === 0) { t.innerHTML = "GÃ¼ncel duyuru yok."; t.style.animation = 'none'; return; }
    
    let tickerText = activeNews.map(i => {
        return `<span style="color:#fabb00; font-weight:bold;">[${i.date}]</span> <span style="color:#fff;">${i.title}:</span> <span style="color:#ddd;">${i.desc}</span>`;
    }).join(' &nbsp;&nbsp;&nbsp;&nbsp; â¢ &nbsp;&nbsp;&nbsp;&nbsp; ');
    t.innerHTML = tickerText + ' &nbsp;&nbsp;&nbsp;&nbsp; â¢ &nbsp;&nbsp;&nbsp;&nbsp; ' + tickerText;
    t.style.animation = 'ticker-scroll 190s linear infinite';
}
function openNews() {
    document.getElementById('news-modal').style.display = 'flex';
    const c = document.getElementById('news-container');
    c.innerHTML = '';
    newsData.forEach((i, index) => {
        let cl = i.type === 'fix' ? 'tag-fix' : (i.type === 'update' ? 'tag-update' : 'tag-info');
        let tx = i.type === 'fix' ? 'ÃÃ¶zÃ¼ldÃ¼' : (i.type === 'update' ? 'DeÄiÅiklik' : 'Bilgi');
        let passiveStyle = i.status === 'Pasif' ? 'opacity:0.5; background:#eee;' : '';
        let passiveBadge = i.status === 'Pasif' ? '<span class="news-tag" style="background:#555; color:white;">PASÄ°F</span>' : '';
        let editBtn = (isAdminMode && isEditingActive) ? `<i class="fas fa-pencil-alt edit-icon" style="top:0; right:0; font-size:0.9rem; padding:4px;" onclick="event.stopPropagation(); editNews(${index})"></i>` : '';
        c.innerHTML += `<div class="news-item" style="${passiveStyle}">${editBtn}<span class="news-date">${i.date}</span><span class="news-title">${i.title} ${passiveBadge}</span><div class="news-desc">${i.desc}</div><span class="news-tag ${cl}">${tx}</span></div>`;
    });
}


// =========================
// â YayÄ±n AkÄ±ÅÄ± (E-Tablo'dan)
// =========================
async function fetchBroadcastFlow() {
    const r = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
            action: "getBroadcastFlow",
            username: (typeof currentUser !== "undefined" ? currentUser : ""),
            token: (typeof getToken === "function" ? getToken() : "")
        })
    });

    const d = await r.json();
    if (!d || d.result !== "success") {
        throw new Error((d && d.message) ? d.message : "YayÄ±n akÄ±ÅÄ± alÄ±namadÄ±.");
    }
    return d.items || [];
}

async function openBroadcastFlow() {
  Swal.fire({
    title: "YayÄ±n AkÄ±ÅÄ±",
    didOpen: () => Swal.showLoading(),
    showConfirmButton: false
  });

  try {
    const itemsRaw = await fetchBroadcastFlow();

    if (!itemsRaw || !itemsRaw.length) {
      Swal.fire("YayÄ±n AkÄ±ÅÄ±", "KayÄ±t bulunamadÄ±.", "info");
      return;
    }

    // â SÄ±ralama (epoch varsa kesin, yoksa tarih+saate gÃ¶re)
    const items = [...itemsRaw].sort((a, b) => {
      const ae = Number(a?.startEpoch || 0);
      const be = Number(b?.startEpoch || 0);
      if (ae && be) return ae - be;

      const ak = String(a?.dateISO || a?.date || "") + " " + String(a?.time || "");
      const bk = String(b?.dateISO || b?.date || "") + " " + String(b?.time || "");
      return ak.localeCompare(bk);
    });

    const now = Date.now();

    // â Tarihe gÃ¶re grupla (dateISO)
    const byDate = {};
    const dateLabelByKey = {};
    items.forEach(it => {
      const key = String(it?.dateISO || it?.date || "Tarih Yok");
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(it);

      if (!dateLabelByKey[key]) {
        dateLabelByKey[key] = String(it?.dateLabelTr || "");
      }
    });

    // â Popup CSS (Swal iÃ§i)
    const css = `
      <style>
        .ba-wrap{ text-align:left; max-height:62vh; overflow:auto; padding-right:6px; }
        .ba-day{ margin:14px 0 8px; font-weight:900; color:#0e1b42; display:flex; align-items:center; gap:10px; }

        .ba-section{ margin:16px 0 8px; font-weight:900; color:#0e1b42; font-size:1rem; }
        .ba-divider{ margin:14px 0; height:1px; background:#e9e9e9; }
        .ba-empty{ padding:10px 12px; border:1px dashed #ddd; border-radius:12px; background:#fafafa; color:#666; margin:10px 0; font-weight:700; }
        .ba-badge{ font-size:.75rem; padding:4px 8px; border-radius:999px; border:1px solid #e9e9e9; background:#f8f8f8; color:#444; }
        .ba-grid{ display:grid; gap:8px; }
        .ba-row{
          border:1px solid #eee;
          border-left:4px solid var(--secondary);
          border-radius:12px;
          padding:10px 12px;
          background:#fff;
        }
        .ba-row.past{
          border-left-color:#d9534f;
          background:#fff5f5;
        }
        .ba-top{ display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
        .ba-title{ font-weight:900; color:#222; line-height:1.25; }
        .ba-time{ font-weight:900; color:#0e1b42; white-space:nowrap; }
        .ba-sub{ margin-top:6px; font-size:.86rem; color:#666; display:flex; gap:14px; flex-wrap:wrap; }
        .ba-legend{ display:flex; gap:10px; flex-wrap:wrap; margin:6px 0 10px; }
        .ba-dot{ display:inline-flex; align-items:center; gap:6px; font-size:.8rem; color:#444; }
        .ba-dot i{ width:10px; height:10px; border-radius:50%; display:inline-block; }
        .ba-dot .up{ background:var(--secondary); }
        .ba-dot .pa{ background:#d9534f; }
      </style>
    `;

    let html = `${css}<div class="ba-wrap">`;
    html += `
      <div class="ba-legend">
        <span class="ba-dot"><i class="up"></i> YaklaÅan / Gelecek</span>
        <span class="ba-dot"><i class="pa"></i> Tarihi GeÃ§miÅ</span>
      </div>
    `;

        // â YaklaÅan / Gelecek ve GeÃ§miÅ olarak ayÄ±r
    const upcomingByDate = {};
    const pastByDate = {};
    const dateKeys = Object.keys(byDate);

    dateKeys.forEach(key => {
      const arr = byDate[key] || [];
      arr.forEach(it => {
        const startEpoch = Number(it?.startEpoch || 0);
        const isPast = startEpoch ? (startEpoch < now) : false;
        const bucket = isPast ? pastByDate : upcomingByDate;
        if (!bucket[key]) bucket[key] = [];
        bucket[key].push(it);
      });
    });

    const renderSection = (title, bucket, emptyText) => {
      const keys = dateKeys.filter(k => (bucket[k] && bucket[k].length));
      if (!keys.length) {
        html += `<div class="ba-empty">${escapeHtml(emptyText)}</div>`;
        return;
      }
      html += `<div class="ba-section">${escapeHtml(title)}</div>`;
      keys.forEach(key => {
        const label = dateLabelByKey[key] || _formatBroadcastDateTr({ dateISO: key });
        html += `<div class="ba-day">${escapeHtml(label)}</div>`;
        html += `<div class="ba-grid">`;

        bucket[key].forEach(it => {
          const startEpoch = Number(it?.startEpoch || 0);
          const isPast = startEpoch ? (startEpoch < now) : false;

          const time = String(it?.time || "").trim();
          const event = String(it?.event || "").trim();
          const announcer = String(it?.announcer || "").trim();

          html += `
            <div class="ba-row ${isPast ? "past" : ""}">
              <div class="ba-top">
                <div class="ba-title">${escapeHtml(event || "-")}</div>
                <div class="ba-time">${escapeHtml(time || "")}</div>
              </div>
              <div class="ba-sub">
                <span><i class="fas fa-microphone"></i> ${escapeHtml(announcer || "-")}</span>
              </div>
            </div>`;
        });

        html += `</div>`;
      });
    };

    // â Ãnce yaklaÅanlar, sonra geÃ§miÅler
    renderSection("YaklaÅan / Gelecek", upcomingByDate, "YaklaÅan yayÄ±n bulunamadÄ±.");
    html += `<div class="ba-divider"></div>`;
    renderSection("GeÃ§miÅ", pastByDate, "GeÃ§miÅ yayÄ±n bulunamadÄ±.");

    html += `</div>`;

    Swal.fire({
      title: "YayÄ±n AkÄ±ÅÄ±",
      html,
      width: 980,
      confirmButtonText: "Kapat"
    });

  } catch (err) {
    Swal.fire("Hata", err?.message || "YayÄ±n akÄ±ÅÄ± alÄ±namadÄ±.", "error");
  }
}

// XSS korumasÄ±

function _formatBroadcastDateTr(it) {
    // Backend yeni alanlarÄ± gÃ¶nderiyorsa kullan
    if (it && it.dateLabelTr) return String(it.dateLabelTr);

    // Fallback: it.dateISO (yyyy-mm-dd) veya it.date
    const s = String(it?.dateISO || it?.date || "").trim();
    if (!s) return "Tarih Yok";

    // ISO yyyy-mm-dd
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric", weekday: "long" }).format(d);
    }

    // dd.mm.yyyy / dd/mm/yyyy
    const m2 = s.match(/^(\d{1,2})[\./-](\d{1,2})[\./-](\d{4})/);
    if (m2) {
        const d = new Date(Number(m2[3]), Number(m2[2]) - 1, Number(m2[1]));
        return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric", weekday: "long" }).format(d);
    }

    return s; // en kÃ¶tÃ¼ haliyle gÃ¶ster
}

function escapeHtml(str) {
    return String(str ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function openGuide() {
    document.getElementById('guide-modal').style.display = 'flex';
    const grid = document.getElementById('guide-grid');
    grid.innerHTML = '';
    sportsData.forEach((s, index) => {
        let pronHtml = s.pronunciation ? `<div class="pronunciation-badge"> ð£ï¸  ${s.pronunciation}</div>` : '';
        let editBtn = (isAdminMode && isEditingActive) ? `<i class="fas fa-pencil-alt edit-icon" style="top:5px; right:5px; z-index:50;" onclick="event.stopPropagation(); editSport('${escapeForJsString(s.title)}')"></i>` : '';
        grid.innerHTML += `<div class="guide-item" onclick="showSportDetail(${index})">${editBtn}<i class="fas ${s.icon} guide-icon"></i><span class="guide-title">${s.title}</span>${pronHtml}<div class="guide-desc">${s.desc}</div><div class="guide-tip"><i class="fas fa-lightbulb"></i> ${s.tip}</div><div style="font-size:0.8rem; color:#999; margin-top:5px;">(Detay iÃ§in tÄ±kla)</div></div>`;
    });
}
function showSportDetail(index) {
    const sport = sportsData[index];
    const detailText = sport.detail ? sport.detail.replace(/\n/g,'<br>') : "Bu iÃ§erik iÃ§in henÃ¼z detay eklenmemiÅ.";
    const pronDetail = sport.pronunciation ? `<div style="color:#e65100; font-weight:bold; margin-bottom:15px;"> ð£ï¸  OkunuÅu: ${sport.pronunciation}</div>` : '';
    Swal.fire({
        title: `<i class="fas ${sport.icon}" style="color:#0e1b42;"></i> ${sport.title}`,
        html: `${pronDetail}<div style="text-align:left; font-size:1rem; line-height:1.6;">${detailText}</div>`,
        showCloseButton: true, showConfirmButton: false, width: '600px', background: '#f8f9fa'
    });
}
function openSales() {
    // TeleSatÄ±Å artÄ±k tam ekran modÃ¼l
    openTelesalesArea();
}
function toggleSales(index) {
    const item = document.getElementById(`sales-${index}`);
    const icon = document.getElementById(`icon-${index}`);
    item.classList.toggle('active');
    if(item.classList.contains('active')){ icon.classList.replace('fa-chevron-down', 'fa-chevron-up'); } 
    else { icon.classList.replace('fa-chevron-up', 'fa-chevron-down'); }
}

// --- PENALTY GAME ---
// TasarÄ±m/GÃ¼ncelleme: Tekrarlayan soru engeli, akÄ±llÄ± 50:50, double rozet, daha net maÃ§ sonu ekranÄ±

let pScore = 0, pBalls = 10, pCurrentQ = null;
let pQuestionQueue = [];        // oturum boyunca sorulacak soru indeksleri (karÄ±ÅtÄ±rÄ±lmÄ±Å)
let pAskedCount = 0;            // kaÃ§ soru soruldu
let pCorrectCount = 0;          // kaÃ§ doÄru
let pWrongCount = 0;            // kaÃ§ yanlÄ±Å

function setDoubleIndicator(isActive) {
    const el = document.getElementById('double-indicator');
    if (!el) return;
    el.style.display = isActive ? 'inline-flex' : 'none';
}

function updateJokerButtons() {
    const callBtn = document.getElementById('joker-call');
    const halfBtn = document.getElementById('joker-half');
    const doubleBtn = document.getElementById('joker-double');

    if (callBtn) callBtn.disabled = jokers.call === 0;
    if (halfBtn) halfBtn.disabled = jokers.half === 0;
    if (doubleBtn) doubleBtn.disabled = jokers.double === 0 || firstAnswerIndex !== -1;

    // Double aktifken diÄerleri kilitlensin
    if (firstAnswerIndex !== -1) {
        if (callBtn) callBtn.disabled = true;
        if (halfBtn) halfBtn.disabled = true;
        if (doubleBtn) doubleBtn.disabled = true;
    }
}

function useJoker(type) {
    if (!pCurrentQ) return;
    if (jokers[type] === 0) return;
    if (firstAnswerIndex !== -1 && type !== 'double') return;

    jokers[type] = 0;
    updateJokerButtons();

    const currentQ = pCurrentQ;
    const correctAns = currentQ.a;
    const btns = document.querySelectorAll('.penalty-btn');

    if (type === 'call') {
        const experts = ["Umut Bey", "DoÄuÅ Bey", "Deniz Bey", "Esra HanÄ±m"];
        const expert = experts[Math.floor(Math.random() * experts.length)];

        let guess = correctAns;
        // %80 doÄru, %20 yanlÄ±Å tahmin
        if (Math.random() > 0.8 && currentQ.opts.length > 1) {
            const incorrect = currentQ.opts.map((_, i) => i).filter(i => i !== correctAns);
            guess = incorrect[Math.floor(Math.random() * incorrect.length)] ?? correctAns;
        }

        Swal.fire({
            icon: 'info',
            title: ' ð Telefon Jokeri',
            html: `${expert} soruyu cevaplÄ±yor...<br><br>"Benim tahminim **${String.fromCharCode(65 + guess)}** ÅÄ±kkÄ±. Bundan ${Math.random() < 0.8 ? "Ã§ok eminim" : "emin deÄilim"}."`,
            confirmButtonText: 'Kapat'
        });

    } else if (type === 'half') {
        const optLen = Array.isArray(currentQ.opts) ? currentQ.opts.length : 0;
        if (optLen <= 2) {
            Swal.fire({ icon:'info', title:'âï¸ 50:50', text:'Bu soruda 50:50 uygulanamaz.', toast:true, position:'top', showConfirmButton:false, timer:1800 });
            return;
        }

        // 4+ ÅÄ±kta 2 yanlÄ±Å, 3 ÅÄ±kta 1 yanlÄ±Å ele
        const removeCount = optLen >= 4 ? 2 : 1;
        const incorrect = currentQ.opts.map((_, i) => i).filter(i => i !== correctAns);
        incorrect.sort(() => Math.random() - 0.5).slice(0, removeCount).forEach(idx => {
            const b = btns[idx];
            if (!b) return;
            b.disabled = true;
            b.style.textDecoration = 'line-through';
            b.style.opacity = '0.4';
        });

        Swal.fire({
            icon: 'success',
            title: ' âï¸ 50:50',
            text: removeCount === 2 ? 'Ä°ki yanlÄ±Å ÅÄ±k elendi!' : 'Bir yanlÄ±Å ÅÄ±k elendi!',
            toast: true,
            position: 'top',
            showConfirmButton: false,
            timer: 1400
        });

    } else if (type === 'double') {
        doubleChanceUsed = true;
        setDoubleIndicator(true);
        Swal.fire({
            icon: 'warning',
            title: '2ï¸ â£ Ãift Cevap',
            text: 'Bir kez yanlÄ±Å cevap hakkÄ±n var.',
            toast: true,
            position: 'top',
            showConfirmButton: false,
            timer: 2200
        });
    }
}


function openGameHub() {
    document.getElementById('game-hub-modal').style.display = 'flex';
}

function openQuickDecisionGame() {
    try { closeModal('game-hub-modal'); } catch(e) {}
    document.getElementById('quick-modal').style.display = 'flex';

    // Lobby ekranÄ±
    const lobby = document.getElementById('qd-lobby');
    const game = document.getElementById('qd-game');
    if (lobby) lobby.style.display = 'block';
    if (game) game.style.display = 'none';

    // Reset gÃ¶stergeler
    const t = document.getElementById('qd-time'); if (t) t.innerText = '30';
    const s = document.getElementById('qd-score'); if (s) s.innerText = '0';
    const st = document.getElementById('qd-step'); if (st) st.innerText = '0';
}

// --- HIZLI KARAR OYUNU ---
let qdTimer = null;
let qdTimeLeft = 30;
let qdScore = 0;
let qdStep = 0;
let qdQueue = [];

const QUICK_DECISION_BANK = [
  {
    q: 'MÃ¼Återi: "Fiyat pahalÄ±, iptal edeceÄim." Ä°lk yaklaÅÄ±mÄ±n ne olmalÄ±?',
    opts: [
      'Hemen iptal iÅlemini baÅlatalÄ±m.',
      'HaklÄ±sÄ±nÄ±z, sizi anlÄ±yorum. Paket/avantajlara gÃ¶re alternatif sunayÄ±m mÄ±?',
      'Kampanya yok, yapacak bir Åey yok.'
    ],
    a: 1,
    exp: 'Empati + ihtiyaÃ§ analizi itirazÄ± yumuÅatÄ±r ve iknayÄ± artÄ±rÄ±r.'
  },
  {
    q: 'MÃ¼Återi: "Uygulama aÃ§Ä±lmÄ±yor." En hÄ±zlÄ± ilk kontrol ne?',
    opts: [
      'Åifreyi sÄ±fÄ±rlat.',
      'Ä°nternet baÄlantÄ±sÄ± / VPN / DNS kontrolÃ¼ yaptÄ±r.',
      'Hemen cihazÄ± fabrika ayarlarÄ±na dÃ¶ndÃ¼r.'
    ],
    a: 1,
    exp: 'Ãnce kÃ¶k nedeni daralt: baÄlantÄ± mÄ± uygulama mÄ±? BÃ¼yÃ¼k adÄ±mlarÄ± sona bÄ±rak.'
  },
  {
    q: 'MÃ¼Återi: "YayÄ±n donuyor." Teknikte doÄru soru hangisi?',
    opts: [
      'Hangi cihazda (TV/telefon) ve hangi aÄda (WiâFi/kablo) oluyor?',
      'KaÃ§ gÃ¼ndÃ¼r bÃ¶yle?',
      'Åimdi kapatÄ±p aÃ§Ä±n.'
    ],
    a: 0,
    exp: 'Cihaz + aÄ bilgisi, sorunu hÄ±zlÄ± izole etmeyi saÄlar.'
  },
  {
    q: 'MÃ¼Återi: "Ä°ade istiyorum." En doÄru yÃ¶nlendirme?',
    opts: [
      'Hemen kapatalÄ±m.',
      'Ä°ade koÅullarÄ± ve adÄ±mlarÄ± net anlat, doÄru kanala yÃ¶nlendir (asistan/rehber).',
      'Tekrar arayÄ±n.'
    ],
    a: 1,
    exp: 'Net sÃ¼reÃ§ + doÄru kanal = memnuniyet + tekrar aramayÄ± azaltÄ±r.'
  },
  {
    q: 'MÃ¼Återi: "Kampanyadan yararlanamÄ±yorum." Ä°lk adÄ±m?',
    opts: [
      'Kampanya koÅullarÄ± (tarih/paket/cihaz) uygun mu kontrol et.',
      'Direkt kampanyayÄ± tanÄ±mla.',
      'Sorun yok deyip kapat.'
    ],
    a: 0,
    exp: 'Uygunluk kontrolÃ¼ yapÄ±lmadan iÅlem yapmak hataya sÃ¼rÃ¼kler.'
  },
  {
    q: 'MÃ¼Återi sinirli: "Kimse Ã§Ã¶zmedi!" Ne yaparsÄ±n?',
    opts: [
      'SakinleÅtirici bir cÃ¼mle + Ã¶zet + net aksiyon planÄ±.',
      'SÄ±raya alalÄ±m.',
      'Ses yÃ¼kselt.'
    ],
    a: 0,
    exp: 'KontrolÃ¼ geri almak iÃ§in empati + Ã¶zet + plan Ã¼Ã§lÃ¼sÃ¼ Ã§alÄ±ÅÄ±r.'
  }
];

function resetQuickDecision() {
    if (qdTimer) { clearInterval(qdTimer); qdTimer = null; }
    qdTimeLeft = 30; qdScore = 0; qdStep = 0; qdQueue = [];
    openQuickDecisionGame();
}

function startQuickDecision() {
    const bank = Array.isArray(quickDecisionQuestions) ? quickDecisionQuestions : [];
    if (!bank.length) {
        Swal.fire('Bilgi', 'Sorular henÃ¼z yÃ¼klenmedi. LÃ¼tfen admin panelden sorularÄ± ekleyin ve sayfayÄ± yenileyin.', 'info');
        return;
    }

    const take = Math.min(5, bank.length);
    const idxs = Array.from({length: bank.length}, (_,i)=>i).sort(()=>Math.random()-0.5).slice(0, take);
    qdQueue = idxs.map(i => bank[i]);
    qdTimeLeft = 30;
    qdScore = 0;
    qdStep = 0;

    const lobby = document.getElementById('qd-lobby');
    const game = document.getElementById('qd-game');
    if (lobby) lobby.style.display = 'none';
    if (game) game.style.display = 'block';

    updateQuickHud();
    renderQuickQuestion();

    if (qdTimer) clearInterval(qdTimer);
    qdTimer = setInterval(() => {
        qdTimeLeft -= 1;
        updateQuickHud();
        if (qdTimeLeft <= 0) {
            finishQuickDecision(true);
        }
    }, 1000);
}

function updateQuickHud() {
    const t = document.getElementById('qd-time'); if (t) t.innerText = String(Math.max(0, qdTimeLeft));
    const s = document.getElementById('qd-score'); if (s) s.innerText = String(qdScore);
    const st = document.getElementById('qd-step'); if (st) st.innerText = String(qdStep);
}

function renderQuickQuestion() {
    const q = qdQueue[qdStep];
    const qEl = document.getElementById('qd-question');
    const optEl = document.getElementById('qd-options');
    if (!qEl || !optEl || !q) return;

    qEl.innerText = q.q;
    optEl.innerHTML = '';

    q.opts.forEach((txt, i) => {
        const b = document.createElement('button');
        b.className = 'quick-opt';
        b.innerText = txt;
        b.onclick = () => answerQuick(i);
        optEl.appendChild(b);
    });
}

function answerQuick(idx) {
    const q = qdQueue[qdStep];
    const optEl = document.getElementById('qd-options');
    if (!q || !optEl) return;

    const btns = Array.from(optEl.querySelectorAll('button'));
    btns.forEach(b => b.disabled = true);

    const correct = (idx === q.a);

    if (btns[idx]) btns[idx].classList.add(correct ? 'good' : 'bad');
    if (!correct && btns[q.a]) btns[q.a].classList.add('good');

    // puanlama: doÄru +2, yanlÄ±Å -1
    qdScore += correct ? 2 : -1;
    if (qdScore < 0) qdScore = 0;
    updateQuickHud();

    Swal.fire({
        toast: true,
        position: 'top',
        icon: correct ? 'success' : 'warning',
        title: correct ? 'DoÄru seÃ§im!' : 'YanlÄ±Å seÃ§im',
        text: q.exp,
        showConfirmButton: false,
        timer: 1800
    });

    setTimeout(() => {
        qdStep += 1;
        updateQuickHud();
        if (qdStep >= qdQueue.length) finishQuickDecision(false);
        else renderQuickQuestion();
    }, 650);
}

function finishQuickDecision(timeout) {
    if (qdTimer) { clearInterval(qdTimer); qdTimer = null; }

    const msg = timeout ? 'SÃ¼re bitti!' : 'Bitti!';
    Swal.fire({
        icon: 'info',
        title: `ð§  HÄ±zlÄ± Karar ${msg}`,
        html: `<div style="text-align:center;">
                <div style="font-size:1.0rem; margin-bottom:8px;">Skorun: <b>${qdScore}</b></div>
                <div style="color:#666; font-size:0.9rem;">Ä°stersen yeniden baÅlatÄ±p rekor deneyebilirsin.</div>
              </div>`,
        confirmButtonText: 'Tamam'
    });

    // Lobby'e dÃ¶n
    const lobby = document.getElementById('qd-lobby');
    const game = document.getElementById('qd-game');
    if (lobby) lobby.style.display = 'block';
    if (game) game.style.display = 'none';
    const t = document.getElementById('qd-time'); if (t) t.innerText = '30';
    const st = document.getElementById('qd-step'); if (st) st.innerText = '0';
}

function openPenaltyGame() {
    try { closeModal('game-hub-modal'); } catch(e) {}
    document.getElementById('penalty-modal').style.display = 'flex';
    showLobby();
}

function showLobby() {
    document.getElementById('penalty-lobby').style.display = 'flex';
    document.getElementById('penalty-game-area').style.display = 'none';
    fetchLeaderboard();
}

function startGameFromLobby() {
    document.getElementById('penalty-lobby').style.display = 'none';
    document.getElementById('penalty-game-area').style.display = 'block';
    startPenaltySession();
}

function fetchLeaderboard() {
    const tbody = document.getElementById('leaderboard-body');
    const loader = document.getElementById('leaderboard-loader');
    const table = document.getElementById('leaderboard-table');

    if (!tbody || !loader || !table) return;

    tbody.innerHTML = '';
    loader.style.display = 'block';
    table.style.display = 'none';

    fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "getLeaderboard" })
    })
    .then(r => r.json())
    .then(data => {
        loader.style.display = 'none';
        if (data.result !== "success") {
            loader.innerText = "YÃ¼klenemedi.";
            loader.style.display = 'block';
            return;
        }

        table.style.display = 'table';
        let html = '';

        if (!data.leaderboard || data.leaderboard.length === 0) {
            html = '<tr><td colspan="4" style="text-align:center;">HenÃ¼z maÃ§ yapÄ±lmadÄ±.</td></tr>';
        } else {
            data.leaderboard.forEach((u, i) => {
                const medal = i===0 ? 'ð¥' : (i===1 ? 'ð¥' : (i===2 ? 'ð¥' : `<span class="rank-badge">${i+1}</span>`));
                const bgStyle = (u.username === currentUser) ? 'background:rgba(250, 187, 0, 0.1);' : '';
                html += `<tr style="${bgStyle}"><td>${medal}</td><td>${u.username}</td><td>${u.games}</td><td>${u.average}</td></tr>`;
            });
        }
        tbody.innerHTML = html;
    })
    .catch(() => {
        loader.style.display = 'none';
        loader.innerText = "BaÄlantÄ± hatasÄ±.";
        loader.style.display = 'block';
    });
}

function buildQuestionQueue() {
    const n = quizQuestions.length;
    const idxs = Array.from({ length: n }, (_, i) => i);
    idxs.sort(() => Math.random() - 0.5);

    // 10 soru iÃ§in yeter yoksa, yine de dÃ¶ngÃ¼ye sokmayalÄ±m: kalan toplarda tekrar olabilir.
    // ama Ã¶nce tÃ¼m sorular bir kez gelsin.
    return idxs;
}

function startPenaltySession() {
    // Session reset
    pScore = 0;
    pBalls = 10;
    pAskedCount = 0;
    pCorrectCount = 0;
    pWrongCount = 0;

    jokers = { call: 1, half: 1, double: 1 };
    doubleChanceUsed = false;
    firstAnswerIndex = -1;
    setDoubleIndicator(false);

    // Soru kuyruÄu
    pQuestionQueue = buildQuestionQueue();

    updateJokerButtons();
    document.getElementById('p-score').innerText = pScore;
    document.getElementById('p-balls').innerText = pBalls;

    const restartBtn = document.getElementById('p-restart-btn');
    const optionsEl = document.getElementById('p-options');
    if (restartBtn) restartBtn.style.display = 'none';
    if (optionsEl) optionsEl.style.display = 'grid';

    resetField();
    loadPenaltyQuestion();
}

function pickNextQuestion() {
    if (quizQuestions.length === 0) return null;

    // Ãnce kuyruktan tÃ¼ket
    if (pQuestionQueue.length > 0) {
        const i = pQuestionQueue.shift();
        return quizQuestions[i];
    }

    // Kuyruk bitti ama top devam ediyor: artÄ±k random (soru azsa)
    return quizQuestions[Math.floor(Math.random() * quizQuestions.length)];
}

function loadPenaltyQuestion() {
    if (pBalls <= 0) { finishPenaltyGame(); return; }
    if (!Array.isArray(quizQuestions) || quizQuestions.length === 0) {
        Swal.fire('Hata', 'Soru yok!', 'warning');
        return;
    }

    pCurrentQ = pickNextQuestion();
    if (!pCurrentQ || !pCurrentQ.opts || pCurrentQ.opts.length < 2) {
        Swal.fire('Hata', 'Bu soru hatalÄ± formatta (ÅÄ±k yok).', 'error');
        // bir sonraki soruyu dene
        pCurrentQ = pickNextQuestion();
        if (!pCurrentQ) return;
    }

    pAskedCount++;
    doubleChanceUsed = false;
    firstAnswerIndex = -1;
    setDoubleIndicator(false);
    updateJokerButtons();

    const qEl = document.getElementById('p-question-text');
    if (qEl) qEl.innerText = pCurrentQ.q || "Soru";

    let html = '';
    pCurrentQ.opts.forEach((opt, index) => {
        const letter = String.fromCharCode(65 + index);
        html += `<button class="penalty-btn" onclick="shootBall(${index})">${letter}: ${opt}</button>`;
    });

    const optionsEl = document.getElementById('p-options');
    if (optionsEl) optionsEl.innerHTML = html;
}

function shootBall(idx) {
    const btns = document.querySelectorAll('.penalty-btn');
    const isCorrect = (idx === pCurrentQ.a);

    // Double joker: ilk yanlÄ±Åta bir hak daha
    if (!isCorrect && doubleChanceUsed && firstAnswerIndex === -1) {
        firstAnswerIndex = idx;
        if (btns[idx]) {
            btns[idx].classList.add('wrong-first-try');
            btns[idx].disabled = true;
        }
        Swal.fire({ toast: true, position: 'top', icon: 'info', title: 'Ä°lk Hata! Kalan HakkÄ±n: 1', showConfirmButton: false, timer: 1400, background: '#ffc107' });
        updateJokerButtons();
        return;
    }

    // ArtÄ±k atÄ±Å kesinleÅti
    btns.forEach(b => b.disabled = true);

    const ballWrap = document.getElementById('ball-wrap');
    const keeperWrap = document.getElementById('keeper-wrap');
    const shooterWrap = document.getElementById('shooter-wrap');
    const goalMsg = document.getElementById('goal-msg');

    const shotDir = Math.floor(Math.random() * 4);
    if (shooterWrap) shooterWrap.classList.add('shooter-run');

    setTimeout(() => {
        if (keeperWrap) {
            if (isCorrect) {
                if (shotDir === 0 || shotDir === 2) keeperWrap.classList.add('keeper-dive-right');
                else keeperWrap.classList.add('keeper-dive-left');
            } else {
                if (shotDir === 0 || shotDir === 2) keeperWrap.classList.add('keeper-dive-left');
                else keeperWrap.classList.add('keeper-dive-right');
            }
        }

        if (isCorrect) {
            if (ballWrap) {
                if (shotDir === 0) ballWrap.classList.add('ball-shoot-left-top');
                else if (shotDir === 1) ballWrap.classList.add('ball-shoot-right-top');
                else if (shotDir === 2) ballWrap.classList.add('ball-shoot-left-low');
                else ballWrap.classList.add('ball-shoot-right-low');
            }

            setTimeout(() => {
                if (goalMsg) {
                    goalMsg.innerText = "GOL!!!";
                    goalMsg.style.color = "#fabb00";
                    goalMsg.classList.add('show');
                }
                pScore++;
                pCorrectCount++;
                document.getElementById('p-score').innerText = pScore;

                Swal.fire({ toast:true, position:'top', icon:'success', title:'MÃ¼kemmel Åut!', showConfirmButton:false, timer:900, background:'#a5d6a7' });
            }, 450);

        } else {
            pWrongCount++;

            const showWrong = () => {
                if (goalMsg) {
                    goalMsg.style.color = "#ef5350";
                    goalMsg.classList.add('show');
                }
                Swal.fire({ icon:'error', title:'KaÃ§Ä±rdÄ±n!', text:`DoÄru: ${String.fromCharCode(65 + pCurrentQ.a)}`, showConfirmButton:true, timer:2400, background:'#ef9a9a' });
            };

            if (Math.random() > 0.5) {
                if (ballWrap) {
                    ballWrap.style.bottom = "160px";
                    ballWrap.style.left = (shotDir === 0 || shotDir === 2) ? "40%" : "60%";
                    ballWrap.style.transform = "scale(0.6)";
                }
                setTimeout(() => { if (goalMsg) goalMsg.innerText = "KURTARDI!"; showWrong(); }, 450);
            } else {
                if (ballWrap) ballWrap.classList.add(Math.random() > 0.5 ? 'ball-miss-left' : 'ball-miss-right');
                setTimeout(() => { if (goalMsg) goalMsg.innerText = "DIÅARI!"; showWrong(); }, 450);
            }
        }
    }, 300);

    // top azalt
    pBalls--;
    document.getElementById('p-balls').innerText = pBalls;

    setTimeout(() => { resetField(); loadPenaltyQuestion(); }, 2400);
}

function resetField() {
    const ballWrap = document.getElementById('ball-wrap');
    const keeperWrap = document.getElementById('keeper-wrap');
    const shooterWrap = document.getElementById('shooter-wrap');
    const goalMsg = document.getElementById('goal-msg');

    if (ballWrap) { ballWrap.className = 'ball-wrapper'; ballWrap.style = ""; }
    if (keeperWrap) keeperWrap.className = 'keeper-wrapper';
    if (shooterWrap) shooterWrap.className = 'shooter-wrapper';
    if (goalMsg) goalMsg.classList.remove('show');

    document.querySelectorAll('.penalty-btn').forEach(b => {
        b.classList.remove('wrong-first-try');
        b.style.textDecoration = '';
        b.style.opacity = '';
        b.style.background = '#fabb00';
        b.style.color = '#0e1b42';
        b.style.borderColor = '#f0b500';
        b.disabled = false;
    });
}

function finishPenaltyGame() {
    const totalShots = 10;
    const title = pScore >= 8 ? "EFSANE! ð" : (pScore >= 5 ? "Ä°yi MaÃ§tÄ±! ð" : "Antrenman LazÄ±m ð¤");
    const acc = Math.round((pCorrectCount / Math.max(1, (pCorrectCount + pWrongCount))) * 100);

    const qEl = document.getElementById('p-question-text');
    if (qEl) {
        qEl.innerHTML = `
            <div style="font-size:1.5rem; color:#fabb00; font-weight:800;">MAÃ BÄ°TTÄ°!</div>
            <div style="margin-top:4px; font-size:1.1rem; color:#fff;">${title}</div>
            <div style="margin-top:8px; font-size:1rem; color:#ddd;">
                <b>Skor:</b> ${pScore}/${totalShots} &nbsp; â¢ &nbsp;
                <b>DoÄruluk:</b> ${acc}%
            </div>
            <div style="margin-top:6px; font-size:0.9rem; color:#bbb;">
                DoÄru: ${pCorrectCount} &nbsp; | &nbsp; YanlÄ±Å: ${pWrongCount}
            </div>
            <div style="margin-top:10px; font-size:0.85rem; color:#aaa;">
                Yeniden oynamak iÃ§in aÅaÄÄ±dan baÅlatabilirsin.
            </div>
        `;
    }

    const optionsEl = document.getElementById('p-options');
    const restartBtn = document.getElementById('p-restart-btn');
    if (optionsEl) optionsEl.style.display = 'none';
    if (restartBtn) restartBtn.style.display = 'block';

    // Leaderboard log (mevcut backend uyumu)
    fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "logQuiz", username: currentUser, token: getToken(), score: pScore * 10, total: 100 })
    }).finally(() => {
        // lobby tablosunu gÃ¼ncel tut
        setTimeout(fetchLeaderboard, 600);
    });
}


// --- WIZARD FUNCTIONS ---
function openWizard(){
    document.getElementById('wizard-modal').style.display='flex';
    if (Object.keys(wizardStepsData).length === 0) {
        Swal.fire({ title: 'Ä°ade AsistanÄ± Verisi YÃ¼kleniyor...', didOpen: () => Swal.showLoading() });
        loadWizardData().then(() => { Swal.close(); if (wizardStepsData['start']) renderStep('start'); else document.getElementById('wizard-body').innerHTML = '<h2 style="color:red;">Asistan verisi eksik.</h2>'; })
        .catch(() => { Swal.close(); document.getElementById('wizard-body').innerHTML = '<h2 style="color:red;">Veri Ã§ekme hatasÄ±.</h2>'; });
    } else { renderStep('start'); }
}
function renderStep(k){
    const s = wizardStepsData[k];
    if (!s) { document.getElementById('wizard-body').innerHTML = `<h2 style="color:red;">HATA: AdÄ±m ID (${k}) yok.</h2>`; return; }
    const b = document.getElementById('wizard-body');
    let h = `<h2 style="color:var(--primary);">${s.title || ''}</h2>`;
    if(s.result) {
        let i = s.result === 'red' ? ' ð ' : (s.result === 'green' ? ' â ' : ' â ï¸ ');
        let c = s.result === 'red' ? 'res-red' : (s.result === 'green' ? 'res-green' : 'res-yellow');
        h += `<div class="result-box ${c}"><div style="font-size:3rem;margin-bottom:10px;">${i}</div><h3>${s.title}</h3><p>${s.text}</p>${s.script ? `<div class="script-box">${s.script}</div>` : ''}</div><button class="restart-btn" onclick="renderStep('start')"><i class="fas fa-redo"></i> BaÅa DÃ¶n</button>`;
    } else {
        h += `<p>${s.text}</p><div class="wizard-options">`;
        s.options.forEach(o => { h += `<button class="option-btn" onclick="renderStep('${o.next}')"><i class="fas fa-chevron-right"></i> ${o.text}</button>`; });
        h += `</div>`; if(k !== 'start') h += `<button class="restart-btn" onclick="renderStep('start')" style="background:#eee;color:#333;margin-top:15px;">BaÅa DÃ¶n</button>`;
    }
    b.innerHTML = h;
}
// --- TECH WIZARD ---
const twState = { currentStep: 'start', history: [] };
function openTechWizard() {
    // Teknik Sihirbaz artÄ±k Teknik (tam ekran) iÃ§inde
    openTechArea('wizard');
}
function twRenderStep() {
    const contentDiv = document.getElementById('tech-wizard-content');
    const backBtn = document.getElementById('tw-btn-back');
    const stepData = techWizardData[twState.currentStep];
    if (twState.history.length > 0) backBtn.style.display = 'block'; else backBtn.style.display = 'none';
    if (!stepData) { contentDiv.innerHTML = `<div class="alert" style="color:red;">Hata: AdÄ±m bulunamadÄ± (${twState.currentStep}).</div>`; return; }
    let html = `<div class="tech-step-title">${stepData.title || ''}</div>`;
    if (stepData.text) html += `<p style="font-size:1rem; margin-bottom:15px;">${stepData.text}</p>`;
    if (stepData.script) {
        const safeScript = encodeURIComponent(stepData.script);
        html += `<div class="tech-script-box"><span class="tech-script-label">MÃ¼Återiye iletilecek:</span>"${stepData.script}"<div style="margin-top:10px; text-align:right;"><button class="btn btn-copy" style="font-size:0.8rem; padding:5px 10px;" onclick="copyScriptContent('${safeScript}')"><i class="fas fa-copy"></i> Kopyala</button></div></div>`;
    }
    if (stepData.alert) html += `<div class="tech-alert">${stepData.alert}</div>`;
    if (stepData.buttons && stepData.buttons.length > 0) {
        html += `<div class="tech-buttons-area">`;
        stepData.buttons.forEach(btn => { let btnClass = btn.style === 'option' ? 'tech-btn-option' : 'tech-btn-primary'; html += `<button class="tech-btn ${btnClass}" onclick="twChangeStep('${btn.next}')">${btn.text}</button>`; });
        html += `</div>`;
    }
    contentDiv.innerHTML = html;
}
function twChangeStep(newStep) { twState.history.push(twState.currentStep); twState.currentStep = newStep; twRenderStep(); }
function twGoBack() { if (twState.history.length > 0) { twState.currentStep = twState.history.pop(); twRenderStep(); } }
function twResetWizard() { twState.currentStep = 'start'; twState.history = []; twRenderStep(); }
// ==========================================================
// --- YENÄ° KALÄ°TE LMS MODÃLÃ (TAM EKRAN ENTEGRASYONU) ---
// ==========================================================
// ModÃ¼lÃ¼ AÃ§
function openQualityArea() {
    // Eski modalÄ± kapat (eÄer aÃ§Ä±ksa)
    const oldModal = document.getElementById('quality-modal');
    if(oldModal) oldModal.style.display = 'none';
    // Tam ekranÄ± aÃ§
    const fullScreen = document.getElementById('quality-fullscreen');
    fullScreen.style.display = 'flex';
    // KullanÄ±cÄ± bilgisini gÃ¼ncelle
    document.getElementById('q-side-name').innerText = currentUser;
    document.getElementById('q-side-role').innerText = isAdminMode ? 'YÃ¶netici' : 'Temsilci';
    document.getElementById('q-side-avatar').innerText = currentUser.charAt(0).toUpperCase();
    // DÃ¶nem filtresini doldur
    populateMonthFilterFull();
    // Yetki kontrolÃ¼ (Admin butonlarÄ±nÄ± gÃ¶ster/gizle)
    const adminFilters = document.getElementById('admin-filters');
    const assignBtn = document.getElementById('assign-training-btn');
    const manualFeedbackBtn = document.getElementById('manual-feedback-admin-btn');
    
    if (isAdminMode) {
        if(adminFilters) adminFilters.style.display = 'flex';
        if(assignBtn) assignBtn.style.display = 'block';
        if(manualFeedbackBtn) manualFeedbackBtn.style.display = 'flex';
        
        // KullanÄ±cÄ± listesi boÅsa Ã§ek, sonra filtreleri doldur
        if (adminUserList.length === 0) {
            fetchUserListForAdmin().then(users => {
                const groupSelect = document.getElementById('q-admin-group');
                if(groupSelect) {
                    const groups = [...new Set(users.map(u => u.group))].sort();
                    groupSelect.innerHTML = `<option value="all">TÃ¼m Gruplar</option>` + groups.map(g => `<option value="${g}">${g}</option>`).join('');
                    updateAgentListBasedOnGroup();
                }
                populateDashboardFilters(); // Dashboard filtrelerini de doldur
            });
        } else {
            populateDashboardFilters(); // Liste zaten varsa direkt doldur
        }
    } else {
        if(adminFilters) adminFilters.style.display = 'none';
        if(assignBtn) assignBtn.style.display = 'none';
        if(manualFeedbackBtn) manualFeedbackBtn.style.display = 'none';
        
        // Admin deÄilse filtreleri gizle
        const dashFilterArea = document.querySelector('#view-dashboard .q-view-header > div');
        if(dashFilterArea && dashFilterArea.style.display !== 'none') {
             // Burada basitÃ§e dashboard filtre fonksiyonu admin kontrolÃ¼ yapÄ±yor.
             populateDashboardFilters(); 
        }
    }
    // VarsayÄ±lan sekmeyi aÃ§
    // TÄ±klanma simÃ¼lasyonu ile ilk sekmeyi aktif et
    const defaultTab = document.querySelector('.q-nav-item.active');
    if (defaultTab) {
        switchQualityTab('dashboard', defaultTab);
    }
}
// ModÃ¼lÃ¼ Kapat
function closeFullQuality() {
    document.getElementById('quality-fullscreen').style.display = 'none';
    // EÄer qusers ise (sadece kalite yetkisi varsa) logout yapmalÄ± veya uyarÄ± vermeli
    if(localStorage.getItem("sSportRole") === 'qusers') {
        logout();
    }
}
// Sekme DeÄiÅtirme
function switchQualityTab(tabName, element) {
    // Menu active class
    document.querySelectorAll('.q-nav-item').forEach(item => item.classList.remove('active'));
    // Element varsa onu aktif yap, yoksa varsayÄ±lanÄ± (dashboard) bulup aktif yap
    if (element) {
        element.classList.add('active');
    } else {
        document.querySelector(`.q-nav-item[onclick*="${tabName}"]`).classList.add('active');
    }
    
    // View active class
    document.querySelectorAll('.q-view-section').forEach(section => section.classList.remove('active'));
    document.getElementById(`view-${tabName}`).classList.add('active');
    // Veri YÃ¼kleme
    if (tabName === 'dashboard') loadQualityDashboard();
    else if (tabName === 'evaluations') fetchEvaluationsForAgent();
    // DÃZELTME: Feedback sekmesi aÃ§Ä±lÄ±rken Ã¶nce Feedback_Logs Ã§ekilmeli
    else if (tabName === 'feedback') {
        populateFeedbackFilters();
        refreshFeedbackData();
    }
    else if (tabName === 'training') loadTrainingData();
}
// --- DASHBOARD FONKSÄ°YONLARI ---
function populateMonthFilterFull() {
    const selectIds = ['q-dash-month']; // Sadece yeni filtre
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    selectIds.forEach(id => {
        const el = document.getElementById(id);
        if(!el) return;
        el.innerHTML = '';
        for (let i = 0; i < 6; i++) {
            let month = (currentMonth - i + 12) % 12;
            let year = currentYear - (currentMonth - i < 0 ? 1 : 0);
            const value = `${String(month + 1).padStart(2, '0')}.${year}`;
            const text = `${MONTH_NAMES[month]} ${year}`;
            const opt = document.createElement('option');
            opt.value = value; opt.textContent = text;
            if(i===0) opt.selected = true;
            el.appendChild(opt);
        }
    });
}
// YENÄ°: Dashboard Filtrelerini Doldurma
function populateDashboardFilters() {
    const groupSelect = document.getElementById('q-dash-group');
    const agentSelect = document.getElementById('q-dash-agent');
    if(!isAdminMode) {
        if(groupSelect) groupSelect.style.display = 'none';
        if(agentSelect) agentSelect.style.display = 'none';
        return;
    } else {
        if(groupSelect) groupSelect.style.display = 'block';
        if(agentSelect) agentSelect.style.display = 'block';
    }
    
    if(!groupSelect) return;
    
    const groups = [...new Set(adminUserList.map(u => u.group).filter(g => g))].sort();
    groupSelect.innerHTML = '<option value="all">TÃ¼m Gruplar</option>';
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g; opt.innerText = g;
        groupSelect.appendChild(opt);
    });
    // Ä°lk yÃ¼klemede tÃ¼m agentlarÄ± listele
    updateDashAgentList();
}
// YENÄ°: Dashboard Agent Listesini GÃ¼ncelleme
function updateDashAgentList() {
    const groupSelect = document.getElementById('q-dash-group');
    const agentSelect = document.getElementById('q-dash-agent');
    if(!agentSelect) return;
    const selectedGroup = groupSelect.value;
    agentSelect.innerHTML = '<option value="all">TÃ¼m Temsilciler</option>';
    
    let filteredUsers = adminUserList;
    if (selectedGroup !== 'all') {
        filteredUsers = adminUserList.filter(u => u.group === selectedGroup);
    }
    filteredUsers.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.name; 
        opt.innerText = u.name;
        agentSelect.appendChild(opt);
    });
    
    updateDashRingTitle();
    refreshQualityData();
}

// â Dashboard ring baÅlÄ±ÄÄ± + admin temsilci ortalamalarÄ±
function updateDashRingTitle() {
    const titleEl = document.getElementById('q-dash-ring-title') || document.getElementById('q-dash-ring-title'.replace('title','title'));
    // (id kesin: q-dash-ring-title)
    const tEl = document.getElementById('q-dash-ring-title');
    if(!tEl) return;

    if(!isAdminMode) {
        tEl.textContent = 'Puan Durumu';
        return;
    }

    const gSel = document.getElementById('q-dash-group');
    const aSel = document.getElementById('q-dash-agent');
    const g = gSel ? gSel.value : 'all';
    const a = aSel ? aSel.value : 'all';

    if(a && a !== 'all') {
        tEl.textContent = `${a} Puan Durumu`;
    } else if(g && g !== 'all') {
        tEl.textContent = `${g} TakÄ±m OrtalamasÄ±`;
    } else {
        tEl.textContent = 'Genel Puan OrtalamasÄ±';
    }
}

// Admin iÃ§in: temsilci ortalamalarÄ± listesini bas
function renderDashAgentScores(evals) {
    const box = document.getElementById('q-dash-agent-scores');
    if(!box) return;

    // Sadece admin + agent=all iken gÃ¶ster (yoksa gereksiz kalabalÄ±k)
    if(!isAdminMode) { box.style.display='none'; return; }

    const gSel = document.getElementById('q-dash-group');
    const aSel = document.getElementById('q-dash-agent');
    const g = gSel ? gSel.value : 'all';
    const a = aSel ? aSel.value : 'all';

    if(a && a !== 'all') { box.style.display='none'; return; }

    // evals -> agent bazlÄ± ortalama
    const byAgent = {};
    (evals || []).forEach(e => {
        const agent = e.agent || 'N/A';
        const group = e.group || '';
        const score = parseFloat(e.score) || 0;
        if(!byAgent[agent]) byAgent[agent] = { total:0, count:0, group: group };
        byAgent[agent].total += score;
        byAgent[agent].count += 1;
        // group boÅsa son gÃ¶rÃ¼leni yaz
        if(!byAgent[agent].group && group) byAgent[agent].group = group;
    });

    const rows = Object.keys(byAgent).map(name => {
        const o = byAgent[name];
        return { name, group: o.group || (g !== 'all' ? g : ''), avg: o.count ? (o.total/o.count) : 0, count:o.count };
    });

    // EÄer group seÃ§iliyse sadece o grubun kullanÄ±cÄ±larÄ± zaten geliyor; ama garanti olsun
    const filteredRows = (g && g !== 'all') ? rows.filter(r => (r.group || '') === g) : rows;

    // SÄ±rala: en dÃ¼ÅÃ¼k ortalama Ã¼stte (iyileÅtirme alanÄ±)
    filteredRows.sort((x,y)=> x.avg - y.avg);

    if(filteredRows.length === 0) { box.style.display='none'; return; }

    // Ä°lk 8 kiÅiyi gÃ¶ster
    const top = filteredRows.slice(0, 8);

    box.innerHTML = top.map(r => `
        <div class="das-item">
            <div class="das-left">
                <span class="das-name">${escapeHtml(r.name)}</span>
                ${r.group ? `<span class="das-group">${escapeHtml(r.group)}</span>` : ``}
            </div>
            <div class="das-score">${(r.avg||0).toFixed(1)}</div>
        </div>
    `).join('');

    box.style.display = 'grid';
}

// Detay alanÄ±nÄ± toleranslÄ± parse et
function safeParseDetails(details) {
    if(!details) return null;
    if(Array.isArray(details)) return details;
    if(typeof details === 'object') return details;
    if(typeof details === 'string') {
        const s = details.trim();
        if(!s) return null;
        // BazÄ± eski kayÄ±tlar Ã§ift tÄ±rnak kaÃ§Ä±ÅlÄ± gelebilir
        const tryList = [s, s.replace(/\"/g,'"'), s.replace(/'/g,'"')];
        for(const cand of tryList){
            try{
                const parsed = JSON.parse(cand);
                if(Array.isArray(parsed)) return parsed;
            }catch(e){}
        }
    }
    return null;
}

// â YENÄ°: Feedback (Geri Bildirimler) Filtrelerini Doldurma
function populateFeedbackFilters() {
    const groupSelect = document.getElementById('q-feedback-group');
    const agentSelect = document.getElementById('q-feedback-agent');
    if (!groupSelect || !agentSelect) return;

    if(!isAdminMode) {
        groupSelect.style.display = 'none';
        agentSelect.style.display = 'none';
        return;
    } else {
        groupSelect.style.display = 'block';
        agentSelect.style.display = 'block';
    }

    const groups = [...new Set(adminUserList.map(u => u.group).filter(g => g))].sort();
    groupSelect.innerHTML = '<option value="all">TÃ¼m Gruplar</option>';
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        groupSelect.appendChild(opt);
    });

    // Ä°lk yÃ¼klemede tÃ¼m agentlarÄ± listele
    updateFeedbackAgentList(false);
}

function updateFeedbackAgentList(shouldRefresh=true) {
    const groupSelect = document.getElementById('q-feedback-group');
    const agentSelect = document.getElementById('q-feedback-agent');
    if(!groupSelect || !agentSelect) return;

    const selectedGroup = groupSelect.value;

    // seÃ§ilen gruba gÃ¶re kullanÄ±cÄ±larÄ± filtrele
    const filteredUsers = adminUserList.filter(u => {
        if(!u || !u.username) return false;
        if(selectedGroup === 'all') return true;
        return u.group === selectedGroup;
    });

    const agents = filteredUsers
        .map(u => u.username)
        .filter(a => a)
        .sort((a,b) => a.localeCompare(b, 'tr'));

    agentSelect.innerHTML = '<option value="all">TÃ¼m Temsilciler</option>';
    agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        agentSelect.appendChild(opt);
    });

    if(shouldRefresh) refreshFeedbackData();
}

async function fetchEvaluationsForFeedback() {
    const groupSelect = document.getElementById('q-feedback-group');
    const agentSelect = document.getElementById('q-feedback-agent');

    let targetAgent = currentUser;
    let targetGroup = 'all';

    if (isAdminMode) {
        targetAgent = agentSelect ? agentSelect.value : 'all';
        targetGroup = groupSelect ? groupSelect.value : 'all';
    }

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
                action: 'fetchEvaluations',
                targetAgent: targetAgent,
                targetGroup: targetGroup,
                username: currentUser,
                token: getToken()
            })
        });
        const data = await response.json();
        if (data.result === "success") {
            allEvaluationsData = (data.evaluations || []).reverse();
        } else {
            allEvaluationsData = [];
        }
    } catch (e) {
        allEvaluationsData = [];
    }
}

async function refreshFeedbackData() {
    // Feedback ekranÄ± iÃ§in (admin filtrelerine gÃ¶re) deÄerlendirmeleri + loglarÄ± Ã§ek, sonra listeyi bas
    await fetchEvaluationsForFeedback();
    await fetchFeedbackLogs();
    loadFeedbackList();
}


function refreshQualityData() {
    loadQualityDashboard();
}
async function fetchEvaluationsForDashboard() {
    // Dashboard filtrelerine gÃ¶re deÄerlendirmeleri Ã§ek (admin ise seÃ§ilen grup/temsilciye gÃ¶re)
    const groupSelect = document.getElementById('q-dash-group');
    const agentSelect = document.getElementById('q-dash-agent');

    let targetAgent = currentUser;
    let targetGroup = 'all';

    if (isAdminMode) {
        targetAgent = agentSelect ? agentSelect.value : 'all';
        targetGroup = groupSelect ? groupSelect.value : 'all';
    }

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
                action: "fetchEvaluations",
                targetAgent: targetAgent,
                targetGroup: targetGroup,
                username: currentUser,
                token: getToken()
            })
        });
        const data = await response.json();
        if (data.result === "success") {
            allEvaluationsData = (data.evaluations || []).reverse();
        } else {
            allEvaluationsData = [];
        }
    } catch (e) {
        allEvaluationsData = [];
    }
}
function loadQualityDashboard() {
    // Verileri Ã§ek (silent mode), veri gelince grafikleri Ã§iz
    fetchEvaluationsForDashboard().then(() => {
        const monthSelect = document.getElementById('q-dash-month');
        const groupSelect = document.getElementById('q-dash-group');
        const agentSelect = document.getElementById('q-dash-agent');
        const selectedMonth = monthSelect ? monthSelect.value : '';
        const selectedGroup = groupSelect ? groupSelect.value : 'all';
        const selectedAgent = agentSelect ? agentSelect.value : 'all';
        
        let filtered = allEvaluationsData.filter(e => {
            const eDate = e.date.substring(3); // dd.MM.yyyy -> MM.yyyy
            const matchMonth = (eDate === selectedMonth);
            
            let matchGroup = true;
            let matchAgent = true;
            // Admin filtreleme mantÄ±ÄÄ±
            if (isAdminMode) {
                // EÄer veri iÃ§inde grup bilgisi varsa onu kullan, yoksa adminUserList'ten bakmak gerekir.
                if (selectedGroup !== 'all') {
                    if (e.group) {
                        matchGroup = (e.group === selectedGroup);
                    } else {
                        const user = adminUserList.find(u => u.name === e.agent);
                        matchGroup = (user && user.group === selectedGroup);
                    }
                }
                
                if (selectedAgent !== 'all' && e.agent !== selectedAgent) matchAgent = false;
            } else {
                // Admin deÄilse sadece kendi verisi
                if(e.agent !== currentUser) matchAgent = false;
            }
            // MANUEL kayÄ±tlarÄ± dashboard'da gÃ¶sterme
            const isManual = e.callId && String(e.callId).toUpperCase().startsWith('MANUEL-');
            return matchMonth && matchGroup && matchAgent && !isManual;
        });
        const total = filtered.reduce((acc, curr) => acc + (parseInt(curr.score)||0), 0);
        const count = filtered.length;
        const avg = count > 0 ? (total / count).toFixed(1) : 0;
        const targetHit = filtered.filter(e => e.score >= 90).length;
        const rate = count > 0 ? Math.round((targetHit / count) * 100) : 0;
        // UI GÃ¼ncelle
        document.getElementById('q-dash-score').innerText = avg;
        document.getElementById('q-dash-count').innerText = count;
        document.getElementById('q-dash-target').innerText = `%${rate}`;
        
        // Kanal bazli dashboard (Chat + TeleSatış)
        renderDashAgentScores(filtered);
        renderChannelDashboard(filtered, "chat");
        renderChannelDashboard(filtered, "tele");
    });
}

function normalizeQualityChannel(ch) {
    const v = (ch || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
    if (!v) return '';
    // Türkçe karakterleri sadeleştir
    const norm = v
        .replace(/ı/g, 'i')
        .replace(/ş/g, 's')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c');
    if (norm.includes('chat')) return 'chat';
    if (norm.includes('telesatis') || norm.includes('tele satis') || norm.includes('telesales') || norm.includes('tele')) return 'tele';
    return norm;
}

function renderChannelDashboard(allData, key) {
    const data = (allData || []).filter(e => normalizeQualityChannel(e.channel || e.platform) === key);

    const total = data.reduce((acc, curr) => acc + (parseInt(curr.score) || 0), 0);
    const count = data.length;
    const avg = count > 0 ? (total / count) : 0;
    const targetHit = data.filter(e => (parseFloat(e.score) || 0) >= 90).length;
    const rate = count > 0 ? Math.round((targetHit / count) * 100) : 0;

    const prefix = (key === 'chat') ? 'q-chat' : 'q-tele';
    const avgEl = document.getElementById(prefix + '-avg');
    const countEl = document.getElementById(prefix + '-count');
    const targetEl = document.getElementById(prefix + '-target');

    if (avgEl) avgEl.innerText = count > 0 ? avg.toFixed(1) : '-';
    if (countEl) countEl.innerText = count > 0 ? count : '-';
    if (targetEl) targetEl.innerText = count > 0 ? `%${rate}` : '-%';

    // Ring
    const ring = document.getElementById(prefix + '-ring');
    const ringText = document.getElementById(prefix + '-ring-text');
    let color = '#2e7d32';
    if (avg < 70) color = '#d32f2f';
    else if (avg < 85) color = '#ed6c02';
    const ratio = Math.max(0, Math.min(100, avg));
    if (ring) ring.style.background = `conic-gradient(${color} ${ratio}%, #eee ${ratio}%)`;
    if (ringText) ringText.innerText = count > 0 ? Math.round(avg) : '-';

    // Breakdown chart
    const canvasId = (key === 'chat') ? 'q-breakdown-chart-chat' : 'q-breakdown-chart-tele';
    renderDashboardChart(data, canvasId, key);
}

function renderDashboardChart(data, ctxId = "q-breakdown-chart", key = "main") {
    const ctx = document.getElementById(ctxId);
    if (!ctx) return;
    let chartRef = (key === "chat") ? dashboardChartChat : (key === "tele" ? dashboardChartTele : dashboardChart);
    if (chartRef) {
        chartRef.destroy();
    }
    const wrapTooltipTitle = (text, maxLen = 52) => {
        if (!text) return '';
        const words = String(text).split(/\s+/);
        const lines = [];
        let line = '';
        for (const w of words) {
            const next = line ? (line + ' ' + w) : w;
            if (next.length > maxLen && line) {
                lines.push(line);
                line = w;
            } else {
                line = next;
            }
        }
        if (line) lines.push(line);
        return lines;
    };
    // --- KRÄ°TER BAZLI ANALÄ°Z ---
    let questionStats = {};
    if (data.length > 0) {
        data.forEach(item => {
            try {
                // Detay verisini kontrol et, string ise parse et
                let details = safeParseDetails(item.details);
                
                if(Array.isArray(details)) {
                    details.forEach(d => {
                        let qFullText = d.q; // Tam metin
                        // Soruyu anahtar olarak kullan (kÄ±saltÄ±lmÄ±Å versiyonu)
                        let qShortText = qFullText.length > 25 ? qFullText.substring(0, 25) + '...' : qFullText;
                        
                        if (!questionStats[qShortText]) {
                            // fullText'i tutuyoruz ki tooltip'te gÃ¶sterebilelim
                            questionStats[qShortText] = { earned: 0, max: 0, fullText: qFullText }; 
                        }
                        
                        questionStats[qShortText].earned += parseInt(d.score || 0);
                        questionStats[qShortText].max += parseInt(d.max || 0);
                    });
                }
            } catch (e) {
                // JSON parse hatasÄ± veya eski veri formatÄ±
                console.log("Detay verisi iÅlenemedi", e);
            }
        });
    }
    // Ä°statistikleri diziye Ã§evirip baÅarÄ± oranÄ±na gÃ¶re sÄ±rala
    let statsArray = Object.keys(questionStats).map(key => {
        let s = questionStats[key];
        // BaÅarÄ± oranÄ± %
        let percentage = s.max > 0 ? (s.earned / s.max) * 100 : 0;
        return { label: key, fullLabel: s.fullText, value: percentage };
    });
    
    // BaÅarÄ± oranÄ±na gÃ¶re artan sÄ±ralama (En dÃ¼ÅÃ¼k baÅarÄ± en baÅta)
    statsArray.sort((a, b) => a.value - b.value);
    // EÄer detay kÄ±rÄ±lÄ±mÄ± yoksa (eski/boÅ kayÄ±tlar), temsilci ortalamasÄ±na gÃ¶re kÄ±rÄ±lÄ±m gÃ¶ster
    if (statsArray.length === 0) {
        const byAgent = {};
        data.forEach(it => {
            const a = it.agent || 'N/A';
            const s = parseFloat(it.score) || 0;
            if(!byAgent[a]) byAgent[a] = { total:0, count:0 };
            byAgent[a].total += s;
            byAgent[a].count += 1;
        });
        const aArr = Object.keys(byAgent).map(name => ({
            label: name.length > 25 ? name.substring(0,25) + '...' : name,
            fullLabel: name,
            value: byAgent[name].count ? (byAgent[name].total/byAgent[name].count) : 0
        }));
        aArr.sort((x,y)=> x.value - y.value);
        let topIssues = aArr.slice(0, 6);
        let chartLabels = topIssues.map(i => i.label);
        let chartData = topIssues.map(i => i.value.toFixed(1));

        	chartRef = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: chartLabels,
                datasets: [{
                    label: 'Ortalama Puan',
                    data: chartData,
                    backgroundColor: chartData.map(val => val < 70 ? 'rgba(211, 47, 47, 0.7)' : (val < 85 ? 'rgba(237, 108, 2, 0.7)' : 'rgba(46, 125, 50, 0.7)')),
                    borderColor: chartData.map(val => val < 70 ? '#b71c1c' : (val < 85 ? '#e65100' : '#1b5e20')),
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                scales: {
                    x: { beginAtZero: true, max: 100, grid: { color: '#f0f0f0' } },
                    y: { grid: { display: false } }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                if (context.length > 0) return wrapTooltipTitle(topIssues[context[0].dataIndex].fullLabel);
                                return '';
                            },
                            label: function(context) {
                                return context.parsed.x + ' Ortalama';
                            }
                        }
                    }
                }
            }
        });
        if (key === "chat") dashboardChartChat = chartRef; else if (key === "tele") dashboardChartTele = chartRef; else dashboardChart = chartRef;
        return;
    }

    // Sadece en dÃ¼ÅÃ¼k 6 kriteri gÃ¶ster
    let topIssues = statsArray.slice(0, 6);
 
    let chartLabels = topIssues.map(i => i.label);
    let chartData = topIssues.map(i => i.value.toFixed(1));
    	chartRef = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'BaÅarÄ± OranÄ± (%)',
                data: chartData,
                // Kriter BazlÄ± Renklendirme
                backgroundColor: chartData.map(val => val < 70 ? 'rgba(211, 47, 47, 0.7)' : (val < 90 ? 'rgba(237, 108, 2, 0.7)' : 'rgba(46, 125, 50, 0.7)')),
                borderColor: chartData.map(val => val < 70 ? '#b71c1c' : (val < 90 ? '#e65100' : '#1b5e20')),
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y', // Yatay Ã§ubuk grafik
            scales: {
                x: { 
                    beginAtZero: true, 
                    max: 100,
                    grid: { color: '#f0f0f0' }
                },
                y: {
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        // Tooltip baÅlÄ±ÄÄ±nda tam metni gÃ¶sterilmesi
                        title: function(context) {
                            if (context.length > 0) {
                                const dataIndex = context[0].dataIndex;
                                // fullLabel'i kullanarak tam metni dÃ¶ndÃ¼r
                                return wrapTooltipTitle(topIssues[dataIndex].fullLabel);
                            }
                            return '';
                        },
                        label: function(context) {
                            return context.parsed.x + '% BaÅarÄ±';
                        }
                    }
                }
            }
        }
    });
}
// --- EÄÄ°TÄ°M MODÃLÃ (YENÄ°) ---
function loadTrainingData() {
    const listEl = document.getElementById('training-list');
    listEl.innerHTML = '<div style="grid-column:1/-1; text-align:center;">YÃ¼kleniyor...</div>';
    
    fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "getTrainings", username: currentUser, token: getToken(), asAdmin: isAdminMode })
    }).then(r => r.json()).then(data => {
        listEl.innerHTML = '';
        if(data.result === 'success' && data.trainings.length > 0) {
            data.trainings.forEach(t => {
                let statusHtml = t.isCompleted 
                    ? `<button class="t-btn t-btn-done"><i class="fas fa-check"></i> TamamlandÄ±</button>`
                    : `<button class="t-btn t-btn-start" onclick="openTrainingLink('${t.id}', '${t.link}')">EÄitime Git</button>`;
                
                let docHtml = t.docLink && t.docLink !== 'N/A' 
                    ? `<a href="${t.docLink}" target="_blank" class="t-doc-link"><i class="fas fa-file-download"></i> DÃ¶kÃ¼manÄ± Ä°ndir</a>` 
                    : '';
                
                // GÃNCELLENMÄ°Å KART YAPISI (Tarih ve SÃ¼re Eklendi)
                listEl.innerHTML += `
                <div class="t-card">
                    <div class="t-card-header">
                        <span>${t.title}${isAdminMode ? ` <span style=\"font-weight:600; opacity:.8; font-size:.75rem\">(${t.target}${t.target==='Individual' && t.targetUser ? ' â¢ '+t.targetUser : ''})</span>` : ''}</span>
                        <span class="t-status-badge">Atanma: ${t.date}</span>
                    </div>
                    <div class="t-card-body">
                        ${t.desc}
                        ${docHtml}
                        <div style="margin-top:10px; display:flex; justify-content:space-between; font-size:0.8rem; color:#666; padding-top:10px; border-top:1px dashed #eee;">
                            <div><strong>SÃ¼re:</strong> ${t.duration || 'Belirtilmedi'}</div>
                            <div><strong>BaÅlangÄ±Ã§:</strong> ${t.startDate || 'N/A'} - <strong>BitiÅ:</strong> ${t.endDate || 'N/A'}</div>
                        </div>
                        <div style="font-size:0.8rem; color:#999; margin-top:5px;">Atayan: ${t.creator}</div>
                    </div>
                    <div class="t-card-footer">
                        ${statusHtml}
                    </div>
                </div>`;
            });
        } else {
            listEl.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#888;">AtanmÄ±Å eÄitim bulunmuyor.</div>';
        }
    });
}
function startTraining(id){
    fetch(SCRIPT_URL, {
        method:'POST',
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({ action: "startTraining", trainingId: id, username: currentUser, token: getToken() })
    }).then(r=>r.json()).catch(()=>{});
}

function openTrainingLink(id, link) {
    startTraining(id);
    if(link && link !== 'N/A') {
        window.open(link, '_blank');
    } else {
        Swal.fire('UyarÄ±', 'Bu eÄitim iÃ§in geÃ§erli bir link bulunmamaktadÄ±r.', 'warning');
    }
    
    // Linke tÄ±kladÄ±ktan sonra onay sor
    Swal.fire({
        title: 'EÄitimi TamamladÄ±n mÄ±?',
        text: "EÄitim iÃ§eriÄini inceleyip anladÄ±ysan onayla.",
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Evet, TamamladÄ±m',
        cancelButtonText: 'Daha Sonra'
    }).then((result) => {
        if (result.isConfirmed) {
            completeTraining(id);
        }
    });
}
function completeTraining(id) {
    fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "completeTraining", trainingId: id, username: currentUser, token: getToken() })
    }).then(r => r.json()).then(d => {
        if(d.result === 'success') {
            Swal.fire('Harika!', 'EÄitim tamamlandÄ± olarak iÅaretlendi.', 'success');
            loadTrainingData();
        } else {
            Swal.fire('Hata', d.message, 'error');
        }
    });
}
async function assignTrainingPopup() {
    const { value: formValues } = await Swal.fire({
        title: 'Yeni EÄitim & DÃ¶kÃ¼man Ata',
        html: `
            <div class="t-modal-grid">
                <input id="swal-t-title" class="swal2-input" placeholder="EÄitim BaÅlÄ±ÄÄ±" style="grid-column: 1 / 4;">
                <textarea id="swal-t-desc" class="swal2-textarea" style="height:100px; grid-column: 1 / 4;" placeholder="EÄitim aÃ§Ä±klamasÄ± veya talimatlar..."></textarea>
                <input id="swal-t-link" class="swal2-input" placeholder="Video/EÄitim Linki (URL)" style="grid-column: 1 / 4;">
                <input id="swal-t-doc" class="swal2-input" placeholder="DÃ¶kÃ¼man Linki (Drive/PDF URL) (Ä°steÄe BaÄlÄ±)" style="grid-column: 1 / 4;">
                <input type="date" id="swal-t-start" class="swal2-input" value="${new Date().toISOString().substring(0, 10)}">
                <input type="date" id="swal-t-end" class="swal2-input">
                <input id="swal-t-duration" class="swal2-input" placeholder="SÃ¼re (Ãrn: 20dk)">
            </div>
            <select id="swal-t-target" class="swal2-input" onchange="updateTrainingTarget(this.value)" style="margin-top:10px;">
                <option value="Genel">Herkese (TÃ¼m Ekip)</option>
                <option value="TelesatÄ±Å">TelesatÄ±Å Ekibi</option>
                <option value="Chat">Chat Ekibi</option>
                <option value="Individual">KiÅiye Ãzel</option>
            </select>
            <select id="swal-t-agent" class="swal2-input" style="display:none; width:100%;"></select>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Ata',
        didOpen: () => {
            window.updateTrainingTarget = function(val) {
                const agentSelect = document.getElementById('swal-t-agent');
                agentSelect.style.display = val === 'Individual' ? 'block' : 'none';
                if (val === 'Individual') {
                    agentSelect.innerHTML = adminUserList.map(u => `<option value="${u.name}">${u.name}</option>`).join('');
                }
            };
            updateTrainingTarget('Genel');
        },
        preConfirm: () => {
            const target = document.getElementById('swal-t-target').value;
            const agent = target === 'Individual' ? document.getElementById('swal-t-agent').value : '';
            if (!document.getElementById('swal-t-title').value || (!target && !agent)) {
                Swal.showValidationMessage('BaÅlÄ±k ve Atama AlanÄ± boÅ bÄ±rakÄ±lamaz');
                return false;
            }
            return {
                title: document.getElementById('swal-t-title').value,
                desc: document.getElementById('swal-t-desc').value,
                link: document.getElementById('swal-t-link').value,
                docLink: document.getElementById('swal-t-doc').value || 'N/A',
                target: target,
                targetAgent: agent, // KiÅiye Ã¶zel atama iÃ§in
                creator: currentUser,
                startDate: formatDateToDDMMYYYY(document.getElementById('swal-t-start').value), 
                endDate: formatDateToDDMMYYYY(document.getElementById('swal-t-end').value), 
                duration: document.getElementById('swal-t-duration').value 
            }
        }
    });
    if (formValues) {
        Swal.fire({title:'AtanÄ±yor...', didOpen:()=>Swal.showLoading()});
        fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "assignTraining", username: currentUser, token: getToken(), ...formValues })
        }).then(r=>r.json()).then(d=>{
            Swal.fire('BaÅarÄ±lÄ±', 'EÄitim atandÄ±.', 'success');
            loadTrainingData();
        });
    }
}
// --- FEEDBACK MODÃLÃ ---

// YENÄ° FONKSÄ°YON: Feedback_Logs'u Ã§ekmek iÃ§in
async function fetchFeedbackLogs() {
    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "fetchFeedbackLogs", username: currentUser, token: getToken() })
        });
        const data = await res.json();
        if (data.result === "success") {
            feedbackLogsData = data.feedbackLogs || [];
        } else {
            feedbackLogsData = [];
        }
    } catch (error) {
        console.error("Feedback Logs Ã§ekilirken hata oluÅtu:", error);
        feedbackLogsData = [];
    }
}

// YARDIMCI FONKSÄ°YON: DÃ¶nem bilgisini MM.YYYY formatÄ±nda dÃ¶ndÃ¼rÃ¼r
function formatPeriod(periodString) {
    if (!periodString || periodString === 'N/A') return 'N/A';
    
    // Zaten MM.YYYY formatÄ±ndaysa direkt dÃ¶ndÃ¼r
    if (periodString.match(/^\d{2}\.\d{4}$/)) {
        return periodString;
    }
    
    // EÄer uzun bir Date string'i ise (Ã¶r: Wed Oct 01 2025...) tarih nesnesine Ã§evir
    try {
        const date = new Date(periodString);
        if (!isNaN(date.getTime())) {
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${month}.${year}`;
        }
    } catch (e) {
        // Hata oluÅursa olduÄu gibi bÄ±rak veya N/A dÃ¶ndÃ¼r
        console.error("DÃ¶nem formatlama hatasÄ±:", e);
    }
    
    return periodString; // BaÅka formatta gelirse yine de olduÄu gibi dÃ¶ndÃ¼r
}

function loadFeedbackList() {
    const listEl = document.getElementById('feedback-list');
    listEl.innerHTML = '';
    
    // Admin butonunu gÃ¶ster/gizle
    const manualBtn = document.getElementById('manual-feedback-admin-btn');
    if(manualBtn) manualBtn.style.display = isAdminMode ? 'flex' : 'none';
    
    // YENÄ° FÄ°LTRELEME MANTIÄI: Sadece feedbackType 'Mail' olanlar VEYA callId 'MANUEL' olanlar listelenir.
    const feedbackItems = allEvaluationsData.filter(e => {
        // feedbackType kontrolÃ¼ (BÃ¼yÃ¼k/kÃ¼Ã§Ã¼k harf duyarlÄ±lÄ±ÄÄ±nÄ± ortadan kaldÄ±rÄ±rÄ±z)
        const isMailFeedback = e.feedbackType && e.feedbackType.toLowerCase() === 'mail';
        // Manuel kontrolÃ¼
        const isManualFeedback = e.callId && String(e.callId).toUpperCase().startsWith('MANUEL-');
        
        return isMailFeedback || isManualFeedback;
    });
    if(feedbackItems.length === 0) {
        listEl.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">GÃ¶rÃ¼ntÃ¼lenecek filtrelenmiÅ geri bildirim yok (Sadece Mail veya Manuel).</div>';
        return;
    }
    
    feedbackItems.forEach(e => {
        // GeliÅtirme: ÃaÄrÄ± Tarihi ve ID eklendi (GeliÅmiÅ Kart TasarÄ±mÄ±)
        const feedbackClass = e.feedbackType === 'SÃ¶zlÃ¼' ? '#2196f3' : (e.feedbackType === 'Mail' ? '#e65100' : (e.feedbackType === 'Bilgilendirme' ? '#0288d1' : (e.feedbackType === 'Feedback' ? '#2e7d32' : '#10b981')));
        
        // MANUEL CallID'den Ã¶n eki temizle
        const cleanCallId = String(e.callId).toUpperCase().startsWith('MANUEL-') ? String(e.callId).substring(7) : e.callId;
        
        // Konu/BaÅlÄ±k bilgisi 'details' alanÄ±ndan gelir (Manuel geri bildirim iÃ§in)
        // EÄer detay alanÄ± JSON ise (yani normal deÄerlendirme) veya boÅsa varsayÄ±lan metin kullan
        const isEvaluationDetail = String(e.details).startsWith('[');
        const feedbackTopic = isEvaluationDetail ? 'DeÄerlendirme Konusu' : (e.details || 'BelirtilmemiÅ');
        
        // DÃ¶nem, Kanal ve Tipi belirle (Manuel kayÄ±tlarda bu bilgileri Evaluations'tan deÄil, Feedback_Logs'tan Ã§ekiyoruz)
        const isManual = String(e.callId).toUpperCase().startsWith('MANUEL-');
        
        let period = e.period || e.date.substring(3);
        let channel = (e.channel && String(e.channel).trim()) ? String(e.channel).trim() : 'Yok';
        const infoType = e.feedbackType || 'Yok';

        // DÃZELTME MANTIÄI: EÄer kayÄ±t Manuel ise, detaylÄ± bilgiyi feedbackLogsData'dan Ã§ek.
        if (isManual) {
            // CallId'deki MANUEL- Ã¶n ekini atarak Feedback_Logs'taki Call_ID ile eÅleÅtirme
            const logRow = feedbackLogsData.find(x => String(x.callId) === String(cleanCallId));
            if (logRow) {
                // Apps Script'ten gelen period deÄerini formatla (Tarih Nesnesi/String olma ihtimaline karÅÄ±)
                period = formatPeriod(logRow.period) || period;
                channel = logRow.channel && logRow.channel !== 'N/A' ? logRow.channel : 'Yok';
            }
        }
        
        listEl.innerHTML += `
            <div class="feedback-card" style="border-left-color: ${feedbackClass};">
                <div class="feedback-header">
                    <div style="font-weight:bold; color:#0e1b42; font-size:1.1rem;">${e.agent}</div>
                    <div class="feedback-info-right">
                        <span><i class="fas fa-user-check"></i> DeÄerleyen: ${e.evaluator}</span>
                        <span><i class="fas fa-id-badge"></i> ÃaÄrÄ± ID: ${cleanCallId}</span>
                        <span><i class="fas fa-calendar-alt"></i> Tarih: ${e.callDate}</span>
                    </div>
                </div>
                <div class="feedback-body">
                    <div style="font-weight:bold; color:#333; margin-bottom:5px;">Konu/AÃ§Ä±klama: ${feedbackTopic}</div>
                    <div style="color:#555; line-height:1.5; font-size:0.95rem;">${e.feedback}</div>
                </div>
                <div class="feedback-footer">
                     <div style="display:flex; gap:10px; font-size:0.7rem; color:#666; font-weight:600; margin-right:10px;">
                        <span><i class="fas fa-calendar-week"></i> DÃ¶nem: ${period}</span>
                        <span><i class="fas fa-comment-alt"></i> Kanal: ${channel}</span>
                        <span><i class="fas fa-tag"></i> Tip: ${infoType}</span>
                     </div>
                     
            </div>`;
    });
}
// Adminler iÃ§in manuel geri bildirim ekleme (ÃaÄrÄ± dÄ±ÅÄ± konular iÃ§in)
async function addManualFeedbackPopup() {
    if (!isAdminMode) return;
    
    // Admin user listesi yoksa yÃ¼kle
    if (adminUserList.length === 0) {
        Swal.fire({ title: 'KullanÄ±cÄ± Listesi YÃ¼kleniyor...', didOpen: () => Swal.showLoading() });
        await fetchUserListForAdmin();
        Swal.close();
    }
    // DÃ¶nem filtre seÃ§eneklerini oluÅtur
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    let monthOptions = '';
    for (let i = 0; i < 6; i++) {
        let month = (currentMonth - i + 12) % 12;
        let year = currentYear - (currentMonth - i < 0 ? 1 : 0);
        const text = `${MONTH_NAMES[month]} ${year}`;
        const value = `${String(month + 1).padStart(2, '0')}.${year}`; // Backend'in beklediÄi MM.YYYY formatÄ±
        const isCurrent = (i === 0);
        monthOptions += `<option value="${value}" ${isCurrent ? 'selected' : ''}>${text}</option>`;
    }
    
    // YENÄ° HTML TASARIMI: Daha dÃ¼zenli ve etiketli form
    const newHtmlContent = `
        <div class="manual-feedback-form">
            <div class="form-group">
                <label for="manual-q-agent">Temsilci AdÄ± <span class="required">*</span></label>
                <select id="manual-q-agent" class="swal2-input"></select>
            </div>
            <div class="form-group">
                <label for="manual-q-topic">Konu / BaÅlÄ±k <span class="required">*</span></label>
                <input id="manual-q-topic" class="swal2-input" placeholder="Geri bildirim konusu (Ãrn: Yeni Kampanya Bilgilendirmesi)">
            </div>
            
            <div class="grid-2-cols">
                <div class="form-group">
                    <label for="manual-q-callid">ÃaÄrÄ±/EtkileÅim ID <span class="required">*</span></label>
                    <input id="manual-q-callid" class="swal2-input" placeholder="ID (Ãrn: 123456)">
                </div>
                <div class="form-group">
                    <label for="manual-q-date">Tarih <span class="required">*</span></label>
                    <input type="date" id="manual-q-date" class="swal2-input" value="${new Date().toISOString().substring(0, 10)}">
                </div>
            </div>
            <div class="grid-3-cols">
                <div class="form-group">
                    <label for="manual-q-channel">Kanal</label>
                    <select id="manual-q-channel" class="swal2-input">
                        <option value="Telefon">Telefon</option>
                        <option value="CanlÄ± Destek">CanlÄ± Destek</option>
                        <option value="E-posta">E-posta</option>
                        <option value="Sosyal Medya">Sosyal Medya</option>
                        <option value="Yok">Yok/DiÄer</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="manual-q-period">DÃ¶nem</label>
                    <select id="manual-q-period" class="swal2-input">${monthOptions}</select>
                </div>
                <div class="form-group">
                    <label for="manual-q-type">Tip</label>
                    <select id="manual-q-type" class="swal2-input">
                        <option value="Feedback">Feedback</option>
                        <option value="Bilgilendirme">Bilgilendirme</option>
                        <option value="SÃ¶zlÃ¼">SÃ¶zlÃ¼</option>
                        <option value="Mail">Mail</option>
                        <option value="Ãzel">Ãzel Konu</option>
                    </select>
                </div>
            </div>
            
            <div class="form-group">
                <label for="manual-q-feedback">Geri Bildirim DetaylarÄ± <span class="required">*</span></label>
                <textarea id="manual-q-feedback" class="swal2-textarea" placeholder="Buraya geri bildirimin detaylÄ± metnini giriniz..."></textarea>
            </div>
        </div>
        <style>
            /* Manuel Geri Bildirim Formu Stil Ä°yileÅtirmeleri */
            .manual-feedback-form {
                text-align: left;
                padding: 10px;
                background: #fcfcfc;
                border-radius: 8px;
                border: 1px solid #eee;
            }
            .form-group {
                margin-bottom: 12px;
            }
            .form-group label {
                font-size: 0.85rem;
                font-weight: 600;
                color: var(--primary);
                display: block;
                margin-bottom: 4px;
            }
            .grid-2-cols {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 15px;
            }
            .grid-3-cols {
                display: grid;
                grid-template-columns: 1fr 1fr 1fr;
                gap: 15px;
            }
            .required {
                color: var(--accent);
                font-size: 0.9rem;
            }
            /* Input/Select/Textarea stillerini genel swal2-input stilinden devraldÄ±k */
            .manual-feedback-form .swal2-input, .manual-feedback-form .swal2-textarea {
                width: 100% !important;
                box-sizing: border-box !important;
                margin: 0 !important;
                padding: 10px 12px !important;
                border: 1px solid #dcdcdc !important;
                border-radius: 6px !important;
                font-size: 0.95rem !important;
                transition: border-color 0.2s, box-shadow 0.2s;
            }
            .manual-feedback-form .swal2-input:focus, .manual-feedback-form .swal2-textarea:focus {
                border-color: var(--secondary) !important;
                box-shadow: 0 0 0 2px rgba(250, 187, 0, 0.2) !important;
            }
            .manual-feedback-form .swal2-textarea {
                min-height: 100px;
                resize: vertical;
            }
        </style>
    `;
    
    // ModalÄ± gÃ¶rÃ¼ntÃ¼deki gibi dÃ¼zenledik (Agent Select ve sade alanlar)
    const { value: formValues } = await Swal.fire({
        title: 'Manuel Geri Bildirim Yaz',
        html: newHtmlContent,
        width: '600px', // Modal geniÅliÄini artÄ±rdÄ±k
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-save"></i> Kaydet',
        didOpen: () => {
            const sel = document.getElementById('manual-q-agent');
            adminUserList.forEach(u => sel.innerHTML += `<option value="${u.name}">${u.name}</option>`);
        },
        preConfirm: () => {
            const agentName = document.getElementById('manual-q-agent').value;
            const topic = document.getElementById('manual-q-topic').value;
            const feedback = document.getElementById('manual-q-feedback').value;
            const feedbackType = document.getElementById('manual-q-type').value;
            
            // YENÄ° ALANLAR
            const channel = document.getElementById('manual-q-channel').value;
            const period = document.getElementById('manual-q-period').value; // MM.YYYY formatÄ±nda
            
            // YENÄ° ZORUNLU KONTROLLER
            const callId = document.getElementById('manual-q-callid').value.trim();
            const rawCallDate = document.getElementById('manual-q-date').value;
            const callDate = formatDateToDDMMYYYY(rawCallDate);
            if (!agentName || !feedback || !callId || !rawCallDate || !topic) { // Konu/BaÅlÄ±k da zorunlu yapÄ±ldÄ±
                 Swal.showValidationMessage('TÃ¼m (*) iÅaretli alanlar zorunludur!'); 
                 return false;
            }
            
            // Konu sadece baÅlÄ±k olarak gÃ¶nderiliyor. DÃ¶nem ve Kanal ayrÄ± alanlar olarak gÃ¶nderilecek.
            return {
                agentName,
                // Backend'de ayrÄ± loglama iÃ§in CallID'yi MANUEL ile baÅlatÄ±yoruz.
                callId: "MANUEL-" + callId, 
                callDate: callDate,
                score: 100, // Manuel olduÄu iÃ§in tam puan
                details: topic, // Sadece konuyu gÃ¶nderiyoruz
                feedback,
                feedbackType,
                agentGroup: "Genel", // Manuel olduÄu iÃ§in Genel Grup olarak kaydedilir.
                // ÃÃZÃM: Yeni alanlarÄ± ekliyoruz
                channel: channel,
                period: period
            };
        }
    });
    if (formValues) {
        // MÃKERRER KONTROL: AynÄ± temsilci + aynÄ± Call ID daha Ã¶nce kaydedildiyse uyar
        try {
            const normAgent = String(formValues.agentName || '').trim().toLowerCase();
            const normCallId = String(formValues.callId || '').trim();
            const isDup = Array.isArray(allEvaluationsData) && allEvaluationsData.some(e =>
                String(e.agent || e.agentName || '').trim().toLowerCase() === normAgent &&
                String(e.callId || '').trim() === normCallId
            );

            if (isDup) {
                const decision = await Swal.fire({
                    icon: 'warning',
                    title: 'MÃ¼kerrer Dinleme',
                    html: `<div style="text-align:left; line-height:1.4;">
                            <b>${formValues.agentName}</b> iÃ§in <b>Call ID: ${escapeHtml(formValues.callId)}</b> daha Ã¶nce kaydedilmiÅ gÃ¶rÃ¼nÃ¼yor.<br>
                            <span style="color:#666; font-size:0.9rem;">Yine de yeni kayÄ±t oluÅturmak istiyor musun?</span>
                           </div>`,
                    showCancelButton: true,
                    confirmButtonText: 'Evet, kaydet',
                    cancelButtonText: 'VazgeÃ§',
                    reverseButtons: true
                });
                if (!decision.isConfirmed) return;
            }
        } catch (e) {
            console.warn('Duplicate check failed', e);
        }

        Swal.fire({ title: 'Kaydediliyor...', didOpen: () => Swal.showLoading() });
        fetch(SCRIPT_URL, { 
            method: 'POST', 
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: "logEvaluation", username: currentUser, token: getToken(), ...formValues }) 
        })
        .then(r => r.json()).then(async d => {
            if (d.result === "success") { 
                Swal.fire({ icon: 'success', title: 'Kaydedildi', timer: 1500, showConfirmButton: false });
                // DÃZELTME: Hem evaluations hem de feedback logs gÃ¼ncellenmeli
                fetchEvaluationsForAgent(formValues.agentName);
                fetchFeedbackLogs().then(() => { loadFeedbackList(); });
            } else if (d.result === "duplicate") {
                const decision = await Swal.fire({
                    icon: 'warning',
                    title: 'MÃ¼kerrer Dinleme',
                    html: `<div style="text-align:left; line-height:1.4;">
                            <b>${formValues.agentName}</b> iÃ§in <b>Call ID: ${escapeHtml(formValues.callId)}</b> zaten var.<br>
                            <span style="color:#666; font-size:0.9rem;">Yine de yeni kayÄ±t oluÅturulsun mu?</span>
                           </div>`,
                    showCancelButton: true,
                    confirmButtonText: 'Evet, zorla kaydet',
                    cancelButtonText: 'VazgeÃ§',
                    reverseButtons: true
                });
                if (decision.isConfirmed) {
                    Swal.fire({ title: 'Kaydediliyor...', didOpen: () => Swal.showLoading() });
                    fetch(SCRIPT_URL, { 
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify({ action: "logEvaluation", username: currentUser, token: getToken(), force: true, ...formValues })
                    }).then(r2 => r2.json()).then(d2 => {
                        if (d2.result === "success") {
                            Swal.fire({ icon: 'success', title: 'Kaydedildi', timer: 1500, showConfirmButton: false });
                            fetchEvaluationsForAgent(formValues.agentName);
                            fetchFeedbackLogs().then(() => { loadFeedbackList(); });
                        } else {
                            Swal.fire('Hata', d2.message, 'error');
                        }
                    });
                }
            } else { 
                Swal.fire('Hata', d.message, 'error'); 
            }
        });
    }
}
async function fetchEvaluationsForAgent(forcedName, silent=false) {
    const listEl = document.getElementById('evaluations-list');
    if(!silent) listEl.innerHTML = 'YÃ¼kleniyor...';
    const groupSelect = document.getElementById('q-admin-group');
    const agentSelect = document.getElementById('q-admin-agent');
    
    let targetAgent = forcedName || currentUser;
    let targetGroup = 'all';
    
    if (isAdminMode && agentSelect) {
        targetAgent = forcedName || agentSelect.value;
        targetGroup = groupSelect ? groupSelect.value : 'all';
    }
    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST', headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "fetchEvaluations", targetAgent: targetAgent, targetGroup: targetGroup, username: currentUser, token: getToken() })
        });
        const data = await response.json();
        
        if (data.result === "success") {
            // En yeni en Ã¼stte olmasÄ± iÃ§in ters Ã§evir
            allEvaluationsData = data.evaluations.reverse();
            if(silent) return; // Silent mode ise burada bitir (veri yÃ¼klendi)
            listEl.innerHTML = '';
            
            // Sadece normal deÄerlendirmeleri filtrele ve gÃ¶ster
            const normalEvaluations = allEvaluationsData.filter(e => !String(e.callId).toUpperCase().startsWith('MANUEL-'));
            if (normalEvaluations.length === 0) { listEl.innerHTML = `<p style="text-align:center; color:#666;">KayÄ±t yok.</p>`; return; }
            
            normalEvaluations.forEach((evalItem, index) => {
                const scoreColor = evalItem.score >= 90 ? '#2e7d32' : (evalItem.score >= 70 ? '#ed6c02' : '#d32f2f');
                let editBtn = isAdminMode ? `<i class="fas fa-pen" style="font-size:1rem; color:#fabb00; cursor:pointer; margin-right:5px;" onclick="event.stopPropagation(); editEvaluation('${evalItem.callId}')"></i>` : '';
                let agentNameDisplay = (targetAgent === 'all' || targetAgent === targetGroup) ? `<span style="font-size:0.8rem; font-weight:bold; color:#555; background:#eee; padding:2px 6px; border-radius:4px; margin-left:10px;">${evalItem.agent}</span>` : '';
                
                // Detay HTML oluÅturma
                let detailHtml = '';
                try {
                    // JSON'Ä± iÅlerken olasÄ± hatalara karÅÄ± try-catch
                    const detailObj = JSON.parse(evalItem.details);
                    detailHtml = '<table style="width:100%; font-size:0.85rem; border-collapse:collapse; margin-top:10px;">';
                    if (Array.isArray(detailObj)) {
                        detailObj.forEach(item => {
                            let rowColor = item.score < item.max ? '#ffebee' : '#f9f9f9';
                            let noteDisplay = item.note ? `<br><em style="color: #d32f2f; font-size:0.8rem;">(Not: ${item.note})</em>` : '';
                            detailHtml += `<tr style="background:${rowColor}; border-bottom:1px solid #fff;">
                                <td style="padding:8px; border-radius:4px;">${item.q}${noteDisplay}</td>
                                <td style="padding:8px; font-weight:bold; text-align:right;">${item.score}/${item.max}</td>
                            </tr>`;
                        });
                    } else {
                        // JSON olmasÄ±na raÄmen array deÄilse (manuel notlar)
                        detailHtml = `<p style="white-space:pre-wrap; margin:0; font-size:0.9rem; background:#fff8e1; padding:10px; border-radius:4px;">${evalItem.details}</p>`;
                    }
                    detailHtml += '</table>';
                } catch (e) { 
                    // JSON parse hatasÄ± veya eski/manuel veri formatÄ±
                    detailHtml = `<p style="white-space:pre-wrap; margin:0; font-size:0.9rem; background:#fff8e1; padding:10px; border-radius:4px;">${evalItem.details}</p>`; 
                }
                
                // GeliÅtirme: ÃaÄrÄ± Tarihi ve Dinlenme Tarihi
                const callDateDisplay = evalItem.callDate && evalItem.callDate !== 'N/A' ? evalItem.callDate : 'N/A';
                const listenDateDisplay = evalItem.date || 'N/A';
                
                listEl.innerHTML += `
                <div class="evaluation-summary" id="eval-summary-${index}" style="border-left:4px solid ${scoreColor}; padding:15px; margin-bottom:10px; border-radius:8px; background:#fff; cursor:pointer;" onclick="toggleEvaluationDetail(${index})">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-weight:700; color:#2c3e50;">${evalItem.agent} ${agentNameDisplay}</div>
                            <!-- GeliÅtirme: ÃaÄrÄ± Tarihi ve Dinlenme Tarihi -->
                            <div class="eval-date-info">
                                <span><i class="fas fa-phone"></i> ÃaÄrÄ±: ${callDateDisplay}</span>
                                <span><i class="fas fa-headphones"></i> Dinlenme: ${listenDateDisplay}</span>
                            </div>
                            <div style="font-size:0.75rem; color:#999; margin-top:2px;">ID: ${evalItem.callId}</div>
                        </div>
                        <div style="text-align:right;">
                             ${editBtn} <span style="font-weight:800; font-size:1.6rem; color:${scoreColor};">${evalItem.score}</span>
                        </div>
                    </div>
                    <div class="evaluation-details-content" id="eval-details-${index}">
                        ${detailHtml}
                        <div style="margin-top:10px; background:#f8f9fa; padding:10px; border-radius:4px;">
                            <strong>Feedback:</strong> ${evalItem.feedback || '-'}
                        </div>
                    </div>
                </div>`;
            });
        }
    } catch(err) { if(!silent) listEl.innerHTML = `<p style="color:red; text-align:center;">Hata oluÅtu.</p>`; }
}
function updateAgentListBasedOnGroup() {
    const groupSelect = document.getElementById('q-admin-group');
    const agentSelect = document.getElementById('q-admin-agent');
    if(!groupSelect || !agentSelect) return;
    const selectedGroup = groupSelect.value;
    agentSelect.innerHTML = '';
    
    let filteredUsers = adminUserList;
    if (selectedGroup !== 'all') {
        filteredUsers = adminUserList.filter(u => u.group === selectedGroup);
        agentSelect.innerHTML = `<option value="all">-- TÃ¼m ${selectedGroup} Ekibi --</option>`;
    } else {
        agentSelect.innerHTML = `<option value="all">-- TÃ¼m Temsilciler --</option>`;
    }
    filteredUsers.forEach(u => { agentSelect.innerHTML += `<option value="${u.name}">${u.name}</option>`; });
    fetchEvaluationsForAgent();
}
function fetchUserListForAdmin() {
    return new Promise((resolve) => {
        fetch(SCRIPT_URL, {
            method: 'POST', headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "getUserList", username: currentUser, token: getToken() })
        }).then(response => response.json()).then(data => {
            if (data.result === "success") { adminUserList = data.users.filter(u => u.group !== 'YÃ¶netim'); resolve(adminUserList); } 
            else resolve([]);
        }).catch(err => resolve([]));
    });
}
function fetchCriteria(groupName) {
    return new Promise((resolve) => {
        fetch(SCRIPT_URL, {
            method: 'POST', headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "getCriteria", group: groupName, username: currentUser, token: getToken() })
        }).then(response => response.json()).then(data => {
            if (data.result === "success") resolve(data.criteria || []); else resolve([]);
        }).catch(err => resolve([]));
    });
}
function toggleEvaluationDetail(index) {
    const detailEl = document.getElementById(`eval-details-${index}`);
    if (detailEl.style.maxHeight && detailEl.style.maxHeight !== '0px') { detailEl.style.maxHeight = '0px'; detailEl.style.marginTop = '0'; } 
    else { detailEl.style.maxHeight = detailEl.scrollHeight + 500 + 'px'; detailEl.style.marginTop = '10px'; }
}
async function exportEvaluations() {
    if (!isAdminMode) return;
    const { isConfirmed } = await Swal.fire({ icon: 'question', title: 'Rapor Ä°ndirilsin mi?', showCancelButton: true, confirmButtonText: 'Ä°ndir' });
    if (!isConfirmed) return;
    Swal.fire({ title: 'HazÄ±rlanÄ±yor...', didOpen: () => Swal.showLoading() });
    
    const groupSelect = document.getElementById('q-admin-group');
    const agentSelect = document.getElementById('q-admin-agent');
    
    fetch(SCRIPT_URL, {
        method: 'POST', headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
            action: "exportEvaluations",
            targetAgent: agentSelect ? agentSelect.value : 'all',
            targetGroup: groupSelect ? groupSelect.value : 'all',
            username: currentUser, token: getToken()
        })
    }).then(r => r.json()).then(data => {
        if (data.result === "success" && data.csvData) {
            const blob = new Blob(["\ufeff" + data.csvData], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url); link.setAttribute("download", data.fileName);
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
            Swal.fire('BaÅarÄ±lÄ±', 'Rapor indirildi.', 'success');
        } else { Swal.fire('Hata', data.message || 'Veri alÄ±namadÄ±.', 'error'); }
    });
}
// --- EVALUATION POPUP & EDIT ---
async function logEvaluationPopup() {
    const agentSelect = document.getElementById('q-admin-agent');
    const agentName = agentSelect ? agentSelect.value : "";
    
    if (!agentName || agentName === 'all') { Swal.fire('UyarÄ±', 'LÃ¼tfen listeden bir temsilci seÃ§iniz.', 'warning'); return; }
    
    let agentGroup = 'Genel';
    const foundUser = adminUserList.find(u => u.name.toLowerCase() === agentName.toLowerCase());
    if (foundUser && foundUser.group) { agentGroup = foundUser.group; }
    
    const isChat = agentGroup.indexOf('Chat') > -1;
    const isTelesatis = agentGroup.indexOf('TelesatÄ±Å') > -1;
    if (isChat) agentGroup = 'Chat';
    
    Swal.fire({ title: 'HazÄ±rlanÄ±yor...', didOpen: () => Swal.showLoading() });
    let criteriaList = [];
    if(agentGroup && agentGroup !== 'Genel') { criteriaList = await fetchCriteria(agentGroup); } 
    Swal.close();
    
    const isCriteriaBased = criteriaList.length > 0;
    let criteriaFieldsHtml = '';
    
    if (isCriteriaBased) {
        criteriaFieldsHtml += `<div class="criteria-container">`;
        criteriaList.forEach((c, i) => {
            let pts = parseInt(c.points) || 0;
            if (pts === 0) return;
            // GeliÅtirme: Puan baÅlÄ±ÄÄ± Ã¼stÃ¼ne gelince tam metin gÃ¶sterilmesi iÃ§in title eklendi
            const fullText = escapeForJsString(c.text); 
            if (isChat) {
                let mPts = parseInt(c.mediumScore) || 0; let bPts = parseInt(c.badScore) || 0;
                criteriaFieldsHtml += `<div class="criteria-row" id="row-${i}" data-max-score="${pts}"><div class="criteria-header"><span title="${fullText}">${i+1}. ${c.text}</span><span style="font-size:0.8rem;">Max: ${pts}</span></div><div class="criteria-controls"><div class="eval-button-group"><button class="eval-button eval-good active" data-score="${pts}" onclick="setButtonScore(${i}, ${pts}, ${pts})">Ä°yi (${pts})</button>${mPts > 0 ? `<button class="eval-button eval-medium" data-score="${mPts}" onclick="setButtonScore(${i}, ${mPts}, ${pts})">Orta (${mPts})</button>` : ''}${bPts > 0 ? `<button class="eval-button eval-bad" data-score="${bPts}" onclick="setButtonScore(${i}, ${bPts}, ${pts})">KÃ¶tÃ¼ (${bPts})</button>` : ''}</div><span class="score-badge" id="badge-${i}" style="margin-top:8px; display:block; background:#2e7d32;">${pts}</span></div><input type="text" id="note-${i}" class="note-input" placeholder="Not..." style="display:none;"></div>`;
            } else if (isTelesatis) {
                 criteriaFieldsHtml += `<div class="criteria-row" id="row-${i}" data-max-score="${pts}"><div class="criteria-header"><span title="${fullText}">${i+1}. ${c.text}</span><span>Max: ${pts}</span></div><div class="criteria-controls" style="display:flex; align-items:center; gap:15px; background:#f9f9f9;"><input type="range" class="custom-range slider-input" id="slider-${i}" min="0" max="${pts}" value="${pts}" data-index="${i}" oninput="updateRowSliderScore(${i}, ${pts})" style="flex-grow:1;"><span class="score-badge" id="badge-${i}" style="background:#2e7d32;">${pts}</span></div><input type="text" id="note-${i}" class="note-input" placeholder="Not..." style="display:none;"></div>`;
            }
        });
        criteriaFieldsHtml += `</div>`;
    }
    
    // GÃNCELLENMÄ°Å MODAL: Call ID zorunlu yapÄ±ldÄ±
    const contentHtml = `
        <div class="eval-modal-wrapper">
            <div class="score-dashboard"><div><div style="font-size:0.9rem;">DeÄerlendirilen</div><div style="font-size:1.2rem; font-weight:bold; color:#fabb00;">${agentName}</div></div><div class="score-circle-outer" id="score-ring"><div class="score-circle-inner" id="live-score">${isCriteriaBased ? '100' : '100'}</div></div></div>
            <div class="eval-header-card"><div><label>Call ID <span style="color:red;">*</span></label><input id="eval-callid" class="swal2-input" style="height:35px; margin:0; width:100%;" placeholder="Call ID"></div><div><label>Tarih</label><input type="date" id="eval-calldate" class="swal2-input" style="height:35px; margin:0; width:100%;" value="${new Date().toISOString().substring(0, 10)}"></div></div>
            ${isCriteriaBased ? criteriaFieldsHtml : `<div style="padding:15px; border:1px dashed #ccc; text-align:center;"><label>Manuel Puan</label><br><input id="eval-manual-score" type="number" class="swal2-input" value="100" min="0" max="100" style="width:100px; text-align:center;"></div><textarea id="eval-details" class="swal2-textarea" placeholder="Detaylar..."></textarea>`}
            <div style="margin-top:15px; padding:10px; background:#fafafa; border:1px solid #eee;"><label>Geri Bildirim Tipi</label><select id="feedback-type" class="swal2-input" style="width:100%; height:40px; margin:0;"><option value="Yok" selected>Yok</option><option value="SÃ¶zlÃ¼">SÃ¶zlÃ¼</option><option value="Mail">Mail</option></select></div>
            <div style="margin-top:15px;"><label>Genel Geri Bildirim</label><textarea id="eval-feedback" class="swal2-textarea" style="margin-top:5px; height:80px;"></textarea></div>
        </div>`;
    
    const { value: formValues } = await Swal.fire({
        html: contentHtml,
        width: '600px',
        showCancelButton: true,
        confirmButtonText: ' ð¾  Kaydet',
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => { 
            if (isTelesatis) window.recalcTotalSliderScore(); 
            else if (isChat) window.recalcTotalScore(); 
        },
        preConfirm: () => {
            const callId = document.getElementById('eval-callid').value.trim();
            if (!callId) {
                Swal.showValidationMessage('Call ID alanÄ± boÅ bÄ±rakÄ±lamaz!');
                return false;
            }
            
            const callDateRaw = document.getElementById('eval-calldate').value;
            const dateParts = callDateRaw.split('-');
            const formattedCallDate = dateParts.length === 3 ? `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}` : callDateRaw;
            
            if (isCriteriaBased) {
                let total = 0; let detailsArr = [];
                for (let i = 0; i < criteriaList.length; i++) {
                    const c = criteriaList[i]; if (parseInt(c.points) === 0) continue;
                    let val = 0; let note = document.getElementById(`note-${i}`).value;
                    if (isChat) val = parseInt(document.getElementById(`badge-${i}`).innerText) || 0;
                    else if (isTelesatis) val = parseInt(document.getElementById(`slider-${i}`).value) || 0;
                    total += val; detailsArr.push({ q: c.text, max: parseInt(c.points), score: val, note: note });
                }
                return { agentName, agentGroup, callId, callDate: formattedCallDate, score: total, details: JSON.stringify(detailsArr), feedback: document.getElementById('eval-feedback').value, feedbackType: document.getElementById('feedback-type').value };
            } else {
                return { agentName, agentGroup, callId, callDate: formattedCallDate, score: parseInt(document.getElementById('eval-manual-score').value), details: document.getElementById('eval-details').value, feedback: document.getElementById('feedback-type').value };
            }
        }
    });
    if (formValues) {
        Swal.fire({ title: 'Kaydediliyor...', didOpen: () => Swal.showLoading() });
        fetch(SCRIPT_URL, { 
            method: 'POST', 
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: "logEvaluation", username: currentUser, token: getToken(), ...formValues }) 
        })
        .then(r => r.json()).then(d => {
            if (d.result === "success") { 
                Swal.fire({ icon: 'success', title: 'Kaydedildi', timer: 1500, showConfirmButton: false });
                // DÃZELTME: Hem evaluations hem de feedback logs gÃ¼ncellenmeli
                fetchEvaluationsForAgent(formValues.agentName);
                fetchFeedbackLogs().then(() => {
                    loadFeedbackList();
                });
            } else { 
                Swal.fire('Hata', d.message, 'error'); 
            }
        });
    }
}
async function editEvaluation(targetCallId) {
    const evalData = allEvaluationsData.find(item => String(item.callId).trim() === String(targetCallId).trim());
    if (!evalData) { Swal.fire('Hata', 'KayÄ±t bulunamadÄ±.', 'error'); return; }
    
    const agentName = evalData.agent;
    const agentGroupRaw = evalData.group || 'Genel';
    const isChat = agentGroupRaw.indexOf('Chat') > -1;
    const isTelesatis = agentGroupRaw.indexOf('TelesatÄ±Å') > -1;
    let agentGroup = isChat ? 'Chat' : (isTelesatis ? 'TelesatÄ±Å' : 'Genel');
    
    Swal.fire({ title: 'Ä°nceleniyor...', didOpen: () => Swal.showLoading() });
    let criteriaList = [];
    if(agentGroup && agentGroup !== 'Genel') criteriaList = await fetchCriteria(agentGroup);
    Swal.close();
    
    const isCriteriaBased = criteriaList.length > 0;
    let oldDetails = []; try { oldDetails = JSON.parse(evalData.details || "[]"); } catch(e) { oldDetails = []; }
    
    // GÃNCELLENMÄ°Å MODAL: Call ID gÃ¶steriliyor
    let contentHtml = `<div class="eval-modal-wrapper" style="border-top:5px solid #1976d2;"><div class="score-dashboard"><div><div style="font-size:0.9rem;">DÃZENLENEN</div><div style="font-size:1.2rem; font-weight:bold; color:#1976d2;">${agentName}</div></div><div class="score-circle-outer" id="score-ring"><div class="score-circle-inner" id="live-score">${evalData.score}</div></div></div><div class="eval-header-card"><div><label>Call ID</label><input id="eval-callid" class="swal2-input" value="${evalData.callId}" readonly style="background:#eee; height:35px; width:100%;"></div></div>`;
    
    if (isCriteriaBased) {
        contentHtml += `<div class="criteria-container">`;
        criteriaList.forEach((c, i) => {
            let pts = parseInt(c.points) || 0; if(pts===0) return;
            let mPts = parseInt(c.mediumScore) || 0; let bPts = parseInt(c.badScore) || 0;
            let oldItem = oldDetails.find(d => d.q === c.text) || (oldDetails[i] ? oldDetails[i] : {score:pts, note:''});
            let cVal = parseInt(oldItem.score); let cNote = oldItem.note || '';
            
            // GeliÅtirme: Puan baÅlÄ±ÄÄ± Ã¼stÃ¼ne gelince tam metin gÃ¶sterilmesi iÃ§in title eklendi
            const fullText = escapeForJsString(c.text); 
            if (isChat) {
                let gAct = cVal === pts ? 'active' : ''; let mAct = (cVal===mPts && mPts!==0) ? 'active' : ''; let bAct = (cVal===bPts && bPts!==0) ? 'active' : '';
                if(cVal===0 && bPts===0) bAct = 'active'; else if (cVal===0 && bPts>0) { gAct=''; mAct=''; bAct=''; }
                contentHtml += `<div class="criteria-row" id="row-${i}" data-max-score="${pts}"><div class="criteria-header"><span title="${fullText}">${i+1}. ${c.text}</span><span>Max: ${pts}</span></div><div class="criteria-controls"><div class="eval-button-group"><button class="eval-button eval-good ${gAct}" data-score="${pts}" onclick="setButtonScore(${i}, ${pts}, ${pts})">Ä°yi</button>${mPts>0?`<button class="eval-button eval-medium ${mAct}" data-score="${mPts}" onclick="setButtonScore(${i}, ${mPts}, ${pts})">Orta</button>`:''}${bPts>0?`<button class="eval-button eval-bad ${bAct}" data-score="${bPts}" onclick="setButtonScore(${i}, ${bPts}, ${pts})">KÃ¶tÃ¼</button>`:''}</div><span class="score-badge" id="badge-${i}">${cVal}</span></div><input type="text" id="note-${i}" class="note-input" value="${cNote}" style="display:${cVal<pts?'block':'none'}"></div>`;
            } else if (isTelesatis) {
                contentHtml += `<div class="criteria-row" id="row-${i}" data-max-score="${pts}"><div class="criteria-header"><span title="${fullText}">${i+1}. ${c.text}</span><span>Max: ${pts}</span></div><div class="criteria-controls" style="display:flex; background:#f9f9f9;"><input type="range" class="custom-range slider-input" id="slider-${i}" min="0" max="${pts}" value="${cVal}" data-index="${i}" oninput="updateRowSliderScore(${i}, ${pts})" style="flex-grow:1;"><span class="score-badge" id="badge-${i}">${cVal}</span></div><input type="text" id="note-${i}" class="note-input" value="${cNote}" style="display:${cVal<pts?'block':'none'}"></div>`;
            }
        });
        contentHtml += `</div>`;
    } else {
        contentHtml += `<div style="padding:15px; border:1px dashed #ccc; text-align:center;"><label>Manuel Puan</label><br><input id="eval-manual-score" type="number" class="swal2-input" value="${evalData.score}" min="0" max="100" style="width:100px;"></div><textarea id="eval-details" class="swal2-textarea">${typeof evalData.details==='string'?evalData.details:''}</textarea>`;
    }
    contentHtml += `<div><label>Revize Feedback</label><textarea id="eval-feedback" class="swal2-textarea">${evalData.feedback||''}</textarea></div></div>`;
    
    const { value: formValues } = await Swal.fire({
        html: contentHtml,
        width: '600px',
        showCancelButton: true,
        confirmButtonText: ' ð¾  GÃ¼ncelle',
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => { if (isTelesatis) window.recalcTotalSliderScore(); else if (isChat) window.recalcTotalScore(); },
        preConfirm: () => {
            const callId = document.getElementById('eval-callid').value;
            const feedback = document.getElementById('eval-feedback').value;
            if (isCriteriaBased) {
                let total = 0; let detailsArr = [];
                for (let i = 0; i < criteriaList.length; i++) {
                    const c = criteriaList[i]; if (parseInt(c.points) === 0) continue;
                    let val = 0; let note = document.getElementById(`note-${i}`).value;
                    if (isChat) val = parseInt(document.getElementById(`badge-${i}`).innerText) || 0;
                    else if (isTelesatis) val = parseInt(document.getElementById(`slider-${i}`).value) || 0;
                    else val = parseInt(c.points);
                    total += val; detailsArr.push({ q: c.text, max: parseInt(c.points), score: val, note: note });
                }
                return { agentName, callId, score: total, details: JSON.stringify(detailsArr), feedback };
            } else {
                return { agentName, callId, score: parseInt(document.getElementById('eval-manual-score').value), details: document.getElementById('eval-details').value, feedback };
            }
        }
    });
    if (formValues) {
        Swal.fire({ title: 'GÃ¼ncelleniyor...', didOpen: () => Swal.showLoading() });
        fetch(SCRIPT_URL, { 
            method: 'POST', 
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: "updateEvaluation", username: currentUser, token: getToken(), ...formValues }) 
        })
        .then(r => r.json()).then(d => {
            if (d.result === "success") { 
                Swal.fire({ icon: 'success', title: 'GÃ¼ncellendi', timer: 1500, showConfirmButton: false }); 
                // DÃZELTME: GÃ¼ncelleme sonrasÄ± hem evaluations hem de feedback logs gÃ¼ncellenmeli
                fetchEvaluationsForAgent(agentName);
                fetchFeedbackLogs().then(() => {
                    loadFeedbackList();
                });
            } 
            else { Swal.fire('Hata', d.message, 'error'); }
        });
    }
}

/* =========================================================
   ANA SAYFA + TEKNÄ°K + TELESATIÅ (FULLSCREEN) GÃNCELLEMESÄ°
   ========================================================= */

const TELESales_OFFERS_FALLBACK = [{"offer": "YILLIK - 1299 TL", "segment": "WÄ°NBACK", "description": "KullanÄ±cÄ± daha Ã¶nce aylÄ±k ya da yÄ±llÄ±k herhangi bir paket kullanmÄ±Å, ardÄ±ndan paket sonlanmÄ±Å ve Åu anda aktif paketi olmayan kullanÄ±cÄ±larÄ± aradÄ±ÄÄ±mÄ±z bir data", "note": "KullanÄ±cÄ±nÄ±n izleme geÃ§miÅi olabilir."}, {"offer": "AYLIK  - 6 AY 109 TL", "segment": "WÄ°NBACK", "description": "KullanÄ±cÄ± daha Ã¶nce aylÄ±k ya da yÄ±llÄ±k herhangi bir paket kullanmÄ±Å, ardÄ±ndan paket sonlanmÄ±Å ve Åu anda aktif paketi olmayan kullanÄ±cÄ±larÄ± aradÄ±ÄÄ±mÄ±z bir data", "note": "KullanÄ±cÄ±nÄ±n izleme geÃ§miÅi olabilir."}, {"offer": "YILLIK - 1399 TL", "segment": "CANCELLÄ°NG", "description": "AboneliÄinde iptal talebinde bulunmuÅ, paket sÃ¼resi bitimine kadar eriÅime devam eden, geri kazanÄ±m iÃ§in aradÄ±ÄÄ±mÄ±z bir data", "note": "KullanÄ±cÄ±nÄ±n izleme geÃ§miÅi olabilir. Ä°ndirim oranÄ± yÃ¼ksek + KullanÄ±cÄ±nÄ±n bir iptal nedeni olabilir"}, {"offer": "AYLIK  - 6 AY 119 TL", "segment": "CANCELLÄ°NG", "description": "AboneliÄinde iptal talebinde bulunmuÅ, paket sÃ¼resi bitimine kadar eriÅime devam eden, geri kazanÄ±m iÃ§in aradÄ±ÄÄ±mÄ±z bir data", "note": "KullanÄ±cÄ±nÄ±n izleme geÃ§miÅi olabilir. Ä°ndirim oranÄ± yÃ¼ksek + KullanÄ±cÄ±nÄ±n bir iptal nedeni olabilir"}, {"offer": "YILLIK - 1499 TL", "segment": "ACTÄ°VE GRACE", "description": "Paket yenileme sÃ¼recine giren fakat Ã¼cret alÄ±namadÄ±ÄÄ± iÃ§in paketi yenilenemeyen kullanÄ±cÄ±larÄ± aradÄ±ÄÄ±mÄ±z bir data", "note": "Paket yenileme sÃ¼recinden bir Ã¶deme sorunu oluÅtuÄunu bu nedenle aboneliÄinin yenilenmediÄini, kullanÄ±cÄ±ya hem bu sorunu Ã§Ã¶zmek hem de indirimli fiyatlar Ã¼zerinden yardÄ±mcÄ± olmak +Ä°Ã§erik"}, {"offer": "AYLIK  - 6 AY 109 TL", "segment": "ACTÄ°VE GRACE", "description": "Paket yenileme sÃ¼recine giren fakat Ã¼cret alÄ±namadÄ±ÄÄ± iÃ§in paketi yenilenemeyen kullanÄ±cÄ±larÄ± aradÄ±ÄÄ±mÄ±z bir data", "note": "Paket yenileme sÃ¼recinden bir Ã¶deme sorunu oluÅtuÄunu bu nedenle aboneliÄinin yenilenmediÄini, kullanÄ±cÄ±ya hem bu sorunu Ã§Ã¶zmek hem de indirimli fiyatlar Ã¼zerinden yardÄ±mcÄ± olmak +Ä°Ã§erik"}, {"offer": "YILLIK - 1499 TL", "segment": "INBOUND", "description": "Inbound Ã¼zerinden gelen satÄ±n alma talepleri ya da satÄ±Åa ikna edilen kullanÄ±cÄ±lar iÃ§in sunulan teklif", "note": ""}, {"offer": "AYLIK - 6 AY 139,5 TL", "segment": "INBOUND", "description": "Inbound Ã¼zerinden gelen satÄ±n alma talepleri ya da satÄ±Åa ikna edilen kullanÄ±cÄ±lar iÃ§in sunulan teklif", "note": ""}];
const SPORTS_RIGHTS_FALLBACK = [{"item": "Euroleague maÃ§larÄ± ve stÃ¼dyo programlarÄ±", "period": "2025-2026 / 2026- 2027 / 2027-2028 / 2028-2029", "note": ""}, {"item": "Bundesliga", "period": "2025-2026 / 2026- 2027 / 2027-2028 / 2028-2029", "note": ""}, {"item": "Bundesliga 2", "period": "2025-2026 / 2026- 2027 / 2027-2028 / 2028-2029", "note": ""}, {"item": "Ä°spanya LaLiga Ã¶nemli maÃ§larÄ±", "period": "2025 - 2026 / 2026 - 2027", "note": ""}, {"item": "LaLiga 2 Ã¶nemli maÃ§larÄ±", "period": "2025 - 2026 / 2026 - 2027", "note": ""}, {"item": "Ä°talya Serie A Ã¶nemli maÃ§larÄ±", "period": "2025 - 2026 / 2026 - 2027", "note": ""}, {"item": "Portekiz Liga Portugal Ã¶nemli maÃ§larÄ±", "period": "2025 - 2026", "note": ""}, {"item": "Suudi Arabistan Pro Lig Ã¶nemli maÃ§larÄ±", "period": "2025-2026 / 2026- 2027 / 2027-2028 / 2028-2029", "note": ""}, {"item": "Hollanda Ligi", "period": "2025-2026 / 2026- 2027 / 2027-2028 / 2028-2029", "note": ""}, {"item": "Ä°skoÃ§ya Premiership Ã¶nemli maÃ§larÄ±", "period": "2025 - 2026 / 2026 - 2027", "note": ""}, {"item": "NCAA Amerikan Futbol", "period": "2025 - 2026 / 2026 - 2027", "note": ""}, {"item": "NCAA Basketbol", "period": "2025 - 2026 / 2026 - 2027", "note": ""}, {"item": "NFL", "period": "2025 - 2026", "note": ""}, {"item": "NBA", "period": "2025-2026 / 2026- 2027 / 2027-2028 / 2028-2029", "note": ""}, {"item": "EuroCup", "period": "2025-2026 / 2026- 2027 / 2027-2028 / 2028-2029", "note": ""}, {"item": "Yunanistan Basketbol Ligi Ã¶nemli maÃ§larÄ±", "period": "2025 - 2026 Sezon belirsiz", "note": ""}, {"item": "NCAA", "period": "2025 - 2026 / 2026 - 2027", "note": ""}, {"item": "Libertadores KupasÄ±", "period": "2027, 2028, 2029, 2030 (4 seasons)", "note": ""}, {"item": "Copa Sudamericana", "period": "2027, 2028, 2029, 2030 (4 seasons)", "note": ""}, {"item": "WRC", "period": "2025", "note": "2026 da alÄ±nabilir net deÄil"}, {"item": "Nascar", "period": "2025 - 2026 - 2027 - 2028 ve 2029", "note": ""}, {"item": "IndyCar", "period": "2025 - 2026 - 2027", "note": ""}, {"item": "MotoGP - Moto2 - Moto3", "period": "2025 - 2026 - 2027", "note": ""}, {"item": "ATP Tenis TurnuvalarÄ± Ã¶nemli maÃ§lar", "period": "2025 - 2026 - 2027 and 2028", "note": ""}, {"item": "Wimbledon Tenis Ã¶nemli maÃ§lar", "period": "2025 - 2026 - 2027", "note": ""}, {"item": "UFC DÃ¶vÃ¼Å Gecesi yayÄ±nlarÄ±", "period": "2027 sonuna kadar bizde", "note": ""}, {"item": "Oktagon", "period": "2025", "note": ""}, {"item": "PFL MMA", "period": "2025", "note": ""}, {"item": "Cage Warriors Boks MaÃ§larÄ±", "period": "2025", "note": ""}, {"item": "BKFC", "period": "KaldÄ±rÄ±ldÄ±", "note": ""}];

function setActiveFilterButton(btn){
    try{
        document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
        if(btn) btn.classList.add('active');
    }catch(e){}
}

function showHomeScreen(){
    const home = document.getElementById('home-screen');
    const grid = document.getElementById('cardGrid');
    const empty = document.getElementById('emptyMessage');
    if (home) home.style.display = 'block';
    if (grid) grid.style.display = 'none';
    if (empty) empty.style.display = 'none';
    renderHomePanels();
}

function hideHomeScreen(){
    const home = document.getElementById('home-screen');
    if (home) home.style.display = 'none';
    const grid = document.getElementById('cardGrid');
    if (grid) grid.style.display = 'grid';
}

function renderHomePanels(){
    // --- BUGÃN NELER VAR? (YayÄ±n AkÄ±ÅÄ± / bugÃ¼nÃ¼n maÃ§larÄ±) ---
    const todayEl = document.getElementById('home-today');
    if(todayEl){
        todayEl.innerHTML = '<div class="home-mini-item">YayÄ±n akÄ±ÅÄ± yÃ¼kleniyor...</div>';
        (async()=>{
            try{
                const items = await fetchBroadcastFlow();
               const d = new Date();
const todayISO = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;


                const toISO = (val)=>{
                    const s = String(val||'').trim();
                    if(!s) return '';
                    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                    // dd.MM.yyyy
                    const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
                    if(m) return `${m[3]}-${m[2]}-${m[1]}`;
                    return '';
                };

                const todays = (items||[]).filter(it=>{
                    const iso = toISO(it.dateISO || it.date);
                    if(iso !== todayISO) return false;

                    // Saati geÃ§en karÅÄ±laÅmalar gÃ¶rÃ¼nmesin
                    const now = Date.now();
                    const se = Number(it.startEpoch || 0);
                    if(se) return se > now;
                    const t = String(it.time || '').trim();
                    const m = t.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
                    if(!m) return true; // saat formatÄ± yoksa gÃ¶ster
                    const hh = parseInt(m[1],10), mm = parseInt(m[2],10), ss = parseInt(m[3]||'0',10);
                    const dt = new Date();
                    dt.setHours(hh,mm,ss,0);
                    return dt.getTime() > now;
                });

                if(!todays.length){
                    todayEl.innerHTML = '<div class="home-mini-item">BugÃ¼n iÃ§in yayÄ±n akÄ±ÅÄ± kaydÄ± bulunamadÄ±.</div>';
                }else{
                    const shown = todays.slice(0,4);
                    todayEl.innerHTML = shown.map(it=>{
                        const time = escapeHtml(it.time || '');
                        const title = escapeHtml(it.match || it.title || it.event || '');
                        const ch = escapeHtml(it.channel || it.platform || '');
                        const league = escapeHtml(it.league || it.category || '');
                        const spk = escapeHtml(it.spiker || it.spikers || it.commentator || it.commentators || '');
                        return `
                          <div class="home-mini-item">
                            <div class="home-mini-date">${time}${league?` â¢ ${league}`:''}${ch?` â¢ ${ch}`:''}</div>
                            <div class="home-mini-title">${title || 'MaÃ§'}</div>
                            ${spk ? `<div class="home-mini-desc" style="margin-top:4px;color:#555">ð ${spk}</div>` : ''}
                          </div>
                        `;
                    }).join('') + (todays.length>shown.length ? `<div style="color:#666;font-size:.9rem;margin-top:6px">+${todays.length-shown.length} maÃ§ dahaâ¦</div>` : '');
                }


                // kartÄ± tÄ±klayÄ±nca yayÄ±n akÄ±ÅÄ±na git
                const card = todayEl.closest('.home-card');
                if(card){
                    card.classList.add('clickable');
                    card.onclick = ()=>openBroadcastFlow();
                }
            }catch(e){
                todayEl.innerHTML = '<div class="home-mini-item">YayÄ±n akÄ±ÅÄ± alÄ±namadÄ±.</div>';
            }
        })();
    }

    // --- DUYURULAR (son 3 duyuru) ---
    const annEl = document.getElementById('home-ann');
    if(annEl){
        const latest = (newsData || []).slice(0,3);
        if(latest.length===0){
            annEl.innerHTML = '<div class="home-mini-item">HenÃ¼z duyuru yok.</div>';
        }else{
            annEl.innerHTML = latest.map(n=>`
                <div class="home-mini-item">
                  <div class="home-mini-date">${escapeHtml(n.date||'')}</div>
                  <div class="home-mini-title">${escapeHtml(n.title||'')}</div>
                  <div class="home-mini-desc">${escapeHtml(String(n.desc||'')).slice(0,160)}${(n.desc||'').length>160?'...':''}</div>
                </div>
            `).join('');
        }
        const card = annEl.closest('.home-card');
        if(card){
            card.classList.add('clickable');
            card.onclick = ()=>openNews();
        }
    }

    // --- GÃNÃN SÃZÃ (HomeBlocks -> e-tabla) ---
    const quoteEl = document.getElementById('home-quote');
    if(quoteEl){
        const q = String((homeBlocks && homeBlocks.quote && homeBlocks.quote.content) ? homeBlocks.quote.content : (localStorage.getItem('homeQuote')||'')).trim();
        quoteEl.innerHTML = q ? escapeHtml(q) : '<span style="color:#999">BugÃ¼n iÃ§in bir sÃ¶z eklenmemiÅ.</span>';
    }

    // Admin: edit butonlarÄ±nÄ± aÃ§
    try{
        const b1 = document.getElementById('home-edit-today');
        const b2 = document.getElementById('home-edit-ann');
        const b3 = document.getElementById('home-edit-quote');
        if(b1) b1.style.display = 'none'; // artÄ±k dinamik
        if(b2) b2.style.display = 'none'; // duyuru dinamik
        if(b3) b3.style.display = (isAdminMode && isEditingActive ? 'inline-flex' : 'none');
    }catch(e){}
}



// Ana Sayfa - GÃ¼nÃ¼n SÃ¶zÃ¼ dÃ¼zenleme (sadece admin mod + dÃ¼zenleme aÃ§Ä±kken)
function editHomeBlock(kind){
    if(!isAdminMode){
        Swal.fire("Yetkisiz", "Bu iÅlem iÃ§in admin yetkisi gerekli.", "warning");
        return;
    }
    if(!isEditingActive){
        Swal.fire("KapalÄ±", "DÃ¼zenleme modu kapalÄ±. Ãnce 'DÃ¼zenlemeyi AÃ§' demelisin.", "info");
        return;
    }
    if(kind !== 'quote'){
        Swal.fire("Bilgi", "Bu alan artÄ±k otomatik gÃ¼ncelleniyor.", "info");
        return;
    }
    const cur = String((homeBlocks && homeBlocks.quote && homeBlocks.quote.content) ? homeBlocks.quote.content : (localStorage.getItem('homeQuote') || '')).trim();
    Swal.fire({
        title: "GÃ¼nÃ¼n SÃ¶zÃ¼",
        input: "textarea",
        inputValue: cur,
        inputPlaceholder: "BugÃ¼nÃ¼n sÃ¶zÃ¼nÃ¼ yazâ¦",
        showCancelButton: true,
        confirmButtonText: "Kaydet",
        cancelButtonText: "VazgeÃ§",
        preConfirm: (val)=> (val||'').trim()
    }).then(res=>{
        if(!res.isConfirmed) return;
        const val = res.value || '';
        // local fallback
        try{ localStorage.setItem('homeQuote', val); }catch(e){}
        // e-tabla (HomeBlocks)
        apiCall('updateHomeBlock', { key:'quote', title:'GÃ¼nÃ¼n SÃ¶zÃ¼', content: val, visibleGroups:'' })
          .then(()=>{
            homeBlocks = homeBlocks || {};
            homeBlocks.quote = { key:'quote', title:'GÃ¼nÃ¼n SÃ¶zÃ¼', content: val, visibleGroups:'' };
            try{ localStorage.setItem('homeBlocksCache', JSON.stringify(homeBlocks||{})); }catch(e){}
            renderHomePanels();
            Swal.fire("Kaydedildi", "GÃ¼nÃ¼n sÃ¶zÃ¼ gÃ¼ncellendi.", "success");
          })
          .catch(()=>{
            renderHomePanels();
            Swal.fire("Kaydedildi", "GÃ¼nÃ¼n sÃ¶zÃ¼ gÃ¼ncellendi (yerel).", "success");
          });
    });
}

// Kart detayÄ±nÄ± doÄrudan aÃ§mak iÃ§in kÃ¼Ã§Ã¼k bir yardÄ±mcÄ±
function openCardDetail(cardId){
    const card = (cardsData||[]).find(x=>String(x.id)===String(cardId));
    if(!card){Swal.fire('Hata','Kart bulunamadÄ±.','error');return;}
    showCardDetail(card);
}

/* -------------------------
   TELE SATIÅ FULLSCREEN
--------------------------*/
let telesalesOffers = [];
function safeGetToken(){
    try{ return (typeof getToken === 'function') ? getToken() : ''; }catch(e){ return ''; }
}
async function fetchSheetObjects(actionName){
    const payload = { action: actionName, username: (currentUser||''), token: safeGetToken() };
    const r = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    });
    const d = await r.json();
    if(!d || d.result !== "success") throw new Error((d && d.message) ? d.message : "Veri alÄ±namadÄ±.");
    // backend handleFetchData returns {data:[...]} ; other handlers may use {items:[...]}
    return d.data || d.items || [];
}

async function openTelesalesArea(){
    // MenÃ¼ yetkisi: telesales (TeleSatÄ±Å) - yetkisiz kullanÄ±cÄ± fullscreen'e giremesin
    try{
        const perm = (typeof menuPermissions!=="undefined" && menuPermissions) ? menuPermissions["telesales"] : null;
        if(perm && !isAllowedByPerm(perm)){
            Swal.fire("Yetkisiz", "TeleSatÄ±Å ekranÄ±na eriÅimin yok.", "warning");
            return;
        }
    }catch(e){}

    const wrap = document.getElementById('telesales-fullscreen');
    if(!wrap) return;
    wrap.style.display = 'flex';
    document.body.classList.add('fs-open');
    document.body.style.overflow='hidden';

    // Sidebar profil
    const av = document.getElementById('t-side-avatar');
    const nm = document.getElementById('t-side-name');
    const rl = document.getElementById('t-side-role');
    if(av) av.innerText = (currentUser||'U').trim().slice(0,1).toUpperCase();
    if(nm) nm.innerText = currentUser || 'KullanÄ±cÄ±';
    if(rl) rl.innerText = isAdminMode ? 'Admin' : 'Temsilci';

    // Data teklifleri: Ã¶nce e-tabladan Ã§ekmeyi dene, olmazsa fallback
    if(telesalesOffers.length===0){
        let loaded = [];
        try{
            loaded = await fetchSheetObjects("getTelesalesOffers");
        }catch(e){
            // sessiz fallback
        }
        telesalesOffers = (Array.isArray(loaded) && loaded.length)
            ? loaded.map(o=>({
                segment: o.segment || o.Segment || o.SEGMENT || '',
                title: o.title || o.BaÅlÄ±k || o.Baslik || o.Teklif || o['Teklif AdÄ±'] || o['Teklif Adi'] || '',
                desc: o.desc || o.AÃ§Ä±klama || o.Aciklama || o.Detay || o['Detay/Not'] || o.Not || '',
                example: o.example || o.Ãrnek || o.Ornek || '',
                tips: o.tips || o.Ä°pucu || o.Ipucu || '',
                objection: o.objection || o.Itiraz || '',
                reply: o.reply || o.Cevap || ''
            }))
            : (Array.isArray(window.telesalesOffersFromSheet) && window.telesalesOffersFromSheet.length
                ? window.telesalesOffersFromSheet
                : TELESales_OFFERS_FALLBACK);
    }

    // Segment filtresi kaldÄ±rÄ±ldÄ±
    renderTelesalesDataOffers();
    renderTelesalesScripts();
    switchTelesalesTab('data');
}

function closeFullTelesales(){
    const wrap = document.getElementById('telesales-fullscreen');
    if(wrap) wrap.style.display = 'none';
    document.body.classList.remove('fs-open');
    document.body.style.overflow='';
}

function switchTelesalesTab(tab){
    document.querySelectorAll('#telesales-fullscreen .q-nav-item').forEach(i=>i.classList.remove('active'));
    // Set active nav by onclick marker
    document.querySelectorAll('#telesales-fullscreen .q-nav-item').forEach(i=>{
        if((i.getAttribute('onclick')||'').includes(`"${tab}"`)) i.classList.add('active');
    });

    document.querySelectorAll('#telesales-fullscreen .q-view-section').forEach(s=>s.classList.remove('active'));
    const el = document.getElementById(`t-view-${tab}`);
    if(el) el.classList.add('active');
}

function hydrateTelesalesSegmentFilter(){
    const sel = document.getElementById('t-data-seg');
    if(!sel) return;
    const segs = Array.from(new Set((telesalesOffers||[]).map(o=>o.segment).filter(Boolean))).sort();
    sel.innerHTML = '<option value="all">TÃ¼m Segmentler</option>' + segs.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
}

function renderTelesalesDataOffers(){
    const grid = document.getElementById('t-data-grid');
    if(!grid) return;

    const q = (document.getElementById('t-data-search')?.value||'').toLowerCase();

    const list = (telesalesOffers||[]).filter(o=>{
        const hay = `${o.title||''} ${o.desc||''} ${o.segment||''} ${o.tag||''}`.toLowerCase();
        const okQ = !q || hay.includes(q);
        return okQ;
    });

    const bar = (isAdminMode && isEditingActive) ? `
        <div style="grid-column:1/-1;display:flex;gap:10px;align-items:center;margin:6px 0 12px;">
          <button class="x-btn x-btn-admin" onclick="addTelesalesOffer()"><i class="fas fa-plus"></i> Teklif Ekle</button>
        </div>
    ` : '';

    if(list.length===0){
        grid.innerHTML = bar + '<div style="opacity:.7;padding:20px;grid-column:1/-1">SonuÃ§ bulunamadÄ±.</div>';
        const cnt = document.getElementById('t-data-count'); if(cnt) cnt.innerText = '0 kayÄ±t';
        return;
    }

    const cnt = document.getElementById('t-data-count');
    if(cnt) cnt.innerText = `${list.length} kayÄ±t`;

    grid.innerHTML = bar + list.map((o, idx)=>`
        <div class="q-training-card" onclick="showTelesalesOfferDetail(${idx})" style="cursor:pointer">
          <div class="t-training-head">
            <div style="min-width:0">
              <div class="q-item-title" style="font-size:1.02rem">${escapeHtml(o.title||'Teklif')}</div>
            </div>
            <div class="t-training-badge">${escapeHtml(o.segment||o.tag||'')}</div>
          </div>
          <div class="t-training-desc">${escapeHtml((o.desc||'').slice(0,140))}${(o.desc||'').length>140?'...':''}</div>
          <div style="margin-top:10px;color:#999;font-size:.8rem">(Detay iÃ§in tÄ±kla)</div>
          ${(isAdminMode && isEditingActive) ? `
            <div style="margin-top:12px;display:flex;gap:10px">
              <button class="x-btn x-btn-admin" onclick="event.stopPropagation(); editTelesalesOffer(${idx});"><i class="fas fa-pen"></i> DÃ¼zenle</button>
              <button class="x-btn x-btn-admin" onclick="event.stopPropagation(); deleteTelesalesOffer(${idx});"><i class="fas fa-trash"></i> Sil</button>
            </div>
          ` : ``}
        </div>
    `).join('');
}

function addTelesalesOffer(){
    Swal.fire({
        title:"TeleSatÄ±Å Teklifi Ekle",
        html: `
          <input id="to-title" class="swal2-input" placeholder="BaÅlÄ±k">
          <input id="to-seg" class="swal2-input" placeholder="Segment / Etiket (opsiyonel)">
          <textarea id="to-desc" class="swal2-textarea" placeholder="AÃ§Ä±klama"></textarea>
          <textarea id="to-detail" class="swal2-textarea" placeholder="Detay (opsiyonel)"></textarea>
        `,
        showCancelButton:true,
        confirmButtonText:"Ekle",
        cancelButtonText:"VazgeÃ§",
        preConfirm: ()=>{
            const title=(document.getElementById('to-title').value||'').trim();
            if(!title) return Swal.showValidationMessage("BaÅlÄ±k zorunlu");
            return {
                id:'local_'+Date.now(),
                title,
                segment:(document.getElementById('to-seg').value||'').trim(),
                desc:(document.getElementById('to-desc').value||'').trim(),
                detail:(document.getElementById('to-detail').value||'').trim(),
            };
        }
    }).then(async res=>{
        if(!res.isConfirmed) return;
        const v = res.value;
        Swal.fire({ title:'Ekleniyor...', didOpen:()=>Swal.showLoading(), showConfirmButton:false });
        try{
          const r = await fetch(SCRIPT_URL, {
            method:'POST',
            headers:{'Content-Type':'text/plain;charset=utf-8'},
            body: JSON.stringify({ action:'upsertTelesalesOffer', username: currentUser, token: getToken(), keyTitle: '', keySegment: '', ...v })
          });
          const d = await r.json();
          if(d.result==='success'){
            Swal.fire({ icon:'success', title:'Eklendi', timer:1200, showConfirmButton:false });
            await fetchSheetObjects();
            renderTelesalesDataOffers();
          }else{
            Swal.fire('Hata', d.message||'Eklenemedi', 'error');
          }
        }catch(e){
          Swal.fire('Hata','Sunucu hatasÄ±.', 'error');
        }
    });
}

async function editTelesalesOffer(idx){
    const o = (telesalesOffers||[])[idx];
    if(!o) return;
    const { value: v } = await Swal.fire({
        title:"Teklifi DÃ¼zenle",
        html: `
          <input id="to-title" class="swal2-input" placeholder="BaÅlÄ±k" value="${escapeHtml(o.title||'')}">
          <input id="to-seg" class="swal2-input" placeholder="Segment / Etiket" value="${escapeHtml(o.segment||'')}">
          <textarea id="to-desc" class="swal2-textarea" placeholder="AÃ§Ä±klama">${escapeHtml(o.desc||'')}</textarea>
          <textarea id="to-detail" class="swal2-textarea" placeholder="Detay">${escapeHtml(o.detail||'')}</textarea>
        `,
        showCancelButton:true,
        confirmButtonText:"Kaydet",
        cancelButtonText:"VazgeÃ§",
        preConfirm: ()=>{
            const title=(document.getElementById('to-title').value||'').trim();
            if(!title) return Swal.showValidationMessage("BaÅlÄ±k zorunlu");
            return {
                title,
                segment:(document.getElementById('to-seg').value||'').trim(),
                desc:(document.getElementById('to-desc').value||'').trim(),
                detail:(document.getElementById('to-detail').value||'').trim(),
            };
        }
    });
    if(!v) return;

    Swal.fire({ title:'Kaydediliyor...', didOpen:()=>Swal.showLoading(), showConfirmButton:false });
    try{
      const r = await fetch(SCRIPT_URL, {
        method:'POST',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body: JSON.stringify({ action:'upsertTelesalesOffer', username: currentUser, token: getToken(), keyTitle: o.title, keySegment: o.segment, ...v })
      });
      const d = await r.json();
      if(d.result==='success'){
        Swal.fire({ icon:'success', title:'Kaydedildi', timer:1200, showConfirmButton:false });
        await fetchSheetObjects();
        renderTelesalesDataOffers();
      }else{
        Swal.fire('Hata', d.message||'Kaydedilemedi', 'error');
      }
    }catch(e){
      Swal.fire('Hata','Sunucu hatasÄ±.', 'error');
    }
}

function deleteTelesalesOffer(idx){
    const o = (telesalesOffers||[])[idx];
    if(!o) return;
    Swal.fire({
        title:"Silinsin mi?",
        text:"Teklif pasife alÄ±nacak.",
        icon:"warning",
        showCancelButton:true,
        confirmButtonText:"Sil",
        cancelButtonText:"VazgeÃ§"
    }).then(async res=>{
        if(!res.isConfirmed) return;
        try{
          const r = await fetch(SCRIPT_URL, {
            method:'POST',
            headers:{'Content-Type':'text/plain;charset=utf-8'},
            body: JSON.stringify({ action:'deleteTelesalesOffer', username: currentUser, token: getToken(), keyTitle: o.title, keySegment: o.segment })
          });
          const d = await r.json();
          if(d.result==='success'){
            await fetchSheetObjects();
            renderTelesalesDataOffers();
            Swal.fire({ icon:'success', title:'Silindi', timer:1000, showConfirmButton:false });
          }else{
            Swal.fire('Hata', d.message||'Silinemedi', 'error');
          }
        }catch(e){
          Swal.fire('Hata','Sunucu hatasÄ±.', 'error');
        }
    });
}

function showTelesalesOfferDetail(idx){
    const o = (telesalesOffers||[])[idx];
    if(!o) return;
    Swal.fire({
        title: `<i class="fas fa-database" style="color:#0e1b42"></i> ${escapeHtml(o.title||'')}`,
        html: `<div style="text-align:left;line-height:1.6">
                <div style="margin-bottom:10px"><b>Segment:</b> ${escapeHtml(o.segment||'-')}</div>
                <div>${escapeHtml(o.desc||'Detay yok.').replace(/\n/g,'<br>')}</div>
              </div>`,
        showCloseButton:true,
        showConfirmButton:false,
        width:'720px',
        background:'#f8f9fa'
    });
}

function renderTelesalesScripts(){
    const area = document.getElementById('t-scripts-grid');
    if(!area) return;

    let list = (salesScripts||[]);
    try{
        const ov = JSON.parse(localStorage.getItem('telesalesScriptsOverride') || '[]');
        if(Array.isArray(ov) && ov.length) list = ov;
    }catch(e){}

    // Ä°stek: TeleSatÄ±Å Scriptler'deki ayrÄ± "DÃ¼zenlemeyi AÃ§" kalksÄ±n.
    // DÃ¼zenleme sadece Ã¼st kullanÄ±cÄ± menÃ¼sÃ¼ndeki global "DÃ¼zenlemeyi AÃ§" aktifken yapÄ±labilsin.
    const bar = (isAdminMode && isEditingActive) ? `
        <div style="display:flex;gap:10px;align-items:center;margin:6px 0 12px;">
          <button class="x-btn x-btn-admin" onclick="addTelesalesScript()"><i class="fas fa-plus"></i> Script Ekle</button>
        </div>
    ` : '';

    if(list.length===0){
        area.innerHTML = bar + '<div style="padding:16px;opacity:.7">Script bulunamadÄ±.</div>';
        return;
    }

    area.innerHTML = bar + list.map((s, i)=>`
      <div class="news-item" style="border-left-color:#10b981;cursor:pointer" onclick="copyText('${escapeForJsString(s.text||'')}')">
        <span class="news-title">${escapeHtml(s.title||'Script')}</span>
        <div class="news-desc" style="white-space:pre-line">${escapeHtml(s.text||'')}</div>
        <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin-top:10px">
          <div class="news-tag" style="background:rgba(16,185,129,.08);color:#10b981;border:1px solid rgba(16,185,129,.25)">TÄ±kla & Kopyala</div>
          ${(isAdminMode && isEditingActive) ? `
            <div style="display:flex;gap:8px">
              <button class="x-btn x-btn-admin" onclick="event.stopPropagation(); editTelesalesScript(${i});"><i class="fas fa-pen"></i></button>
              <button class="x-btn x-btn-admin" onclick="event.stopPropagation(); deleteTelesalesScript(${i});"><i class="fas fa-trash"></i></button>
            </div>
          ` : ``}
        </div>
      </div>
    `).join('');
}

function getTelesalesScriptsStore(){
    try{
        const ov = JSON.parse(localStorage.getItem('telesalesScriptsOverride') || '[]');
        if(Array.isArray(ov) && ov.length) return ov;
    }catch(e){}
    return (salesScripts||[]);
}
function saveTelesalesScriptsStore(arr){
    localStorage.setItem('telesalesScriptsOverride', JSON.stringify(arr||[]));
}

function addTelesalesScript(){
    Swal.fire({
        title:"Script Ekle",
        html: `
          <input id="ts-title" class="swal2-input" placeholder="BaÅlÄ±k">
          <textarea id="ts-text" class="swal2-textarea" placeholder="Script metni"></textarea>
        `,
        showCancelButton:true,
        confirmButtonText:"Ekle",
        cancelButtonText:"VazgeÃ§",
        preConfirm: ()=>{
            const title=(document.getElementById('ts-title').value||'').trim();
            const text=(document.getElementById('ts-text').value||'').trim();
            if(!text) return Swal.showValidationMessage("Script metni zorunlu");
            return { id:'local_'+Date.now(), title: title||'Script', text };
        }
    }).then(res=>{
        if(!res.isConfirmed) return;
        const arr = getTelesalesScriptsStore();
        arr.unshift(res.value);
        saveTelesalesScriptsStore(arr);
        renderTelesalesScripts();
    });
}

function editTelesalesScript(idx){
    const arr = getTelesalesScriptsStore();
    const s = arr[idx];
    if(!s) return;
    Swal.fire({
        title:"Script DÃ¼zenle",
        html: `
          <input id="ts-title" class="swal2-input" placeholder="BaÅlÄ±k" value="${escapeHtml(s.title||'')}">
          <textarea id="ts-text" class="swal2-textarea" placeholder="Script metni">${escapeHtml(s.text||'')}</textarea>
        `,
        showCancelButton:true,
        confirmButtonText:"Kaydet",
        cancelButtonText:"VazgeÃ§",
        preConfirm: ()=>{
            const title=(document.getElementById('ts-title').value||'').trim();
            const text=(document.getElementById('ts-text').value||'').trim();
            if(!text) return Swal.showValidationMessage("Script metni zorunlu");
            return { ...s, title: title||'Script', text };
        }
    }).then(res=>{
        if(!res.isConfirmed) return;
        arr[idx]=res.value;
        saveTelesalesScriptsStore(arr);
        renderTelesalesScripts();
    });
}
function deleteTelesalesScript(idx){
    Swal.fire({title:"Silinsin mi?", icon:"warning", showCancelButton:true, confirmButtonText:"Sil", cancelButtonText:"VazgeÃ§"}).then(res=>{
        if(!res.isConfirmed) return;
        const arr = getTelesalesScriptsStore().filter((_,i)=>i!==idx);
        saveTelesalesScriptsStore(arr);
        renderTelesalesScripts();
    });
}

function renderTelesalesDocs(){
    const box = document.getElementById('t-docs');
    if(!box) return;
    const docs = (trainingData||[]).filter(t=>(t.target||'')==='TelesatÄ±Å' || (t.title||'').toLowerCase().includes('telesatÄ±Å'));
    if(docs.length===0){
        box.innerHTML = '<div style="opacity:.7;padding:10px">Bu ekibe atanmÄ±Å dÃ¶kÃ¼man/eÄitim gÃ¶rÃ¼nmÃ¼yor.</div>';
        return;
    }
    box.innerHTML = docs.map(d=>`
      <div class="news-item" style="border-left-color:var(--secondary)">
        <span class="news-date">${escapeHtml((d.startDate||'') + (d.endDate?(' â '+d.endDate):''))}</span>
        <span class="news-title">${escapeHtml(d.title||'')}</span>
        <div class="news-desc">${escapeHtml(d.desc||'')}</div>
        ${d.link && d.link!=='N/A' ? `<a class="btn btn-link" href="${escapeHtml(d.link)}" target="_blank">Link</a>`:''}
        ${d.docLink && d.docLink!=='N/A' ? `<a class="btn btn-link" href="${escapeHtml(d.docLink)}" target="_blank">DÃ¶kÃ¼man</a>`:''}
      </div>
    `).join('');
}

/* -------------------------
   TEKNÄ°K FULLSCREEN
--------------------------*/
async function openTechArea(tab){
    const wrap = document.getElementById('tech-fullscreen');
    if(!wrap) return;
    wrap.style.display = 'flex';
    document.body.classList.add('fs-open');
    document.body.style.overflow='hidden';

    // Sidebar profil
    const av = document.getElementById('x-side-avatar');
    const nm = document.getElementById('x-side-name');
    const rl = document.getElementById('x-side-role');
    if(av) av.innerText = (currentUser||'U').trim().slice(0,1).toUpperCase();
    if(nm) nm.innerText = currentUser || 'KullanÄ±cÄ±';
    if(rl) rl.innerText = isAdminMode ? 'Admin' : 'Temsilci';

    // Ä°lk aÃ§Ä±lÄ±Åta "bozuk gÃ¶rÃ¼nÃ¼m" (flicker) olmasÄ±n: veri gelene kadar bekle
    try{
        if((!database || database.length===0) && window.__dataLoadedPromise){
            const lists = ['x-broadcast-list','x-access-list','x-app-list','x-activation-list','x-cards'];
            lists.forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML = '<div class="home-mini-item">YÃ¼kleniyor...</div>'; });
            await window.__dataLoadedPromise;
        }
    }catch(e){}

    // Ä°Ã§erikler switchTechTab iÃ§inde yÃ¼kleniyor
    switchTechTab(tab || 'broadcast');
}

function closeFullTech(){
    const wrap = document.getElementById('tech-fullscreen');
    if(wrap) wrap.style.display = 'none';
    document.body.classList.remove('fs-open');
    document.body.style.overflow='';
}

function switchTechTab(tab){
    document.querySelectorAll('#tech-fullscreen .q-nav-item').forEach(i=>i.classList.remove('active'));
    document.querySelectorAll('#tech-fullscreen .q-nav-item').forEach(i=>{
        if((i.getAttribute('onclick')||'').includes(`"${tab}"`)) i.classList.add('active');
    });

    document.querySelectorAll('#tech-fullscreen .q-view-section').forEach(s=>s.classList.remove('active'));
    const el = document.getElementById(`x-view-${tab}`);
    if(el) el.classList.add('active');
}

const TECH_DOC_CONTENT = {"broadcast": [{"title": "Smart TV â CanlÄ± YayÄ±nda Donma Problemi YaÅÄ±yorum", "body": "MÃ¼Återinin sorun yaÅadÄ±ÄÄ± yayÄ±n ya da yayÄ±nlarda genel bir sorun var mÄ± kontrol edilir? Genel bir sorun var ise teknik ekibin incelediÄi yÃ¶nÃ¼nde bilgi verilir.\nMÃ¼Återinin kullandÄ±ÄÄ± cihaz TVmanager âda loglardan kontrol edilir. ArÃ§elik/Beko/Grundig/Altus marka Android TV olmayan Smart TVâlerden ise genel sorun hakkÄ±nda bilgi verilir.\nYukarÄ±daki durumlar dÄ±ÅÄ±nda yaÅanan bir sorun ise TV ve modemin elektrik baÄlantÄ±sÄ±nÄ± kesilip tekrar verilmesi istenir. Â« YaÅadÄ±ÄÄ±nÄ±z sorunu kontrol ederken TV ve modeminizin elektrik baÄlantÄ±sÄ±nÄ± kesip 10 sn sonra yeniden aÃ§abilir misiniz? ArdÄ±ndan yeniden yayÄ±nÄ± aÃ§Ä±p kontrol edebilir misiniz? (AyrÄ±ca Ã¶neri olarak modemi kapatÄ±p tekrar aÃ§tÄ±ktan sonra, sadece izleme yaptÄ±ÄÄ± cihaz modeme baÄlÄ± olursa daha iyi bir baÄlantÄ± olacaÄÄ± bilgisi verilebilir)\nSorun devam eder ise Smart TV tarayÄ±cÄ±sÄ±ndan https://www.hiztesti.com.tr/ bir hÄ±z testi yapmasÄ± sonucu bizimle paylaÅmasÄ± istenir.\nHÄ±z testi sonucu 8 Mbps altÄ±nda ise internet baÄlantÄ± hÄ±zÄ±nÄ±n dÃ¼ÅÃ¼k olduÄunu internet servis saÄlayÄ±cÄ±sÄ± iletiÅime geÃ§mesi istenir.\n8 Mbps Ã¼zerinde ise mÃ¼Återiden sorunu gÃ¶steren kÄ±sa bir video talep edilir.\nVideo kaydÄ± ve hÄ±z testinin sonuÃ§larÄ± gÃ¶steren bilgiler alÄ±ndÄ±ktan sonra mÃ¼Återiye incelenmesi iÃ§in teknik ekibimize iletildiÄi inceleme tamamlandÄ±ÄÄ±nda eposta ile bilgi verileceÄi yÃ¶nÃ¼nde bilgi verilir.\nSorun aynÄ± gÃ¼n iÃ§inde benzer cihazlarda farklÄ± mÃ¼Återilerde yaÅÄ±yor ise tÃ¼m bilgilerle Erlabâa arÄ±za kaydÄ± aÃ§Ä±lÄ±r. Sorun birkaÃ§ mÃ¼Återi ile sÄ±nÄ±rlÄ± ise 17:00 â 01:00 vardiyasÄ±ndaki ekip arkadaÅÄ±nda sistemsel bir sorun olmadÄ±ÄÄ±na dair eposta gÃ¶nderilmesi iÃ§in bilgileri paylaÅÄ±lÄ±r."}, {"title": "Mobil Uygulama â CanlÄ± YayÄ±nda Donma Sorunu YaÅÄ±yorum", "body": "MÃ¼Återinin sorun yaÅadÄ±ÄÄ± yayÄ±n ya da yayÄ±nlarda genel bir sorun var mÄ± kontrol edilir? Genel bir sorun var ise teknik ekibin incelediÄi yÃ¶nÃ¼nde bilgi verilir.(MÃ¼Återi Ä°OS veya Android iÅletim sistemli hangi cihazdan izliyorsa, mÃ¼mkÃ¼nse aynÄ± iÅletim sistemli mobil cihazdan kontrol edilebilir, gerekirse ekip arkadaÅlarÄ±ndan kontrol etmeleri istenebilir)\nGenel bir sorun yok ise, www.hiztesti.com.tr link Ã¼zerinden hÄ±z testi yapmasÄ± sonucu bizimle paylaÅmasÄ± istenir.\nHÄ±z testi sonucu 8 mbps altÄ±nda ise internet baÄlantÄ± hÄ±zÄ±nÄ±n dÃ¼ÅÃ¼k olduÄu internet servisi saÄlayÄ±cÄ±sÄ± ile iletiÅime geÃ§mesi istenir. (Ãneri olarak modemi kapatÄ±p tekrar aÃ§tÄ±ktan sonra sadece izleme yaptÄ±ÄÄ± cihaz modeme baÄlÄ± olursa daha iyi bir baÄlantÄ± olacaÄÄ± bilgisi verilebilir)\n8 mbps Ã¼zerinde ise, uygulama verilerin temizlenmesi veya uygulamanÄ±n silip tekrar yÃ¼klenmesi istenilir, sorun devam etmesi durumunda sorunu gÃ¶steren video kaydÄ± istenir.\n 4. HÄ±z testi, cihaz marka model ve sÃ¼rÃ¼m bilgileri alÄ±ndÄ±ktan sonra, incelenmesi iÃ§in teknik ekibe iletildiÄi, inceleme tamamlandÄ±ÄÄ±nda e-posta  ile bilgi verileceÄi yÃ¶nÃ¼nde bilgi verilir.\n 5. Sorun aynÄ± gÃ¼n iÃ§erinde benzer cihazlarda farklÄ± mÃ¼Återilerde yaÅÄ±yor ise tÃ¼m bilgilerle Erlabâa arÄ±za kaydÄ± aÃ§Ä±lÄ±r. Sorun birkaÃ§ mÃ¼Återi ile sÄ±nÄ±rlÄ±  ise 17:00 â 01:00 vardiyasÄ±ndaki ekip arkadaÅÄ±nda sistemsel bir sorun olmadÄ±ÄÄ±na dair eposta gÃ¶nderilmesi iÃ§in bilgileri paylaÅÄ±lÄ±r."}, {"title": "Bilgisayar â CanlÄ± YayÄ±nda Donma Sorunu YaÅÄ±yorum", "body": "MÃ¼Återinin sorun yaÅadÄ±ÄÄ± yayÄ±n ya da yayÄ±nlarda genel bir sorun var mÄ± kontrol edilir? Genel bir sorun var ise teknik ekibin incelediÄi yÃ¶nÃ¼nde bilgi verilir.\nGenel bir sorun deÄilse, Ã¶ncelikle https://www.hiztesti.com.tr/ bir hÄ±z testi yapmasÄ± sonucu bizimle paylaÅmasÄ± istenir.\nHÄ±z testi sonucu 8 mbps altÄ±nda ise internet baÄlantÄ± hÄ±zÄ±nÄ±n dÃ¼ÅÃ¼k olduÄunu internet servis saÄlayÄ±cÄ±sÄ± iletiÅime geÃ§mesi istenir.\n8 mbps Ã¼zerinde ise mÃ¼Återiden aÅaÄÄ±daki adÄ±mlarÄ± uygulamasÄ± istenir.\n3. BilgisayarÄ±n iÅletim sitemi Ã¶Ärenilip, gÃ¶rÃ¼Åme Ã¼zerinden ââpingWindows7ââ veya ââpingwindows10ââ kÄ±sayollarÄ±ndan mÃ¼Återi sunucularÄ± kontrol edilir.\n(Windows 10 Ã¼zeri iÅletim sistemi cihazlara pingwindows10 kÄ±sayolu gÃ¶nderilebilir.)\n4. Sunucu kontrol ekranÄ±nda kontrol edilmesi gereken, ok ile gÃ¶sterilen yerden, sunucu ile kayÄ±p olup olmadÄ±ÄÄ± ve kÄ±rmÄ±zÄ± alan iÃ§erisinde sunucu ile web sitemize kaÃ§ saniyede iÅlem saÄladÄ±ÄÄ± kontrol edilir.\n5. 1 â 35 arasÄ± normal sayÄ±labilir, bu saniye aralÄ±ÄÄ±nda sorun yaÅanÄ±yorsa, web sitemize daha hÄ±zlÄ± tepsi sÃ¼resi veren ve genellikle sorunsuz bir Åekilde izleme saÄlanabilen 193.192.103.249, 185.11.14.27 veya 195.175.178.8 sunucularÄ± kontrol edilmelidir.\n6. Uygun sunucuyu tespit ettikten sonra canlÄ± destek ekranÄ±nda ââHostââ ââhost2ââ kÄ±sa yollarÄ± kullanarak, kÄ±sa yoldaki adÄ±mlar ile mÃ¼Återinin sadece bizim sitemize baÄlandÄ±ÄÄ± sunucusunu, en uygun sunucu ile deÄiÅtirip tarayÄ±cÄ± aÃ§Ä±p kapattÄ±rdÄ±ktan sonra tekrar yayÄ±nÄ± kontrol etmesini iletebiliriz. (AyrÄ±ca mÃ¼Återi yayÄ±nlarÄ± auto deÄil, manuel olarak 720 veya 1080p seÃ§ip kontrol edilmesi Ã¶nerilir)\n7. Sorun aynÄ± gÃ¼n iÃ§erinde benzer iÅletim sistemi veya sunucuda farklÄ± mÃ¼Återilerde yaÅÄ±yor ise tÃ¼m bilgilerle Erlabâa arÄ±za kaydÄ± aÃ§Ä±lÄ±r. Sorun birkaÃ§ mÃ¼Återi ile sÄ±nÄ±rlÄ± ise 17:00 â 01:00 vardiyasÄ±ndaki ekip arkadaÅÄ±nda sistemsel bir sorun olmadÄ±ÄÄ±na dair eposta gÃ¶nderilmesi iÃ§in bilgileri paylaÅÄ±lÄ±r"}, {"title": "YAYIN SORUNLARI", "body": "35 sn arasÄ± normal sayÄ±labilir, bu saniye aralÄ±ÄÄ±nda sorun yaÅanÄ±yorsa, web sitemize daha hÄ±zlÄ± tepsi sÃ¼resi veren ve genellikle sorunsuz bir Åekilde izleme saÄlanabilen 193.192.103.249, 185.11.14.27 veya 195.175.178.8 sunucularÄ± kontrol edilmelidir."}, {"title": "MacOS â CanlÄ± YayÄ±nda Donma Sorunu YaÅÄ±yorum", "body": "MÃ¼Återinin sorun yaÅadÄ±ÄÄ± yayÄ±n ya da yayÄ±nlarda genel bir sorun var mÄ± kontrol edilir? Genel bir sorun var ise teknik ekibin incelediÄi yÃ¶nÃ¼nde bilgi verilir.\nGenel bir sorun deÄilse, Ã¶ncelikle https://www.hiztesti.com.tr/ bir hÄ±z testi yapmasÄ± sonucu bizimle paylaÅmasÄ± istenir.\nHÄ±z testi sonucu 8 mbps altÄ±nda ise internet baÄlantÄ± hÄ±zÄ±nÄ±n dÃ¼ÅÃ¼k olduÄunu internet servis saÄlayÄ±cÄ±sÄ± iletiÅime geÃ§mesi istenir.\n8 mbps Ã¼zerinde ise mÃ¼Återiden aÅaÄÄ±daki adÄ±mlarÄ± uygulamasÄ± istenir.\nMindbehind Ã¼zerinden ââpingmacOSââ kÄ±sayolundan mÃ¼Återi sunucularÄ± kontrol edilir.\nSunucu kontrol ekranÄ±nda kontrol edilmesi gereken, ââpacket lossââ kÄ±smÄ±nda kayÄ±p olup olmadÄ±ÄÄ±,  alan iÃ§erisinde sunucu ile web sitemize kaÃ§ saniyede iÅlem saÄladÄ±ÄÄ± kontrol edilir.\n1 â 35 arasÄ± normal sayÄ±labilir, bu saniye aralÄ±ÄÄ±nda sorun yaÅanÄ±yorsa, web sitemize daha hÄ±zlÄ± tepsi sÃ¼resi veren ve genellikle sorunsuz bir Åekilde izleme saÄlanabilen 193.192.103.249, 185.11.14.27 veya 195.175.178.8 sunucularÄ± kontrol edilmelidir.\nUygun sunucuyu tespit ettikten sonra canlÄ± destek ekranÄ±nda ââmacOShostââ kÄ±sa yolunu kullanarak, kÄ±sa yoldaki adÄ±mlar ile mÃ¼Återinin sadece bizim sitemize baÄlandÄ±ÄÄ± sunucuyu, en uygun sunucu ile deÄiÅtirip tarayÄ±cÄ± aÃ§Ä±p kapattÄ±rdÄ±ktan sonra tekrar yayÄ±nÄ± kontrol etmesini iletebiliriz. (AyrÄ±ca mÃ¼Återi yayÄ±nlarÄ± auto deÄil, manuel olarak 720 veya 1080p seÃ§ip kontrol edilmesi Ã¶nerilir)\nSorun aynÄ± gÃ¼n iÃ§erinde benzer iÅletim sistemi veya sunucuda farklÄ± mÃ¼Återilerde yaÅÄ±yor ise tÃ¼m bilgilerle Erlabâa arÄ±za kaydÄ± aÃ§Ä±lÄ±r. Sorun birkaÃ§ mÃ¼Återi ile sÄ±nÄ±rlÄ± ise 17:00 â 01:00 vardiyasÄ±ndaki ekip arkadaÅÄ±nda sistemsel bir sorun olmadÄ±ÄÄ±na dair eposta gÃ¶nderilmesi iÃ§in bilgileri paylaÅÄ±lÄ±r."}, {"title": "ââYayÄ±nda beklenmedik bir kesinti oluÅtuââ UyarÄ±sÄ±", "body": "Bu uyarÄ± genel bir yayÄ±n sorunu olduÄunda ya da kullanÄ±cÄ± TÃ¼rkiye sÄ±nÄ±rlarÄ± dÄ±ÅÄ±nda bir yerden eriÅim saÄladÄ±ÄÄ±nda karÅÄ±mÄ±za Ã§Ä±kmaktadÄ±r.\nKullanÄ±cÄ±nÄ±n sorun yaÅadÄ±ÄÄ± yayÄ±n kontrol edilir ve genel bir yayÄ±n sorunu olup olmadÄ±ÄÄ± teyit edilir.\nTvmanagerâda SubscriberLog ekranÄ±ndan ip adresi alÄ±nÄ±r ve yurtdÄ±ÅÄ± bir konum olup olmadÄ±ÄÄ± teyit edilir.\nKullanÄ±cÄ± yurtdÄ±ÅÄ±nda ise eriÅim saÄlayamayacaÄÄ± bilgisi verilir, VPN kullanÄ±yor ise kapatmasÄ± istenir.\nTVmanager Devices kÄ±smÄ±nda oturumlar sonlandÄ±rÄ±lÄ±r ve kullanÄ±cÄ±dan tekrar giriÅ yaparak kontrol etmesi rica edilir.\nMobil veri veya farklÄ± bir aÄda bu hata mesajÄ±nÄ±n alÄ±nÄ±p alÄ±nmadÄ±ÄÄ± teyit edilir.\nCihaz ve modem kapama ve aÃ§ma iÅlemi uygulanÄ±r.\nSorun devam eder ise inceleme iÃ§in cihaz ve diÄer bilgilerle teknik ekibimize bilgi verileceÄi iletilir. Excel de kullanÄ±cÄ±dan alÄ±nan bilgiler not edilir."}], "access": [{"title": "ERÄ°ÅÄ°M SORUNLARI", "body": "ââLisans haklarÄ± sebebiyle TÃ¼rkiye sÄ±nÄ±rlarÄ± dÄ±ÅÄ±nda hizmet verilememektedir.ââ UyarÄ±sÄ±\nAlÄ±nan hata mÃ¼Återinin yurt dÄ±ÅÄ±nda olmasÄ± ve yurt iÃ§inde ise VPN ya da benzeri bir uygulamanÄ±n cihazÄ±nda aktif olmasÄ±ndan kaynaklanmaktadÄ±r.\n\nMÃ¼Återiye yurt dÄ±ÅÄ±nda olup olmadÄ±ÄÄ± sorulur, yurt dÄ±ÅÄ±nda ise ââlisans haklarÄ± sebebiyle yayÄ±nlarÄ±n yurt dÄ±ÅÄ±ndan izlenemediÄiââ yÃ¶nÃ¼nde bilgi verilir.\nYurt iÃ§inde ise VPN ya da benzeri bir uygulamanÄ±n cihazÄ±nda aktif olup ya da olmadÄ±ÄÄ± sorulur. Aktif ise devre dÄ±ÅÄ± bÄ±rakÄ±lÄ±p tekrar denemesi Ã¶nerilir.\nVPN ya da benzeri bir uygulama kullanmÄ±yor ise mÃ¼Återinin ip adresi Ã¶Ärenilir ve https://tr.wizcase.com/tools/whats-my-ip/ ip adresi kontrol edilir.  AynÄ± zamanda adresin vpn Ã¼zerinden alÄ±nÄ±p alÄ±nmadÄ±ÄÄ±nÄ±n kontrolÃ¼ iÃ§in https://vpnapi.io adresine girilip kontrol edilir.\nIp adresi yurt dÄ±ÅÄ± ya da ISP bilgisi bilinen bir servis saÄlayÄ±cÄ±sÄ± deÄilse mÃ¼Återiye bulunduÄu lokasyonun otel, yurt vb. bir yer olup olmadÄ±ÄÄ± ya da cihazÄ±nÄ±n Åirket cihazÄ± olup olmadÄ±ÄÄ± sorulur."}, {"title": "ââIP Karantinaââ UyarÄ±sÄ±", "body": "Ä°p Karantina sorunu genel bir sorun yok ise, eposta veya Åifre bir Ã§ok defa hatalÄ± girilmesinden dolayÄ± alÄ±nÄ±r.\nKullanÄ±cÄ±nÄ±n ip adresi karantina da olup ya da olmadÄ±ÄÄ±, TVmanager â CMS â Admission Gate menÃ¼sÃ¼ Ã¼zerinden kontrol edilerek Ã§Ä±karÄ±labilir. Ä°kinci bir seÃ§enek olarak modem kapama ve aÃ§ma iÅlemi yaptÄ±rÄ±labilir."}], "app": [{"title": "Teknik Sorun Analizi NasÄ±l YapÄ±lÄ±r?", "body": "App KaynaklÄ± Nedenler\nCihaz KaynaklÄ± Nedenler\nApp hatalarÄ± baÅlÄ±ÄÄ±nda uygulamanÄ±n aÃ§Ä±lmamasÄ± ya da kendi kendine kapanmasÄ± Åeklinde teknik sorunlar ile karÅÄ±laÅabiliriz. Bu tip sorunlar, kullanÄ±cÄ± deneyimini doÄrudan etkileyerek uygulamaya eriÅilememesine neden olur.\nUygulamanÄ±n eski sÃ¼rÃ¼mÃ¼\nÃnbellek sorunlarÄ±\nUyumsuz cihazlar\nDolu RAM/Arka planda Ã§alÄ±Åan fazla uygulama\nCihazÄ±n gÃ¼ncel olmamasÄ± (Eski sistemi sÃ¼rÃ¼mleri)\nKullanÄ±cÄ±ya Sorulabilecek Sorular:\nUygulama aÃ§Ä±lÄ±yor mu, yoksa aÃ§Ä±lmadan kapanÄ±yor mu?\nUygulama sÃ¼rÃ¼mÃ¼, cihaz iÅletim sistemi sÃ¼rÃ¼mÃ¼ nedir? (TVmanager kontrolÃ¼)\nCihazda yeterli depolama alanÄ± var mÄ±?"}], "activation": [{"title": "ââPromosyon Kodu BulunamadÄ±ââ UyarÄ±sÄ±", "body": "GÃ¶rselde ki Ã¶rnekte doÄrusu ââYILLIKLOCAââ olan kampanya kodu, kÃ¼Ã§Ã¼k harf ile yazÄ±ldÄ±ÄÄ±nda ââPromosyon Kodu BulunamadÄ±ââ hatasÄ± alÄ±nmÄ±ÅtÄ±r. Bu hata ile karÅÄ±laÅÄ±ldÄ±ÄÄ±nda kampanya kodunun yanlÄ±Å, eksik, kÃ¼Ã§Ã¼k harf ya da boÅluk bÄ±rakÄ±larak yazÄ±ldÄ±ÄÄ±nÄ± tespitle, kullanÄ±cÄ±yÄ± bu doÄrultuda doÄru yazÄ±m iÃ§in yÃ¶nlendirmemiz gerekir."}, {"title": "ââKampanya Kodu Aktif Edilemediââ UyarÄ±sÄ±", "body": "GÃ¶rseldeki Ã¶rnekteki gibi eski bir promosyon kodu yazÄ±ldÄ±ÄÄ±nda ââKampanya Kodu Aktif Edilemediââ uyarÄ±sÄ± alÄ±nÄ±r."}, {"title": "ââGeÃ§ersiz Kampanya Koduââ UyarÄ±sÄ±", "body": "GÃ¶rseldeki Ã¶rnekteki gibi daha Ã¶nce kullanÄ±lmÄ±Å bir promosyon kodu yazÄ±ldÄ±ÄÄ±nda ââGeÃ§ersiz Kampanya Koduââ hatasÄ± alÄ±nÄ±r.\nPromosyon kodunun hangi hesapta kullanÄ±ldÄ±ÄÄ±nÄ± aÅaÄÄ±daki gÃ¶rseldeki gibi Campaign alanÄ±nda arama yaparak gÃ¶rÃ¼ntÃ¼leyebiliriz."}, {"title": "Playstore Uygulama Aktivasyon Sorunu", "body": "BazÄ± durumlarda, kullanÄ±cÄ±lar Google Play Store Ã¼zerinden S Sport Plus uygulamasÄ±nda abonelik satÄ±n aldÄ±klarÄ±nda veya yenileme gerÃ§ekleÅtiÄinde, Ã¼yelikleri otomatik olarak aktifleÅmeyebiliyor.  Bu durumda, kullanÄ±cÄ±nÄ±n uygulama Ã¼zerinden manuel olarak paket aktivasyonu yapmasÄ± gerekmektedir.\n\nAktivasyon iÅleminin baÅarÄ±lÄ± olabilmesi iÃ§in:\n Google Play Store Ã¼zerinden satÄ±n alma iÅlemi yapÄ±lÄ±rken kullanÄ±lan Gmail hesabÄ±, aktivasyon anÄ±nda cihazda aÃ§Ä±k olmalÄ±dÄ±r.\n Aktivasyon iÅlemi uygulama iÃ§erisinden yapÄ±lmalÄ±dÄ±r.\nDestek ekibi tarafÄ±ndan Mindbehind Ã¼zerinden âpaketgoogleâ kÄ±sayolu kullanÄ±larak yÃ¶nlendirme saÄlanabilir.  KullanÄ±cÄ± baÅarÄ±lÄ± bir Åekilde paket aktivasyonu yaptÄ±ktan sonra, paket atamasÄ± sistemde gerÃ§ekleÅir ve log kayÄ±tlarÄ±nda ilgili iÅlem aÅaÄÄ±daki gibi gÃ¶rÃ¼nÃ¼r (ekli gÃ¶rsellerdeki gibi).  Bu iÅlem, paketin doÄru Åekilde tanÄ±mlanmasÄ± iÃ§in Ã¶nemlidir."}, {"title": "App Store Uygulama Aktivasyon Sorunu", "body": "MÃ¼Återiler App Store Ã¼zerinden uygulamamÄ±zdan abonelik satÄ±n aldÄ±ÄÄ± veya yenileme olduÄu zaman bazen Ã¼yelik aktif olmuyor.\nÃyelikleri aktif olabilmeleri iÃ§in, uygulama Ã¼zerinden paket aktivasyon yapmalarÄ± gerekiyor. Paket aktivasyon yaparken, satÄ±n alma yaparken hangi Apple kimliÄi hesabÄ± aÃ§Ä±k ise, o hesap aÃ§Ä±kken aktivasyon denemesi gerekiyor.\nMindbehind Ã¼zerinden ââpaketappleââ kÄ±sayolu kullanÄ±lÄ±r.\nMÃ¼Återi paket aktivasyonu yaptÄ±ktan sonra Ã¼yelik atamasÄ± ve loglarda nasÄ±l gÃ¶zÃ¼ktÃ¼ÄÃ¼ gÃ¶rsellerdeki gibidir.\nPaket aktivasyon butonu Ã¶rnek gÃ¶rÃ¼ntÃ¼sÃ¼ yandaki gibidir."}, {"title": "AKTÄ°VASYON SORUNLARI", "body": "Ä°OS Uygulama Paket Aktivasyon ââAbonelik BaÅkasÄ±na Aittirââ Sorunu\n\nÄ°os uygulamamÄ±zda mÃ¼Återi paket aktivasyon iÅlemi yaptÄ±ÄÄ±nda ââAbonelik BaÅkasÄ±na Aittirââ hatasÄ± geliyor ise, cihazda aÃ§Ä±k olan Apple kimliÄi ile satÄ±n alÄ±nmÄ±Å, ancak aktivasyon yaptÄ±ÄÄ± eposta adresi farklÄ± bir eposta adresidir.\n\nFarklÄ± eposta adresi ile paket aktivasyon yaptÄ±ÄÄ±nda ââSubscriberlogââ kÄ±smÄ±nda Ã¶rnek ekran gÃ¶rÃ¼ntÃ¼sÃ¼nde kÄ±rmÄ±zÄ± alana alÄ±nan ââpackageValidationââ  kÄ±smÄ± Ã§Ä±kar, ok ile gÃ¶sterilen ID kÄ±smÄ±ndan doÄru Ã¼yeliÄi ID aramasÄ± ile bulabiliriz."}, {"title": "AKTÄ°VASYON SORUNLARI", "body": "Android ââPaket BaÅka Bir KullanÄ±cÄ±ya Ait OlduÄu Ä°Ã§in Paket Atama Ä°Ålemi BaÅarÄ±sÄ±z Olduââ Sorunu\n\nAndroid uygulamamÄ±zda mÃ¼Återi paket aktivasyon iÅlemi yaptÄ±ÄÄ±nda ââPaket BaÅka Bir KullanÄ±cÄ±ya Ait OlduÄu Ä°Ã§in Paket Atama Ä°Ålemi BaÅarÄ±sÄ±z Olduââ hatasÄ± geliyor ise, cihazda aÃ§Ä±k olan Play Store gmail hesabÄ± ile satÄ±n alÄ±nmÄ±Å, ancak aktivasyon yaptÄ±ÄÄ± eposta adresi farklÄ± bir eposta adresidir.\n\nFarklÄ± eposta adresi ile paket aktivasyon yaptÄ±ÄÄ±nda ââSubscriberlogââ kÄ±smÄ±nda Ã¶rnek ekran gÃ¶rÃ¼ntÃ¼sÃ¼nde kÄ±rmÄ±zÄ± alana alÄ±nan ââValidate Google Packageââ  kÄ±smÄ± Ã§Ä±kar, ok ile gÃ¶sterilen ID kÄ±smÄ±ndan doÄru Ã¼yeliÄi ID aramasÄ± ile bulabiliriz."}, {"title": "AKTÄ°VASYON SORUNLARI", "body": "Android Uygulama Paket Aktivasyon Ä°Ålem TamamlanamadÄ± veya Ãyelik Bulunamama Sorunu\nAndroid uygulamamÄ±zda mÃ¼Återi Ã¶deme yapmÄ±Å olmasÄ±na raÄmen paket aktivasyonu yaptÄ±ÄÄ±nda ââÄ°Ålem tamamlandÄ±, Ä°Ålem TamamlanamadÄ± veya Abone bulunamadÄ±ââ hatasÄ± geliyor ve Ã¼yelik aktif olmuyor ise, mÃ¼Återiden GPA kodunu paylaÅÄ±lmasÄ± istenir.\nGPA kodu, Google tarafÄ±ndan Ã¶deme yapÄ±ldÄ±ÄÄ±na dair mÃ¼Återiye gÃ¶nderilen Ã¶deme faturasÄ± (makbuz) iÃ§erisinde yer almaktadÄ±r.\nBu GPA kodu ile Ã¼yeliÄi Tvmanager Ã¼zerinden aÅaÄÄ±daki gÃ¶rseldeki gibi Reporting > General > Payments kÄ±smÄ±nda tarihi aralÄ±ÄÄ± ayarlanÄ±p ââTransaction Identiferââ kÄ±smÄ±ndan arama yapÄ±lÄ±p, Ã¼yelik IDâsine ââSubscriber IDââ Ã¼zerinden ulaÅÄ±labilir."}, {"title": "AKTÄ°VASYON SORUNLARI", "body": "TÃ¼rksat Abone BulunamadÄ± veya Abone Active DeÄil Sorunu\nBu hata, Hizmet ID veya GeÃ§ici Kod hatalÄ± yazÄ±lmasÄ±ndan dolayÄ± alÄ±nÄ±r.  MÃ¼Återiler genellikle bazÄ± bÃ¼yÃ¼k kÃ¼Ã§Ã¼k harfleri karÄ±ÅtÄ±rabiliyor veya sistemden dolayÄ± bazen bu sorun alÄ±nabiliyor.\nÃÃ¶zÃ¼m olarak harf hatasÄ± olmamasÄ± iÃ§in Tvmanager>Reporting>General>Thirtdparty Provisions kÄ±smÄ±ndan tarih aralÄ±ÄÄ± belirleyip, Hizmet ID numarasÄ±nÄ± ââExtrenal IDââ kÄ±smÄ±ndan aratÄ±p, kullanÄ±cÄ± TÃ¼rksat bilgilerini bulup ââUniqueIDââ kÄ±smÄ±ndan geÃ§ici kodu bulup, kullanÄ±cÄ±ya paylaÅtÄ±ÄÄ±mÄ±zda, ID ve GeÃ§ici kodu kopyala yapÄ±ÅtÄ±rÄ±r Åeklinde ilerlemesini iletebiliriz.\nAynÄ± sorun devam eder ise, kullanÄ±cÄ±dan onay alÄ±p, ID ve geÃ§ici kod ile kullanÄ±cÄ±nÄ±n Ã¼yeliÄini kendimiz yapabiliriz. MÃ¼Återinin Ã¼yeliÄini biz tarafÄ±ndan yapÄ±ldÄ± ise, mÃ¼Återiye Åifresini nasÄ±l gÃ¼ncelleyebileceÄi ile ilgili bilgi verilir."}]};

function renderTechSections(){
    // Kaynak: Sheet'ten gelen teknik kartlar + admin override (localStorage)
    const baseCards = (database||[]).filter(c=>String(c.category||'').toLowerCase()==='teknik');
    let override = [];
    try{ override = JSON.parse(localStorage.getItem('techCardsOverride') || '[]'); }catch(e){ override = []; }
    const techCards = (Array.isArray(override) && override.length) ? override : baseCards;

    // Heuristik sÄ±nÄ±flandÄ±rma
    const buckets = {broadcast:[], access:[], app:[], activation:[], cards:[]};
    techCards.forEach(c=>{
        const hay = `${c.title||''} ${c.text||''} ${c.script||''}`.toLowerCase();
        if(hay.includes('yayÄ±n') || hay.includes('don') || hay.includes('buffer') || hay.includes('akÄ±Å') || hay.includes('tv')){
            buckets.broadcast.push(c);
        }else if(hay.includes('eriÅim') || hay.includes('vpn') || hay.includes('proxy') || hay.includes('login') || hay.includes('giriÅ') || hay.includes('yurtdÄ±ÅÄ±')){
            buckets.access.push(c);
        }else if(hay.includes('app') || hay.includes('uygulama') || hay.includes('hata') || hay.includes('crash') || hay.includes('versiyon')){
            buckets.app.push(c);
        }else if(hay.includes('aktivasyon') || hay.includes('satÄ±n') || hay.includes('satÄ±nalma') || hay.includes('store') || hay.includes('Ã¶deme') || hay.includes('google') || hay.includes('apple')){
            buckets.activation.push(c);
        }else{
            buckets.broadcast.push(c);
        }
        buckets.cards.push(c);
    });

    window.__techBuckets = buckets;

    // Search input baÄlama
    const bindSearch = (inputId, key, listId)=>{
        const inp = document.getElementById(inputId);
        if(!inp) return;
        inp.oninput = ()=> renderTechList(key, inp.value || '', listId);
    };

    bindSearch('x-search-broadcast','broadcast','x-broadcast-list');
    bindSearch('x-search-access','access','x-access-list');
    bindSearch('x-search-app','app','x-app-list');
    bindSearch('x-search-activation','activation','x-activation-list');
    bindSearch('x-search-cards','cards','x-cards-list');

    // Ä°lk Ã§izim
    renderTechList('broadcast','', 'x-broadcast-list');
    renderTechList('access','', 'x-access-list');
    renderTechList('app','', 'x-app-list');
    renderTechList('activation','', 'x-activation-list');
    renderTechList('cards','', 'x-cards-list');
}

let techEditMode = false;

function renderTechList(bucketKey, q, listId){
    const listEl = document.getElementById(listId);
    if(!listEl) return;

    const all = (window.__techBuckets && window.__techBuckets[bucketKey]) ? window.__techBuckets[bucketKey] : [];
    const query = String(q||'').trim().toLowerCase();

    const filtered = !query ? all : all.filter(c=>{
        const hay = `${c.title||''} ${c.text||''} ${c.script||''} ${c.link||''}`.toLowerCase();
        return hay.includes(query);
    });

    const bar = (isAdminMode ? `
        <div style="display:flex;gap:10px;align-items:center;margin:10px 0 14px;">
          <button class="x-btn x-btn-admin" onclick="toggleTechEdit()"><i class="fas fa-pen"></i> ${techEditMode ? 'DÃ¼zenlemeyi Kapat' : 'DÃ¼zenlemeyi AÃ§'}</button>
          ${techEditMode ? `<button class="x-btn x-btn-admin" onclick="addTechCard('${bucketKey}')"><i class="fas fa-plus"></i> Kart Ekle</button>` : ``}
          <span style="color:#888;font-weight:800;font-size:.9rem">Bu dÃ¼zenlemeler tarayÄ±cÄ±da saklanÄ±r (local).</span>
        </div>
    ` : '');

    if(!filtered.length){
        listEl.innerHTML = bar + '<div class="home-mini-item">KayÄ±t bulunamadÄ±.</div>';
        return;
    }

    listEl.innerHTML = bar + `
      <div class="x-card-grid">
        ${filtered.map((c, idx)=> techCardHtml(c, idx)).join('')}
      </div>
    `;
}

function techCardKey(c, idx){
    return (c && (c.id || c.code)) ? String(c.id||c.code) : `${(c.title||'').slice(0,40)}__${idx}`;
}

function techCardHtml(c, idx){
    const title = escapeHtml(c.title||'');
    const badge = escapeHtml(c.code || c.category || 'TEKNÄ°K');
    const rawText = (c.text||'').toString();
    const text = escapeHtml(rawText);
    const link = (c.link||'').trim();
    const script = (c.script||'').trim();
    const key = techCardKey(c, idx);

    // Detay butonunu gÃ¶sterme kriteri (uzun metin / script / link)
    const hasDetail = (rawText && rawText.length > 180) || (script && script.length > 120) || !!link;

    return `
      <div class="x-card" data-key="${escapeHtml(key)}">
        <div class="x-card-head">
          <div class="x-card-title">${title}</div>
          <div class="x-card-badge">${badge}</div>
        </div>
        <div class="x-card-body">
          ${text ? `<div class="x-card-text x-card-text-truncate">${text}</div>` : ``}
          ${hasDetail ? `<button class="x-readmore" onclick="openTechCardDetail(${JSON.stringify(key)})">Devam oku</button>` : ``}
        </div>
        <div class="x-card-actions">
          ${script ? `<button class="x-btn x-btn-copy" onclick="copyText(${JSON.stringify(script)})"><i class="fas fa-copy"></i> Kopyala</button>` : ``}
          ${isAdminMode && techEditMode ? `
            <button class="x-btn x-btn-admin" onclick="editTechCard(${JSON.stringify(key)})"><i class="fas fa-pen"></i> DÃ¼zenle</button>
            <button class="x-btn x-btn-admin" onclick="deleteTechCard(${JSON.stringify(key)})"><i class="fas fa-trash"></i> Sil</button>
          ` : ``}
        </div>
      </div>
    `;
}

// Teknik kart detayÄ±nÄ± popup'ta aÃ§ (ana ekran kartlarÄ± gibi)
function openTechCardDetail(key){
    try{
        const all = __getTechCardsForUi();
        // key: "<id>" veya "idx:<n>" olabilir
        let found = null;
        if(String(key||'').startsWith('idx:')){
            const n = parseInt(String(key).split(':')[1],10);
            if(!Number.isNaN(n)) found = all[n];
        }else{
            found = all.find((c, idx)=>techCardKey(c, idx)===key) || null;
        }
        if(!found){
            Swal.fire({icon:'warning', title:'KayÄ±t bulunamadÄ±', timer:1200, showConfirmButton:false});
            return;
        }

        // showCardDetail(obj) zaten script/link vs. destekliyor
        showCardDetail({
            title: found.title || 'Detay',
            text: found.text || '',
            script: found.script || '',
            alert: found.alert || '',
            link: found.link || ''
        });
    }catch(e){
        Swal.fire('Hata', 'Detay aÃ§Ä±lamadÄ±.', 'error');
    }
}

function toggleTechEdit(){
    techEditMode = !techEditMode;
    // fullscreen teknik kartlar sekmesini tazele
    try{ filterTechCards(); }catch(e){}
}

function getTechOverride(){
    try{
        const arr = JSON.parse(localStorage.getItem('techCardsOverride') || '[]');
        if(Array.isArray(arr)) return arr;
    }catch(e){}
    return [];
}

function saveTechOverride(arr){
    localStorage.setItem('techCardsOverride', JSON.stringify(arr||[]));
}

function addTechCard(bucketKey){
    Swal.fire({
        title: "Teknik Kart Ekle",
        html: `
          <input id="tc-title" class="swal2-input" placeholder="BaÅlÄ±k">
          <input id="tc-badge" class="swal2-input" placeholder="Etiket (Ã¶r: TEKNÄ°K)">
          <input id="tc-link" class="swal2-input" placeholder="Link (opsiyonel)">
          <textarea id="tc-text" class="swal2-textarea" placeholder="AÃ§Ä±klama"></textarea>
          <textarea id="tc-script" class="swal2-textarea" placeholder="Script (opsiyonel)"></textarea>
        `,
        showCancelButton: true,
        confirmButtonText: "Ekle",
        cancelButtonText: "VazgeÃ§",
        preConfirm: ()=>{
            const title = (document.getElementById('tc-title').value||'').trim();
            if(!title) return Swal.showValidationMessage("BaÅlÄ±k zorunlu");
            return {
                id: 'local_' + Date.now(),
                title,
                code: (document.getElementById('tc-badge').value||'TEKNÄ°K').trim(),
                link: (document.getElementById('tc-link').value||'').trim(),
                text: (document.getElementById('tc-text').value||'').trim(),
                script: (document.getElementById('tc-script').value||'').trim(),
                category: 'teknik'
            };
        }
    }).then(res=>{
        if(!res.isConfirmed) return;
        const cur = getTechOverride();
        const base = (database||[]).filter(c=>String(c.category||'').toLowerCase()==='teknik');
        const arr = (cur.length ? cur : base);
        arr.unshift(res.value);
        saveTechOverride(arr);
        try{ filterTechCards(); }catch(e){}
    });
}

function editTechCard(key){
    const cur = getTechOverride();
    const base = (database||[]).filter(c=>String(c.category||'').toLowerCase()==='teknik');
    const arr = (cur.length ? cur : base);
    const idx = arr.findIndex((c,i)=>techCardKey(c,i)===key);
    if(idx<0) return;

    const c = arr[idx] || {};
    Swal.fire({
        title: "KartÄ± DÃ¼zenle",
        html: `
          <input id="tc-title" class="swal2-input" placeholder="BaÅlÄ±k" value="${escapeHtml(c.title||'')}">
          <input id="tc-badge" class="swal2-input" placeholder="Etiket" value="${escapeHtml(c.code||c.category||'TEKNÄ°K')}">
          <input id="tc-link" class="swal2-input" placeholder="Link" value="${escapeHtml(c.link||'')}">
          <textarea id="tc-text" class="swal2-textarea" placeholder="AÃ§Ä±klama">${escapeHtml(c.text||'')}</textarea>
          <textarea id="tc-script" class="swal2-textarea" placeholder="Script">${escapeHtml(c.script||'')}</textarea>
        `,
        showCancelButton: true,
        confirmButtonText: "Kaydet",
        cancelButtonText: "VazgeÃ§",
        preConfirm: ()=>{
            const title = (document.getElementById('tc-title').value||'').trim();
            if(!title) return Swal.showValidationMessage("BaÅlÄ±k zorunlu");
            return {
                ...c,
                title,
                code: (document.getElementById('tc-badge').value||'TEKNÄ°K').trim(),
                link: (document.getElementById('tc-link').value||'').trim(),
                text: (document.getElementById('tc-text').value||'').trim(),
                script: (document.getElementById('tc-script').value||'').trim(),
                category: 'teknik'
            };
        }
    }).then(res=>{
        if(!res.isConfirmed) return;
        arr[idx]=res.value;
        saveTechOverride(arr);
        try{ filterTechCards(); }catch(e){}
    });
}

function deleteTechCard(key){
    Swal.fire({
        title:"Silinsin mi?",
        text:"Bu kart local veriden silinecek.",
        icon:"warning",
        showCancelButton:true,
        confirmButtonText:"Sil",
        cancelButtonText:"VazgeÃ§"
    }).then(res=>{
        if(!res.isConfirmed) return;
        const cur = getTechOverride();
        const base = (database||[]).filter(c=>String(c.category||'').toLowerCase()==='teknik');
        const arr = (cur.length ? cur : base);
        const next = arr.filter((c,i)=>techCardKey(c,i)!==key);
        saveTechOverride(next);
        try{ filterTechCards(); }catch(e){}
    });
}

function renderTechList(targetId, list, showCategory=false){
    const el = document.getElementById(targetId);
    if(!el) return;
    if(!list || list.length===0){
        el.innerHTML = '<div style="padding:16px;opacity:.7">Bu baÅlÄ±k altÄ±nda iÃ§erik yok.</div>';
        return;
    }
    el.innerHTML = list.map((c)=>`
      <div class="news-item" style="cursor:pointer" onclick="showCardDetail(${JSON.stringify(c).replace(/</g,'\u003c')})">
        <span class="news-title">${escapeHtml(c.title||'')}</span>
        ${showCategory ? `<span class="news-tag" style="background:#eef2ff;color:#2b3a8a;border:1px solid #dde3ff">${escapeHtml(c.category||'')}</span>`:''}
        <div class="news-desc" style="white-space:pre-line">${escapeHtml(c.text||'')}</div>
        ${c.script ? `<div class="script-box" style="margin-top:10px"><b>Script:</b><div style="margin-top:6px;white-space:pre-line">${escapeHtml(c.script||'')}</div><div style="text-align:right;margin-top:10px"><button class="btn btn-copy" onclick="event.stopPropagation(); copyText('${escapeForJsString(c.script||'')}')">Kopyala</button></div></div>`:''}
      </div>
    `).join('');
}

function renderTechDocs(){
    const map = {
        broadcast: 'x-broadcast-docs',
        access: 'x-access-docs',
        app: 'x-app-docs',
        activation: 'x-activation-docs'
    };

    Object.keys(map).forEach(key=>{
        const el = document.getElementById(map[key]);
        if(!el) return;

        try{
            const items = (TECH_DOC_CONTENT && TECH_DOC_CONTENT[key]) ? TECH_DOC_CONTENT[key] : [];
            if(!Array.isArray(items) || items.length===0){
                el.innerHTML = '<div style="padding:12px 2px;opacity:.7">Bu baÅlÄ±k altÄ±nda teknik dÃ¶kÃ¼man bulunamadÄ±.</div>';
                return;
            }

            el.innerHTML = items.map((it,idx)=>`
                <div class="doc-card">
                  <button type="button" class="doc-head" onclick="toggleDocAccordion(this)">
                    <span class="doc-title">${escapeHtml(it.title||('Ä°Ã§erik ' + (idx+1)))}</span>
                    <i class="fas fa-chevron-down"></i>
                  </button>
                  <div class="doc-body" style="display:none; white-space:pre-line">${escapeHtml(it.body||'')}</div>
                </div>
            `).join('');
        }catch(err){
            console.error('renderTechDocs error', err);
            el.innerHTML = '<div style="padding:12px 2px;opacity:.7">DÃ¶kÃ¼manlar yÃ¼klenemedi. (Konsolu kontrol edin)</div>';
        }
    });
}

function toggleDocAccordion(btn){
    try{
        const card = btn.closest('.doc-card');
        if(!card) return;
        const body = card.querySelector('.doc-body');
        if(!body) return;
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        card.classList.toggle('open', !isOpen);
    }catch(e){}
}


function renderTechWizardInto(targetId){
    const box = document.getElementById(targetId);
    if(!box) return;

    // AyrÄ± state: fullscreen iÃ§indeki gÃ¶mÃ¼lÃ¼ sihirbaz
    window.embeddedTwState = window.embeddedTwState || { currentStep: 'start', history: [] };

    // Veri yoksa yÃ¼kle
    if(!techWizardData || Object.keys(techWizardData).length === 0){
        box.innerHTML = '<div style="padding:16px;opacity:.7">Sihirbaz yÃ¼kleniyor...</div>';
        loadTechWizardData().then(()=>renderTechWizardInto(targetId));
        return;
    }

    embeddedTwRender(targetId);
}

function embeddedTwRender(targetId){
    const box = document.getElementById(targetId);
    if(!box) return;

    const st = window.embeddedTwState || { currentStep:'start', history:[] };
    const stepData = techWizardData[st.currentStep];

    if(!stepData){
        box.innerHTML = `<div class="tech-alert">Hata: AdÄ±m bulunamadÄ± (${escapeHtml(String(st.currentStep))}).</div>`;
        return;
    }

    const backVisible = st.history && st.history.length>0;

    let html = `
      <div style="display:flex; gap:8px; align-items:center; justify-content:space-between; margin-bottom:12px; flex-wrap:wrap">
        <div style="display:flex; gap:8px; align-items:center">
          ${backVisible ? `<button type="button" class="tech-btn tech-btn-option" onclick="embeddedTwBack('${targetId}')">â¬ Geri</button>` : ''}
          <button type="button" class="tech-btn tech-btn-option" onclick="embeddedTwReset('${targetId}')">â» SÄ±fÄ±rla</button>
        </div>
        <div style="opacity:.7; font-size:.9rem">AdÄ±m: ${escapeHtml(stepData.title || '')}</div>
      </div>

      <div class="tech-step-title">${escapeHtml(stepData.title || '')}</div>
    `;

    if(stepData.text){
        html += `<div style="font-size:1rem; margin:10px 0; white-space:pre-line">${escapeHtml(stepData.text)}</div>`;
    }
    if(stepData.script){
        html += `<div class="tech-script-box"><span class="tech-script-label">MÃ¼Återiye iletilecek:</span>${escapeHtml(stepData.script)}</div>`;
    }
    if(stepData.alert){
        html += `<div class="tech-alert">${escapeHtml(stepData.alert)}</div>`;
    }

    if(Array.isArray(stepData.buttons) && stepData.buttons.length){
        html += `<div class="tech-buttons-area">`;
        stepData.buttons.forEach(btn=>{
            const cls = btn.style === 'option' ? 'tech-btn-option' : 'tech-btn-primary';
            html += `<button type="button" class="tech-btn ${cls}" onclick="embeddedTwChangeStep('${targetId}','${escapeForJsString(btn.next||'start')}')">${escapeHtml(btn.text||'')}</button>`;
        });
        html += `</div>`;
    }

    box.innerHTML = html;
}

function embeddedTwChangeStep(targetId, newStep){
    window.embeddedTwState = window.embeddedTwState || { currentStep:'start', history:[] };
    window.embeddedTwState.history.push(window.embeddedTwState.currentStep);
    window.embeddedTwState.currentStep = newStep;
    embeddedTwRender(targetId);
}
function embeddedTwBack(targetId){
    window.embeddedTwState = window.embeddedTwState || { currentStep:'start', history:[] };
    if(window.embeddedTwState.history.length){
        window.embeddedTwState.currentStep = window.embeddedTwState.history.pop();
        embeddedTwRender(targetId);
    }
}
function embeddedTwReset(targetId){
    window.embeddedTwState = { currentStep:'start', history:[] };
    embeddedTwRender(targetId);
}

/* -------------------------
   TEKNÄ°K KARTLAR (FULLSCREEN)
   - Eski kart gÃ¶rÃ¼nÃ¼mÃ¼ (liste)
   - DÃ¼zenleme, E-Tablo (Data) Ã¼zerinden (updateContent/addCard)
--------------------------*/

function __getTechCardsForUi(){
    return (database||[])
      .map((c, i)=>({ ...c, __dbIndex: i }))
      .filter(c=>String(c.category||'').toLowerCase()==='teknik' && String(c.status||'').toLowerCase()!=='pasif');
}

async function addTechCardSheet(){
    if(!isAdminMode) return;
    const { value: v } = await Swal.fire({
      title: 'Teknik Kart Ekle',
      html: `
        <input id="tc-title" class="swal2-input" placeholder="BaÅlÄ±k">
        <textarea id="tc-text" class="swal2-textarea" placeholder="AÃ§Ä±klama"></textarea>
        <textarea id="tc-script" class="swal2-textarea" placeholder="Script (opsiyonel)"></textarea>
        <input id="tc-link" class="swal2-input" placeholder="Link (opsiyonel)">
      `,
      showCancelButton: true,
      confirmButtonText: 'Ekle',
      cancelButtonText: 'VazgeÃ§',
      preConfirm: ()=>{
        const title = (document.getElementById('tc-title').value||'').trim();
        if(!title) return Swal.showValidationMessage('BaÅlÄ±k zorunlu');
        const today = new Date();
        const dateStr = today.getDate() + "." + (today.getMonth()+1) + "." + today.getFullYear();
        return {
          cardType: 'card',
          category: 'Teknik',
          title,
          text: (document.getElementById('tc-text').value||'').trim(),
          script: (document.getElementById('tc-script').value||'').trim(),
          code: '',
          link: (document.getElementById('tc-link').value||'').trim(),
          status: 'Aktif',
          date: dateStr
        };
      }
    });
    if(!v) return;

    Swal.fire({ title: 'Ekleniyor...', didOpen: () => Swal.showLoading(), showConfirmButton:false });
    try{
      const r = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'addCard', username: currentUser, token: getToken(), ...v })
      });
      const d = await r.json();
      if(d.result==='success'){
        Swal.fire({ icon:'success', title:'Eklendi', timer: 1200, showConfirmButton:false });
        await loadContentData();
        filterTechCards();
      }else{
        Swal.fire('Hata', d.message||'Eklenemedi', 'error');
      }
    }catch(e){
      Swal.fire('Hata','Sunucu hatasÄ±.','error');
    }
}

async function editTechCardSheet(dbIndex){
    if(!isAdminMode) return;
    const it = (database||[])[dbIndex];
    if(!it) return;
    const { value: v } = await Swal.fire({
      title: 'Teknik KartÄ± DÃ¼zenle',
      html: `
        <input id="tc-title" class="swal2-input" placeholder="BaÅlÄ±k" value="${escapeHtml(it.title||'')}">
        <textarea id="tc-text" class="swal2-textarea" placeholder="AÃ§Ä±klama">${escapeHtml(it.text||'')}</textarea>
        <textarea id="tc-script" class="swal2-textarea" placeholder="Script">${escapeHtml(it.script||'')}</textarea>
        <input id="tc-link" class="swal2-input" placeholder="Link" value="${escapeHtml(it.link||'')}">
      `,
      showCancelButton: true,
      confirmButtonText: 'Kaydet',
      cancelButtonText: 'VazgeÃ§',
      preConfirm: ()=>{
        const title = (document.getElementById('tc-title').value||'').trim();
        if(!title) return Swal.showValidationMessage('BaÅlÄ±k zorunlu');
        return {
          title,
          text: (document.getElementById('tc-text').value||'').trim(),
          script: (document.getElementById('tc-script').value||'').trim(),
          link: (document.getElementById('tc-link').value||'').trim(),
        };
      }
    });
    if(!v) return;
    const originalTitle = it.title;
    // sendUpdate sÄ±rayla update eder
    if(v.text !== (it.text||'')) sendUpdate(originalTitle, 'Text', v.text, 'card');
    setTimeout(()=>{ if(v.script !== (it.script||'')) sendUpdate(originalTitle, 'Script', v.script, 'card'); }, 350);
    setTimeout(()=>{ if(v.link !== (it.link||'')) sendUpdate(originalTitle, 'Link', v.link, 'card'); }, 700);
    setTimeout(()=>{ if(v.title !== originalTitle) sendUpdate(originalTitle, 'Title', v.title, 'card'); }, 1100);
}

function deleteTechCardSheet(dbIndex){
    if(!isAdminMode) return;
    const it = (database||[])[dbIndex];
    if(!it) return;
    Swal.fire({
      title:'Silinsin mi?',
      text:'Kart pasife alÄ±nacak.',
      icon:'warning',
      showCancelButton:true,
      confirmButtonText:'Sil',
      cancelButtonText:'VazgeÃ§'
    }).then(res=>{
      if(!res.isConfirmed) return;
      sendUpdate(it.title, 'Status', 'Pasif', 'card');
    });
}

function renderTechCardsTab(q=''){
    const box = document.getElementById('x-cards');
    if(!box) return;

    const query = String(q||'').trim().toLowerCase();
    const all = __getTechCardsForUi();
    const filtered = !query ? all : all.filter(c=>{
      const hay = `${c.title||''} ${c.text||''} ${c.script||''} ${c.link||''}`.toLowerCase();
      return hay.includes(query);
    });

    const bar = (isAdminMode && isEditingActive)
      ? `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
           <button class="x-btn x-btn-admin" onclick="addTechCardSheet()"><i class="fas fa-plus"></i> Kart Ekle</button>
         </div>`
      : ``;

    if(!filtered.length){
      box.innerHTML = bar + '<div style="opacity:.7;padding:16px">KayÄ±t bulunamadÄ±.</div>';
      return;
    }

    box.innerHTML = bar + filtered.map(c=>{
      const edit = (isAdminMode && isEditingActive)
        ? `<div style="display:flex;gap:8px;margin-top:10px">
             <button class="x-btn x-btn-admin" onclick="editTechCardSheet(${c.__dbIndex})"><i class="fas fa-pen"></i> DÃ¼zenle</button>
             <button class="x-btn x-btn-admin" onclick="deleteTechCardSheet(${c.__dbIndex})"><i class="fas fa-trash"></i> Sil</button>
           </div>`
        : ``;
      return `
        <div class="news-item" style="cursor:pointer" onclick="showCardDetail(${JSON.stringify({title:c.title,text:c.text||'',script:c.script||'',link:c.link||''}).replace(/</g,'\\u003c')})">
          <span class="news-title">${escapeHtml(c.title||'')}</span>
          <div class="news-desc" style="white-space:pre-line">${escapeHtml((c.text||'').slice(0,220))}${(c.text||'').length>220?'...':''}</div>
          ${(c.script||'') ? `<div class="script-box" style="margin-top:10px"><b>Script:</b><div style="margin-top:6px;white-space:pre-line">${escapeHtml((c.script||'').slice(0,220))}${(c.script||'').length>220?'...':''}</div><div style="text-align:right;margin-top:10px"><button class="btn btn-copy" onclick="event.stopPropagation(); copyText('${escapeForJsString(c.script||'')}')">Kopyala</button></div></div>`:''}
          ${edit}
        </div>
      `;
    }).join('');
}

function filterTechCards(){
    const inp = document.getElementById('x-cards-search');
    renderTechCardsTab(inp ? inp.value : '');
}


function applySportsRights(){
    if(!Array.isArray(sportsData) || sportsData.length===0) return;
    const rights = (window.sportRightsFromSheet && window.sportRightsFromSheet.length) ? window.sportRightsFromSheet : SPORTS_RIGHTS_FALLBACK;
    sportsData.forEach(s=>{
        const hay = `${s.title||''} ${s.desc||''} ${s.detail||''}`.toLowerCase();
        const hit = rights.find(r=>hay.includes(String(r.name||'').toLowerCase().replaceAll('*','').trim().split(' ')[0]));
        if(hit){
            const extra = `YayÄ±n hakkÄ± bitiÅ: ${hit.end || hit.duration}`;
            if(s.tip && !s.tip.includes('YayÄ±n hakkÄ±')) s.tip = `${s.tip} â¢ ${extra}`;
            else if(!s.tip) s.tip = extra;
            if(s.detail && !s.detail.includes('YayÄ±n hakkÄ±')) s.detail = `${s.detail}\n\n${extra}`;
            else if(!s.detail) s.detail = extra;
        }
    });
}

// Var olan veri yÃ¼klemesi bittikten sonra hak bilgisi ekle
const _orig_afterDataLoaded = window.afterDataLoaded;
window.afterDataLoaded = function(){
    try{ if(typeof _orig_afterDataLoaded==='function') _orig_afterDataLoaded(); }catch(e){}
    try{ applySportsRights(); }catch(e){}
};


// ======================
// TECH DOCS - SHEET BIND
// ======================
let __techDocsCache = null;
let __techDocsLoadedAt = 0;
let __techCatsCache = null;
let __techCatsLoadedAt = 0;

const TECH_TAB_LABELS = {
  broadcast: 'YayÄ±n',
  access: 'EriÅim SorunlarÄ±',
  app: 'App HatalarÄ±',
  activation: 'Aktivasyon',
  info: 'Bilgi',
  payment: 'Ãdeme SorunlarÄ±'
};

function __normalizeTechTab(tab){
  // tab ids: broadcast, access, app, activation
  return tab;
}
function __normalizeTechCategory(cat){
  const c = (cat||"").toString().trim().toLowerCase();
  if(c.startsWith("yay")) return "broadcast";
  if(c.startsWith("eri")) return "access";
  if(c.startsWith("app")) return "app";
  if(c.startsWith("akt")) return "activation";
  if(c.startsWith("bil")) return "info";
  if(c.startsWith("Ã¶de") || c.startsWith("ode") || c.includes("Ã¶deme") || c.includes("odeme")) return "payment";
  return "";
}

async function __fetchTechDocs(){
  if(!SCRIPT_URL){
    if(typeof showGlobalError === "function") showGlobalError("SCRIPT_URL ayarlÄ± deÄil. SaÄ alttan ayarlayabilirsin.");
    throw new Error("SCRIPT_URL missing");
  }
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "getTechDocs" })
  });
  const data = await res.json();
  if(data.result !== "success") throw new Error(data.message || "getTechDocs failed");
  const rows = Array.isArray(data.data) ? data.data : [];
  return rows
    .filter(r => (r.Durum||"").toString().trim().toLowerCase() !== "pasif")
    .map(r => ({
      categoryKey: __normalizeTechCategory(r.Kategori),
      kategori: (r.Kategori||"").trim(),
      baslik: (r.BaÅlÄ±k || r.Baslik || r.Title || r["BaÅlÄ±k"] || "").toString().trim(),
      icerik: (r.Ä°Ã§erik || r.Icerik || r.Content || r["Ä°Ã§erik"] || "").toString(),
      adim: (r.AdÄ±m || r.Adim || r.Step || r["AdÄ±m"] || "").toString(),
      not: (r.Not || "").toString(),
      link: (r.Link || "").toString(),
      durum: (r.Durum || "").toString()
    }))
    .filter(x => x.categoryKey && x.baslik);
}

async function __fetchTechDocCategories(){
  // K sÃ¼tunundan okunan kategori listesi (boÅsa A sÃ¼tunundan tÃ¼retilir)
  if(!SCRIPT_URL) return [];
  try{
    const r = await fetch(SCRIPT_URL, {
      method:'POST',
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body: JSON.stringify({ action: 'getTechDocCategories' })
    });
    const d = await r.json();
    if(d && d.result === 'success' && Array.isArray(d.categories)) return d.categories;
    return [];
  }catch(e){
    return [];
  }
}

async function getTechDocCategoryOptions(force=false){
  const now = Date.now();
  if(!force && __techCatsCache && (now-__techCatsLoadedAt) < 300000) return __techCatsCache; // 5dk
  const cats = await __fetchTechDocCategories();
  __techCatsCache = cats;
  __techCatsLoadedAt = now;
  return cats;
}

function __escapeHtml(s){
  return (s||"").toString().replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[m]));
}

function __renderTechList(tabKey, items){
  const listEl = document.getElementById(
    tabKey==="broadcast" ? "x-broadcast-list" :
    tabKey==="access" ? "x-access-list" :
    tabKey==="app" ? "x-app-list" :
    tabKey==="activation" ? "x-activation-list" :
    tabKey==="info" ? "x-info-list" :
    tabKey==="payment" ? "x-payment-list" : ""
  );
  if(!listEl) return;

  if(!items || items.length===0){
    listEl.innerHTML = `<div style="padding:16px;opacity:.75">Bu baÅlÄ±k altÄ±nda henÃ¼z iÃ§erik yok. (Sheet: Teknik_Dokumanlar)</div>`;
    return;
  }

  // Admin bar (dÃ¼zenleme global menÃ¼den aÃ§Ä±lÄ±r)
  const adminBar = (isAdminMode && isEditingActive)
    ? `<div style="display:flex;gap:10px;align-items:center;margin:0 0 12px;">
         <button class="x-btn x-btn-admin" onclick="addTechDoc('${tabKey}')"><i class=\"fas fa-plus\"></i> Yeni Konu Ekle</button>
       </div>`
    : ``;

  function render(filtered){
    listEl.innerHTML = adminBar + filtered.map((it, idx) => {
      const body = [
        it.icerik ? `<div class="q-doc-body">${it.icerik}</div>` : "",
        it.adim ? `<div class="q-doc-meta"><b>AdÄ±m:</b> ${__escapeHtml(it.adim)}</div>` : "",
        it.not ? `<div class="q-doc-meta"><b>Not:</b> ${__escapeHtml(it.not)}</div>` : "",
        it.link ? `<div class="q-doc-meta"><b>Link:</b> <a href="${__escapeHtml(it.link)}" target="_blank">${__escapeHtml(it.link)}</a></div>` : ""
      ].join("");
      const adminBtns = (isAdminMode && isEditingActive)
        ? `<span style="float:right;display:inline-flex;gap:8px" onclick="event.stopPropagation();event.preventDefault();">
             <button class="x-btn x-btn-admin" style="padding:6px 10px" onclick="editTechDoc('${tabKey}','${escapeForJsString(it.baslik)}')"><i class=\"fas fa-pen\"></i></button>
             <button class="x-btn x-btn-admin" style="padding:6px 10px" onclick="deleteTechDoc('${tabKey}','${escapeForJsString(it.baslik)}')"><i class=\"fas fa-trash\"></i></button>
           </span>`
        : ``;
      return `
        <details class="q-accordion" style="margin-bottom:10px;background:#fff;border-radius:12px;border:1px solid rgba(0,0,0,.08);padding:10px 12px">
          <summary style="cursor:pointer;font-weight:800">${__escapeHtml(it.baslik)}${adminBtns}</summary>
          <div style="padding:10px 2px 2px 2px">${body}</div>
        </details>
      `;
    }).join("");
  }

  render(items);
}

async function loadTechDocsIfNeeded(force=false){
  const now = Date.now();
  if(!force && __techDocsCache && (now-__techDocsLoadedAt)<120000) return __techDocsCache; // 2dk cache
  try{
    const rows = await __fetchTechDocs();
    __techDocsCache = rows;
    __techDocsLoadedAt = now;
    return rows;
  }catch(e){
    console.error("[TECH DOCS]", e);
    return [];
  }
}

// Teknik fullscreen Ã¼st arama kutularÄ± (index.html) iÃ§in
async function filterTechDocList(tabKey){
  try{
    const input = document.getElementById(`x-${tabKey}-search`);
    const q = (input ? input.value : '').toLowerCase().trim();
    const all = await loadTechDocsIfNeeded(false);
    const scoped = all.filter(x => x.categoryKey === tabKey);
    const filtered = !q ? scoped : scoped.filter(x =>
      (x.baslik||'').toLowerCase().includes(q) ||
      (x.icerik||'').toLowerCase().includes(q) ||
      (x.adim||'').toLowerCase().includes(q) ||
      (x.not||'').toLowerCase().includes(q)
    );
    __renderTechList(tabKey, filtered);
  }catch(e){
    console.error(e);
  }
}

// Teknik_Dokumanlar kategori listesi (Sheet K sÃ¼tunu)
let __techCategoryOptions = null;
async function loadTechCategoryOptions(){
  if(__techCategoryOptions) return __techCategoryOptions;
  try{
    const r = await fetch(SCRIPT_URL, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({ action:'getTechDocCategories' })
    });
    const d = await r.json();
    if(d && d.result==='success' && Array.isArray(d.categories)){
      __techCategoryOptions = d.categories.filter(Boolean);
      return __techCategoryOptions;
    }
  }catch(e){ console.error('[TECH CATS]', e); }
  __techCategoryOptions = [];
  return __techCategoryOptions;
}

function techTabLabel(tabKey){
  const m = { broadcast:'YayÄ±n', access:'EriÅim SorunlarÄ±', app:'App HatalarÄ±', activation:'Aktivasyon', info:'Bilgi', payment:'Ãdeme SorunlarÄ±' };
  return m[tabKey] || 'YayÄ±n';
}

// ---------------------------
// TECH DOCS (Sheet) - Admin CRUD
// ---------------------------
async function addTechDoc(tabKey){
  if(!isAdminMode) return;
  const cats = await getTechDocCategoryOptions(false);
  const defaultLabel = TECH_TAB_LABELS[tabKey] || '';
  const opts = (cats && cats.length ? cats : Object.values(TECH_TAB_LABELS))
    .map(c=>String(c||'').trim()).filter(Boolean);
  const uniq = Array.from(new Set(opts.map(x=>x.toLowerCase()))).map(k=>opts.find(x=>x.toLowerCase()===k));
  const optionsHtml = uniq.map(c=>`<option value="${__escapeHtml(c)}" ${c===defaultLabel?'selected':''}>${__escapeHtml(c)}</option>`).join('');
  const { value: v } = await Swal.fire({
    title: 'Teknik Konu Ekle',
    html: `
      <select id="td-cat" class="swal2-select" style="width:100%;max-width:420px">
        ${optionsHtml}
      </select>
      <input id="td-title" class="swal2-input" placeholder="BaÅlÄ±k">
      <textarea id="td-content" class="swal2-textarea" placeholder="Ä°Ã§erik"></textarea>
      <input id="td-step" class="swal2-input" placeholder="AdÄ±m (opsiyonel)">
      <input id="td-note" class="swal2-input" placeholder="Not (opsiyonel)">
      <input id="td-link" class="swal2-input" placeholder="Link (opsiyonel)">
    `,
    showCancelButton:true,
    confirmButtonText:'Ekle',
    cancelButtonText:'VazgeÃ§',
    preConfirm: ()=>{
      const cat = (document.getElementById('td-cat')?.value || defaultLabel || '').trim();
      if(!cat) return Swal.showValidationMessage('Kategori zorunlu');
      const title = (document.getElementById('td-title').value||'').trim();
      if(!title) return Swal.showValidationMessage('BaÅlÄ±k zorunlu');
      return {
        kategori: cat,
        baslik: title,
        icerik: (document.getElementById('td-content').value||'').trim(),
        adim: (document.getElementById('td-step').value||'').trim(),
        not: (document.getElementById('td-note').value||'').trim(),
        link: (document.getElementById('td-link').value||'').trim(),
        durum: 'Aktif'
      };
    }
  });
  if(!v) return;

  Swal.fire({ title:'Ekleniyor...', didOpen:()=>Swal.showLoading(), showConfirmButton:false });
  try{
    const r = await fetch(SCRIPT_URL, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({ action:'upsertTechDoc', username: currentUser, token: getToken(), keyKategori:'', keyBaslik:'', ...v })
    });
    const d = await r.json();
    if(d.result==='success'){
      Swal.fire({ icon:'success', title:'Eklendi', timer:1200, showConfirmButton:false });
      await loadTechDocsIfNeeded(true);
      filterTechDocList(tabKey);
    }else{
      Swal.fire('Hata', d.message||'Eklenemedi', 'error');
    }
  }catch(e){
    Swal.fire('Hata','Sunucu hatasÄ±.', 'error');
  }
}

async function editTechDoc(tabKey, baslik){
  if(!isAdminMode) return;
  const all = await loadTechDocsIfNeeded(false);
  const it = all.find(x=>x.categoryKey===tabKey && (x.baslik||'')===baslik);
  if(!it) return;
  const cats = await getTechDocCategoryOptions(false);
  const opts = (cats && cats.length ? cats : Object.values(TECH_TAB_LABELS))
    .map(c=>String(c||'').trim()).filter(Boolean);
  const uniq = Array.from(new Set(opts.map(x=>x.toLowerCase()))).map(k=>opts.find(x=>x.toLowerCase()===k));
  const optionsHtml = uniq.map(c=>`<option value="${__escapeHtml(c)}" ${(c===it.kategori)?'selected':''}>${__escapeHtml(c)}</option>`).join('');
  const { value: v } = await Swal.fire({
    title: 'Teknik Konuyu DÃ¼zenle',
    html: `
      <select id="td-cat" class="swal2-select" style="width:100%;max-width:420px">
        ${optionsHtml}
      </select>
      <input id="td-title" class="swal2-input" placeholder="BaÅlÄ±k" value="${__escapeHtml(it.baslik||'')}">
      <textarea id="td-content" class="swal2-textarea" placeholder="Ä°Ã§erik">${__escapeHtml(it.icerik||'')}</textarea>
      <input id="td-step" class="swal2-input" placeholder="AdÄ±m" value="${__escapeHtml(it.adim||'')}">
      <input id="td-note" class="swal2-input" placeholder="Not" value="${__escapeHtml(it.not||'')}">
      <input id="td-link" class="swal2-input" placeholder="Link" value="${__escapeHtml(it.link||'')}">
    `,
    showCancelButton:true,
    confirmButtonText:'Kaydet',
    cancelButtonText:'VazgeÃ§',
    preConfirm: ()=>{
      const cat = (document.getElementById('td-cat')?.value || it.kategori || '').trim();
      if(!cat) return Swal.showValidationMessage('Kategori zorunlu');
      const title = (document.getElementById('td-title').value||'').trim();
      if(!title) return Swal.showValidationMessage('BaÅlÄ±k zorunlu');
      return {
        kategori: cat,
        baslik: title,
        icerik: (document.getElementById('td-content').value||'').trim(),
        adim: (document.getElementById('td-step').value||'').trim(),
        not: (document.getElementById('td-note').value||'').trim(),
        link: (document.getElementById('td-link').value||'').trim(),
        durum: 'Aktif'
      };
    }
  });
  if(!v) return;

  Swal.fire({ title:'Kaydediliyor...', didOpen:()=>Swal.showLoading(), showConfirmButton:false });
  try{
    const r = await fetch(SCRIPT_URL, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({ action:'upsertTechDoc', username: currentUser, token: getToken(), keyKategori: it.kategori, keyBaslik: it.baslik, ...v })
    });
    const d = await r.json();
    if(d.result==='success'){
      Swal.fire({ icon:'success', title:'Kaydedildi', timer:1200, showConfirmButton:false });
      await loadTechDocsIfNeeded(true);
      filterTechDocList(tabKey);
    }else{
      Swal.fire('Hata', d.message||'Kaydedilemedi', 'error');
    }
  }catch(e){
    Swal.fire('Hata','Sunucu hatasÄ±.', 'error');
  }
}

function deleteTechDoc(tabKey, baslik){
  if(!isAdminMode) return;
  Swal.fire({
    title:'Silinsin mi?',
    text:'Konu pasife alÄ±nacak.',
    icon:'warning',
    showCancelButton:true,
    confirmButtonText:'Sil',
    cancelButtonText:'VazgeÃ§'
  }).then(async res=>{
    if(!res.isConfirmed) return;
    try{
      const all = await loadTechDocsIfNeeded(false);
      const it = all.find(x=>x.categoryKey===tabKey && (x.baslik||'')===baslik);
      const keyKategori = it ? it.kategori : tabKey;
      const r = await fetch(SCRIPT_URL, {
        method:'POST',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body: JSON.stringify({ action:'deleteTechDoc', username: currentUser, token: getToken(), keyKategori: keyKategori, keyBaslik: baslik })
      });
      const d = await r.json();
      if(d.result==='success'){
        await loadTechDocsIfNeeded(true);
        filterTechDocList(tabKey);
        Swal.fire({ icon:'success', title:'Silindi', timer:1000, showConfirmButton:false });
      }else{
        Swal.fire('Hata', d.message||'Silinemedi', 'error');
      }
    }catch(e){
      Swal.fire('Hata','Sunucu hatasÄ±.', 'error');
    }
  });
}

// override / extend existing switchTechTab
window.switchTechTab = async function(tab){
  try{
    // existing visual tab switch
    document.querySelectorAll('#tech-fullscreen .q-nav-item').forEach(li => li.classList.remove('active'));
    const tabMap = {broadcast:'x-view-broadcast',access:'x-view-access',app:'x-view-app',activation:'x-view-activation',info:'x-view-info',payment:'x-view-payment',wizard:'x-view-wizard',cards:'x-view-cards'};
    const viewId = tabMap[tab];
    // activate clicked item
    const items = Array.from(document.querySelectorAll('#tech-fullscreen .q-nav-menu .q-nav-item'));
    const idx = ['broadcast','access','app','activation','payment','info','wizard','cards'].indexOf(tab);
    if(idx>=0 && items[idx]) items[idx].classList.add('active');

    document.querySelectorAll('#tech-fullscreen .q-view-section').forEach(v => v.classList.remove('active'));
    const viewEl = document.getElementById(viewId);
    if(viewEl) viewEl.classList.add('active');

    if(['broadcast','access','app','activation','payment','info'].includes(tab)){
      const all = await loadTechDocsIfNeeded(false);
      const filtered = all.filter(x => x.categoryKey === tab);
      __renderTechList(tab, filtered);
    }

    if(tab === 'wizard'){
      // Teknik sihirbazÄ± fullscreen iÃ§ine gÃ¶m
      try{ renderTechWizardInto('x-wizard'); }catch(e){ console.error(e); }
    }

    if(tab === 'cards'){
      try{ filterTechCards(); }catch(e){ console.error(e); }
    }
  }catch(e){
    console.error(e);
  }
};

// expose for onclick
try{ window.openMenuPermissions = openMenuPermissions; }catch(e){}
