const BAKIM_MODU = false;

function showGlobalError(message){
  // Kullanıcılara kırmızı bant gösterme (istek: ekran temiz kalsın)
  // Sadece konsola yaz ve (locadmin/admin ise) küçük bir toast göster.
  try{ console.warn("[Pusula]", message); }catch(e){}
  try{
    const role = localStorage.getItem("sSportRole")||"";
    if(role==="admin" || role==="locadmin"){
      Swal.fire({toast:true,position:'bottom-end',icon:'warning',title:String(message||'Uyarı'),showConfirmButton:false,timer:2500});
    }
  }catch(e){}
}

// Apps Script URL'si
let SCRIPT_URL = localStorage.getItem("PUSULA_SCRIPT_URL") || "https://script.google.com/macros/s/AKfycbz6dDFHv-49h-13EwNPVCqpj-H4xjRqNpkz1JPvkixDkOkM_AUyN2cgYpH7-j9a5Tg/exec"; // Apps Script Web App URL

// ---- API CALL helper (Menu/Yetki vs için gerekli) ----
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

// SweetAlert2 yoksa minimal yedek (sessiz kırılma olmasın)
if (typeof Swal === "undefined") {
  window.Swal = { 
    fire: (a,b,c)=>{ try{ alert((a&&a.title)||a||b||c||""); }catch(e){} },
  };
}



// Oyun Değişkenleri
let jokers = { call: 1, half: 1, double: 1 };
let doubleChanceUsed = false;
let firstAnswerIndex = -1;
const VALID_CATEGORIES = ['Teknik', 'İkna', 'Kampanya', 'Bilgi'];
const MONTH_NAMES = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
// --- GLOBAL DEĞİŞKENLER ---
let database = [], cardsData = [], newsData = [], sportsData = [], salesScripts = [], quizQuestions = [], quickDecisionQuestions = [];

// Data load barrier (prevents Tech/Telesales first-render flicker)
let __dataLoadedResolve;
window.__dataLoadedPromise = new Promise(r=>{ __dataLoadedResolve = r; });
let techWizardData = {}; // Teknik Sihirbaz Verisi
let currentUser = "";

// -------------------- Menu Permissions (LocAdmin) --------------------
let menuPermissions = null; // { key: {allowedGroups:[], allowedRoles:[]} }

// -------------------- HomeBlocks (Ana Sayfa blok içerikleri) --------------------
let homeBlocks = {}; // { quote:{...}, ... }

function loadHomeBlocks(){
  // herkes için okunabilir (sheet'ten)
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
  const tr = s.replaceAll('ş','s').replaceAll('Ş','s')
              .replaceAll('ı','i').replaceAll('İ','i')
              .replaceAll('ğ','g').replaceAll('Ğ','g')
              .replaceAll('ü','u').replaceAll('Ü','u')
              .replaceAll('ö','o').replaceAll('Ö','o')
              .replaceAll('ç','c').replaceAll('Ç','c');
  // map common variants to display names used in permissions table
  if(tr.includes('telesat')) return 'Telesatış';
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
  // "ALL" varsa herkese açık kabul et
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
    // Hızlı kısayollar (ana sayfa)
    document.querySelectorAll('[data-shortcut-key]').forEach(el=>{
      const key=el.getAttribute('data-shortcut-key');
      const perm = menuPermissions && menuPermissions[key];
      el.style.display = isAllowedByPerm(perm) ? '' : 'none';
    });
  }catch(e){}
}
function loadMenuPermissions(){
  // herkes için okunabilir
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
  // İstek: Yetki Yönetimi sadece LocAdmin rolünde görünsün ve çalışsın
  if(role!=="locadmin"){
    Swal.fire("Yetkisiz", "Yetki Yönetimi sadece LocAdmin rolünde kullanılabilir.", "warning");
    return;
  }
  apiCall("getMenuPermissions",{}).then(res=>{
    if(!res || res.result!=="success"){
      Swal.fire("Hata","Yetkiler okunamadı","error");
      return;
    }

    // Grupları backend'den al, yoksa items içinden türet
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
    // Hepsini baş harf büyüt, yaygın isimleri normalize et
    const normMap={"chat":"Chat","telesatış":"Telesatış","telesatis":"Telesatış","yönetim":"Yönetim","yonetim":"Yönetim","teknik":"Teknik"};
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
        Menü/sekme bazlı “hangi grup görsün” ayarı. İşaretli olmayan gruplar menüyü görmez.
      </div>
      <div style="max-height:420px;overflow:auto;border:1px solid rgba(0,0,0,.08);border-radius:12px">
        <table style="width:100%;border-collapse:collapse">
          <thead style="position:sticky;top:0;background:#f7f7f7;z-index:1">
            <tr>
              <th style="text-align:left;padding:12px">Menü</th>
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
      title: "Yetki Yönetimi",
      html: tableHtml,
      width: 980,
      showCancelButton: true,
      confirmButtonText: "Kaydet",
      cancelButtonText: "Vazgeç",
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
        // Hepsi seçiliyse "ALL" olarak yaz (daha temiz)
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
          Swal.fire("Kaydedildi","Yetkiler güncellendi.","success");
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
// YENİ: Chart instance'ı tutmak için
let dashboardChart = null;
// YENİ: Feedback Log Verisi (Manuel kayıt detayları için)
let feedbackLogsData = [];
// ==========================================================
// --- KALİTE PUANLAMA LOGİĞİ: CHAT (BUTON TABANLI) ---
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
// --- KALİTE PUANLAMA LOGİĞİ: TELE SATIŞ (SLIDER TABANLI) ---
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
// --- YARDIMCI FONKSİYONLAR ---
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
        Swal.fire({toast:true, position:'top-end', icon: added ? 'success' : 'info', title: added ? 'Favorilere eklendi' : 'Favorilerden kaldırıldı', showConfirmButton:false, timer:1200});
    } catch(e) {}

    if (currentCategory === 'fav') { filterCategory(document.querySelector('.btn-fav'), 'fav'); } 
    else { renderCards(activeCards); }
    try { updateSearchResultCount(activeCards.length || 0, database.length); } catch(e) {}
}
function isFav(title) { return getFavs().includes(title); }
function formatDateToDDMMYYYY(dateString) {
    if (!dateString) return 'N/A';
    // Eğer format dd.MM.yyyy olarak geliyorsa direkt dön
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
        // GG.AA.YYYY -> YYYY-AA-GG formatına çevir
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
    // navigator.clipboard.writeText yerine execCommand kullanıldı (iFrame uyumluluğu için)
    const textarea = document.createElement('textarea');
    textarea.value = t.replace(/\\n/g, '\n');
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        Swal.fire({icon:'success', title:'Kopyalandı', toast:true, position:'top-end', showConfirmButton:false, timer:1500});
    } catch (err) {
        Swal.fire({icon:'error', title:'Kopyalanamadı', text:'Lütfen manuel kopyalayın.', toast:true, position:'top-end', showConfirmButton:false, timer:2500});
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

    if (savedUser && savedToken) {
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

        // ✅ YENİ: Yenilemede de menü/blok yetkilerini uygula
        try{ loadMenuPermissions(); }catch(e){}
        try{ loadHomeBlocks(); }catch(e){}

        if (BAKIM_MODU) {
            document.getElementById("maintenance-screen").style.display = "flex";
        } else {
            document.getElementById("main-app").style.display = "block";

            loadContentData();
            loadWizardData();
            loadTechWizardData();

            // Eğer qusers rolündeyse, ana içeriği gizle ve kalite modülünü aç
            if (savedRole === 'qusers') {
                const grid = document.getElementById('cardGrid'); if (grid) grid.style.display = 'none';
                const controls = document.querySelector('.control-wrapper'); if (controls) controls.style.display = 'none';
                const ticker = document.querySelector('.news-ticker-box'); if (ticker) ticker.style.display = 'none';

                openQualityArea(); // Yeni Full Screen Modül
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
    if(!uName || !uPass) { errorMsg.innerText = "Lütfen bilgileri giriniz."; errorMsg.style.display = "block"; return; }
    
    loadingMsg.style.display = "block";
    loadingMsg.innerText = "Doğrulanıyor...";
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
            
            const savedRole = data.role;
            if (data.forceChange === true) {
                Swal.fire({
                    icon: 'warning', title: ' ⚠️  Güvenlik Uyarısı',
                    text: 'İlk girişiniz. Lütfen şifrenizi değiştirin.',
                    allowOutsideClick: false, allowEscapeKey: false, confirmButtonText: 'Şifremi Değiştir'
                }).then(() => { changePasswordPopup(true); });
            } else {
                document.getElementById("login-screen").style.display = "none";
                document.getElementById("user-display").innerText = currentUser;
                setHomeWelcomeUser(currentUser);
                const savedGroup = data.group || localStorage.getItem('sSportGroup') || '';
                checkAdmin(savedRole);
                startSessionTimer();
                // Menü yetkilerini ve ana sayfa bloklarını login sonrası yükle
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
            errorMsg.innerText = data.message || "Hatalı giriş!";
            errorMsg.style.display = "block";
        }
    }).catch(error => {
        loadingMsg.style.display = "none";
        document.querySelector('.login-btn').disabled = false;
        errorMsg.innerText = "Sunucu hatası! Lütfen sayfayı yenileyin.";
        errorMsg.style.display = "block";
    });
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
        if (searchInput) { searchInput.disabled = true; searchInput.placeholder = "Arama devre dışı (Kalite Modu)"; searchInput.style.opacity = '0.6'; }
    } else {
        filterButtons.forEach(btn => {
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
            btn.style.filter = 'none';
        });
        const searchInput = document.getElementById('searchInput');
        if (searchInput) { searchInput.disabled = false; searchInput.placeholder = "İçeriklerde hızlı ara..."; searchInput.style.opacity = '1'; }
    }
    
    if(isAdminMode) {
        if(addCardDropdown) addCardDropdown.style.display = 'flex';
        if(quickEditDropdown) {
            quickEditDropdown.style.display = 'flex';
            // İstek: Yetki Yönetimi sadece LocAdmin rolünde görünsün
            const perms = document.getElementById('dropdownPerms');
            if(perms) perms.style.display = (isLocAdmin ? 'flex' : 'none');
            quickEditDropdown.innerHTML = '<i class="fas fa-pen" style="color:var(--secondary);"></i> Düzenlemeyi Aç';
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
    localStorage.removeItem("sSportUser"); localStorage.removeItem("sSportToken"); localStorage.removeItem("sSportRole");
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
        Swal.fire({ icon: 'warning', title: 'Oturum Süresi Doldu', text: 'Güvenlik nedeniyle otomatik çıkış yapıldı.', confirmButtonText: 'Tamam' }).then(() => { logout(); });
    },  28800000); 
}
function openUserMenu() { toggleUserDropdown(); }
async function changePasswordPopup(isMandatory = false) {
    const { value: formValues } = await Swal.fire({
        title: isMandatory ? 'Yeni Şifre Belirleyin' : 'Şifre Değiştir',
        html: `${isMandatory ? '<p style="font-size:0.9rem; color:#d32f2f;">İlk giriş şifrenizi değiştirmeden devam edemezsiniz.</p>' : ''}<input id="swal-old-pass" type="password" class="swal2-input" placeholder="Eski Şifre (Mevcut)"><input id="swal-new-pass" type="password" class="swal2-input" placeholder="Yeni Şifre">`,
        focusConfirm: false, showCancelButton: !isMandatory, allowOutsideClick: !isMandatory, allowEscapeKey: !isMandatory,
        confirmButtonText: 'Değiştir', cancelButtonText: 'İptal',
        preConfirm: () => {
            const o = document.getElementById('swal-old-pass').value;
            const n = document.getElementById('swal-new-pass').value;
            if(!o || !n) { Swal.showValidationMessage('Alanlar boş bırakılamaz'); }
            return [ o, n ]
        }
    });
    if (formValues) {
        Swal.fire({ title: 'İşleniyor...', didOpen: () => { Swal.showLoading() } });
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
                Swal.fire('Başarılı!', 'Şifreniz güncellendi. Yeniden giriş yapınız.', 'success').then(() => { logout(); });
            } else {
                Swal.fire('Hata', data.message || 'İşlem başarısız.', 'error').then(() => { if(isMandatory) changePasswordPopup(true); });
            }
        }).catch(err => { Swal.fire('Hata', 'Sunucu hatası.', 'error'); if(isMandatory) changePasswordPopup(true); });
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
            // Yeni eklenenleri üstte göstermek için tarihe göre (azalan) sırala
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
            // Hızlı Karar soruları (Google Sheet'ten): Type = quickdecision
            // Beklenen: Text | QuizOptions (| ile ayrılmış) | QuizAnswer (0-based index) | Detail (opsiyonel)
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
        } else { document.getElementById('loading').innerHTML = `Veriler alınamadı: ${data.message || 'Bilinmeyen Hata'}`; }
    }).catch(error => { document.getElementById('loading').innerHTML = 'Bağlantı Hatası! Sunucuya ulaşılamıyor.'; }).finally(()=>{ try{ __dataLoadedResolve && __dataLoadedResolve(); }catch(e){} });
            cardsData = database; // geriye dönük uyumluluk

}
function loadWizardData() {
    return new Promise((resolve, reject) => {
        fetch(SCRIPT_URL, {
            method: 'POST', headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "getWizardData" })
        }).then(response => response.json()).then(data => {
            if (data.result === "success" && data.steps) { wizardStepsData = data.steps; resolve(); } 
            else { wizardStepsData = {}; reject(new Error("Wizard verisi yüklenemedi.")); }
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
    
    if (data.length === 0) { container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#777;">Kayıt bulunamadı.</div>'; return; }
    data.forEach((item, index) => {
        const safeTitle = escapeForJsString(item.title);
        const isFavorite = isFav(item.title);
        const favClass = isFavorite ? 'fas fa-star active' : 'far fa-star';
        const newBadge = isNew(item.date) ? '<span class="new-badge">YENİ</span>' : '';
        const editIconHtml = (isAdminMode && isEditingActive) ? `<i class="fas fa-pencil-alt edit-icon" onclick="editContent(${index})" style="display:block;"></i>` : '';
        let formattedText = (item.text || "").replace(/\n/g, '<br>').replace(/\*(.*?)\*/g, '<b>$1</b>');
        
        container.innerHTML += `<div class="card ${item.category}">${newBadge}
            <div class="icon-wrapper">${editIconHtml}<i class="${favClass} fav-icon" onclick="toggleFavorite('${safeTitle}')"></i></div>
            <div class="card-header"><h3 class="card-title">${highlightText(item.title)}</h3><span class="badge">${item.category}</span></div>
            <div class="card-content" onclick="showCardDetail('${safeTitle}', '${escapeForJsString(item.text)}')">
                <div class="card-text-truncate">${highlightText(formattedText)}</div>
                <div style="font-size:0.8rem; color:#999; margin-top:5px; text-align:right;">(Tamamını oku)</div>
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
    // sadece arama yazıldığında veya filtre fav/tekil seçildiğinde göster
    const search = (document.getElementById('searchInput')?.value || '').trim();
    const show = !!search || (currentCategory && currentCategory !== 'all');
    if(!show) { el.style.display = 'none'; el.innerText = ''; return; }
    el.style.display = 'block';
    el.innerText = `🔎 ${count} sonuç${total != null ? ' / ' + total : ''}`;
}



function filterCategory(btn, cat) {
    // Ana Sayfa özel ekran
    if (cat === "home") {
        currentCategory = "home";
        setActiveFilterButton(btn);
        showHomeScreen();
        return;
    }


    // Tam ekran modüller
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
        // kalite için mevcut davranış: card list (varsa) - burada özel modül yoksa devam
    }
    currentCategory = cat;
    hideHomeScreen();

    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterContent();
}
function filterContent() {
    const search = document.getElementById('searchInput').value.toLocaleLowerCase('tr-TR').trim();
    // Ana sayfa (home) özel ekran:
    // - Arama boşsa ana sayfa kartları görünür (home-screen)
    // - Arama yapılırsa ana sayfadan çıkıp kartlar üzerinde filtre uygulanır
    if (currentCategory === 'home') {
        if (!search) {
            updateSearchResultCount(database.length, database.length);
            showHomeScreen();
            return;
        }
        // Arama varsa: home ekranını gizle ve tüm kartlar içinde ara
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
    // Geriye dönük uyumluluk: showCardDetail(cardObj) çağrısını da destekle
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
                <span class="tech-script-label">Müşteriye iletilecek:</span>${escapeHtml(script).replace(/\n/g,'<br>')}
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
        btn.innerHTML = '<i class="fas fa-times" style="color:var(--accent);"></i> Düzenlemeyi Kapat';
        Swal.fire({ icon: 'success', title: 'Düzenleme Modu AÇIK', text: 'Kalem ikonlarına tıklayarak içerikleri düzenleyebilirsiniz.', timer: 1500, showConfirmButton: false });
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fas fa-pen" style="color:var(--secondary);"></i> Düzenlemeyi Aç';
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
            Swal.fire({icon: 'success', title: 'Başarılı', timer: 1500, showConfirmButton: false});
            setTimeout(loadContentData, 1600);
        } else { Swal.fire('Hata', 'Kaydedilemedi: ' + (data.message || 'Bilinmeyen Hata'), 'error'); }
    }).catch(err => Swal.fire('Hata', 'Sunucu hatası.', 'error'));
}
// --- CRUD OPERASYONLARI (ADMIN) ---
async function addNewCardPopup() {
    const catSelectHTML = getCategorySelectHtml('Bilgi', 'swal-new-cat');
    const { value: formValues } = await Swal.fire({
        title: 'Yeni İçerik Ekle',
        html: `
        <div style="margin-bottom:15px; text-align:left;">
            <label style="font-weight:bold; font-size:0.9rem;">Ne Ekleyeceksin?</label>
            <select id="swal-type-select" class="swal2-input" style="width:100%; margin-top:5px; height:35px; font-size:0.9rem;" onchange="toggleAddFields()">
                <option value="card"> 📌  Bilgi Kartı</option>
                <option value="news"> 📢  Duyuru</option>
                <option value="sales"> 📞  Telesatış Scripti</option>
                <option value="sport"> 🏆  Spor İçeriği</option>
                <option value="quiz"> ❓  Quiz Sorusu</option>
            </select>
        </div>
        <div id="preview-card" class="card Bilgi" style="text-align:left; box-shadow:none; border:1px solid #e0e0e0; margin-top:10px;">
            <div class="card-header" style="align-items: center; gap: 10px;">
                <input id="swal-new-title" class="swal2-input" style="margin:0; height:40px; flex-grow:1; border:none; border-bottom:2px solid #eee; padding:0 5px; font-weight:bold; color:#0e1b42;" placeholder="Başlık Giriniz...">
                <div id="cat-container" style="width: 110px;">${catSelectHTML}</div>
            </div>
            <div class="card-content" style="margin-bottom:10px;">
                <textarea id="swal-new-text" class="swal2-textarea" style="margin:0; width:100%; box-sizing:border-box; border:none; resize:none; font-family:inherit; min-height:100px; padding:10px; background:#f9f9f9;" placeholder="İçerik metni..."></textarea>
            </div>
            <div id="script-container" class="script-box" style="padding:0; border:1px solid #f0e68c;">
                <textarea id="swal-new-script" class="swal2-textarea" style="margin:0; width:100%; box-sizing:border-box; border:none; background:transparent; font-style:italic; min-height:80px; font-size:0.9rem;" placeholder="Script metni (İsteğe bağlı)..."></textarea>
            </div>
            <div id="extra-container" class="card-actions" style="margin-top:15px; display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <div style="position:relative;"><i class="fas fa-code" style="position:absolute; left:10px; top:10px; color:#aaa;"></i><input id="swal-new-code" class="swal2-input" style="margin:0; height:35px; font-size:0.85rem; padding-left:30px;" placeholder="Kod"></div>
                <div style="position:relative;"><i class="fas fa-link" style="position:absolute; left:10px; top:10px; color:#aaa;"></i><input id="swal-new-link" class="swal2-input" style="margin:0; height:35px; font-size:0.85rem; padding-left:30px;" placeholder="Link"></div>
            </div>
            <div id="sport-extra" style="display:none; padding:10px;">
                <label style="font-weight:bold;">Kısa Açıklama (Desc)</label><input id="swal-sport-tip" class="swal2-input" placeholder="Kısa İpucu/Tip">
                <label style="font-weight:bold;">Detaylı Metin (Detail)</label><input id="swal-sport-detail" class="swal2-input" placeholder="Detaylı Açıklama (Alt Metin)">
                <label style="font-weight:bold;">Okunuşu (Pronunciation)</label><input id="swal-sport-pron" class="swal2-input" placeholder="Okunuşu">
                <label style="font-weight:bold;">İkon Sınıfı (Icon)</label><input id="swal-sport-icon" class="swal2-input" placeholder="FontAwesome İkon Sınıfı (e.g., fa-futbol)">
            </div>
            <div id="news-extra" style="display:none; padding:10px;">
                <label style="font-weight:bold;">Duyuru Tipi</label><select id="swal-news-type" class="swal2-input"><option value="info">Bilgi</option><option value="update">Değişiklik</option><option value="fix">Çözüldü</option></select>
                <label style="font-weight:bold;">Durum</label><select id="swal-news-status" class="swal2-input"><option value="Aktif">Aktif</option><option value="Pasif">Pasif (Gizle)</option></select>
            </div>
            <div id="quiz-extra" style="display:none; padding:10px;">
                <label style="font-weight:bold;">Soru Metni (Text)</label><textarea id="swal-quiz-q" class="swal2-textarea" placeholder="Quiz sorusu..."></textarea>
                <label style="font-weight:bold;">Seçenekler (Virgülle Ayırın)</label><input id="swal-quiz-opts" class="swal2-input" placeholder="Örn: şık A,şık B,şık C,şık D">
                <label style="font-weight:bold;">Doğru Cevap İndeksi</label><input id="swal-quiz-ans" type="number" class="swal2-input" placeholder="0 (A), 1 (B), 2 (C) veya 3 (D)" min="0" max="3">
            </div>
        </div>`,
        width: '700px', showCancelButton: true, confirmButtonText: '<i class="fas fa-plus"></i> Ekle', cancelButtonText: 'İptal', focusConfirm: false,
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
                    document.getElementById('swal-new-title').placeholder = "Başlık Giriniz..."; document.getElementById('swal-new-text').placeholder = "İçerik metni...";
                } else if (type === 'sales') {
                    scriptCont.style.display = 'block';
                    document.getElementById('swal-new-script').placeholder = "Satış Metni...";
                    cardPreview.style.borderLeft = "5px solid var(--sales)";
                    document.getElementById('swal-new-title').placeholder = "Script Başlığı..."; document.getElementById('swal-new-text').placeholder = "Sadece buraya metin girilecek.";
                } else if (type === 'sport') {
                    sportExtra.style.display = 'block';
                    cardPreview.style.borderLeft = "5px solid var(--primary)";
                    document.getElementById('swal-new-title').placeholder = "Spor Terimi Başlığı..."; document.getElementById('swal-new-text').placeholder = "Kısa Açıklama (Desc)...";
                } else if (type === 'news') {
                    newsExtra.style.display = 'block';
                    cardPreview.style.borderLeft = "5px solid var(--secondary)";
                    document.getElementById('swal-new-title').placeholder = "Duyuru Başlığı..."; document.getElementById('swal-new-text').placeholder = "Duyuru Metni (Desc)...";
                } else if (type === 'quiz') {
                    quizExtra.style.display = 'block';
                    document.getElementById('swal-new-title').placeholder = "Quiz Başlığı (Örn: Soru 1)"; document.getElementById('swal-new-text').placeholder = "Bu alan boş bırakılacak.";
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
            if (type === 'quiz' && (!quizQ || !quizOpts || quizAns === '')) { Swal.showValidationMessage('Quiz sorusu için tüm alanlar zorunludur.'); return false; }
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
        if(!formValues.title) { Swal.fire('Hata', 'Başlık zorunlu!', 'error'); return; }
        Swal.fire({ title: 'Ekleniyor...', didOpen: () => { Swal.showLoading() } });
        fetch(SCRIPT_URL, {
            method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: "addCard", username: currentUser, token: getToken(), ...formValues })
        }).then(response => response.json()).then(data => {
            if (data.result === "success") {
                Swal.fire({icon: 'success', title: 'Başarılı', text: 'İçerik eklendi.', timer: 2000, showConfirmButton: false});
                setTimeout(loadContentData, 3500);
            } else { Swal.fire('Hata', data.message || 'Eklenemedi.', 'error'); }
        }).catch(err => Swal.fire('Hata', 'Sunucu hatası: ' + err, 'error'));
    }
}
async function editContent(index) {
    const item = activeCards[index];
    const catSelectHTML = getCategorySelectHtml(item.category, 'swal-cat');
    const { value: formValues } = await Swal.fire({
        title: 'Kartı Düzenle',
        html: `
        <div id="preview-card-edit" class="card ${item.category}" style="text-align:left; box-shadow:none; border:1px solid #e0e0e0; margin-top:10px;">
            <div class="card-header" style="align-items: center; gap: 10px;">
                <input id="swal-title" class="swal2-input" style="margin:0; height:40px; flex-grow:1; border:none; border-bottom:2px solid #eee; padding:0 5px; font-weight:bold; color:#0e1b42;" value="${item.title}" placeholder="Başlık">
                <div style="width: 110px;">${catSelectHTML}</div>
            </div>
            <div class="card-content" style="margin-bottom:10px;">
                <textarea id="swal-text" class="swal2-textarea" style="margin:0; width:100%; box-sizing:border-box; border:none; resize:none; font-family:inherit; min-height:120px; padding:10px; background:#f9f9f9;" placeholder="İçerik metni...">${(item.text || '').toString().replace(/<br>/g,'\n')}</textarea>
            </div>
            <div class="script-box" style="padding:0; border:1px solid #f0e68c;">
                <textarea id="swal-script" class="swal2-textarea" style="margin:0; width:100%; box-sizing:border-box; border:none; background:transparent; font-style:italic; min-height:80px; font-size:0.9rem;" placeholder="Script metni...">${(item.script || '').toString().replace(/<br>/g,'\n')}</textarea>
            </div>
            <div class="card-actions" style="margin-top:15px; display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <div style="position:relative;"><i class="fas fa-code" style="position:absolute; left:10px; top:10px; color:#aaa;"></i><input id="swal-code" class="swal2-input" style="margin:0; height:35px; font-size:0.85rem; padding-left:30px;" value="${item.code || ''}" placeholder="Kod"></div>
                <div style="position:relative;"><i class="fas fa-link" style="position:absolute; left:10px; top:10px; color:#aaa;"></i><input id="swal-link" class="swal2-input" style="margin:0; height:35px; font-size:0.85rem; padding-left:30px;" value="${item.link || ''}" placeholder="Link"></div>
            </div>
        </div>`,
        width: '700px', showCancelButton: true, confirmButtonText: '<i class="fas fa-save"></i> Kaydet', cancelButtonText: 'İptal', focusConfirm: false,
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
    if (!s) return Swal.fire('Hata', 'İçerik bulunamadı.', 'error');
    const { value: formValues } = await Swal.fire({
        title: 'Spor İçeriğini Düzenle',
        html: `
        <div class="card" style="text-align:left; border-left: 5px solid var(--primary); padding:15px; background:#f8f9fa;">
            <label style="font-weight:bold;">Başlık</label><input id="swal-title" class="swal2-input" style="width:100%; margin-bottom:10px;" value="${s.title}">
            <label style="font-weight:bold;">Açıklama (Kısa)</label><textarea id="swal-desc" class="swal2-textarea" style="margin-bottom:10px;">${s.desc || ''}</textarea>
            <label style="font-weight:bold;">İpucu (Tip)</label><input id="swal-tip" class="swal2-input" style="width:100%; margin-bottom:10px;" value="${s.tip || ''}">
            <label style="font-weight:bold;">Detay (Alt Metin)</label><textarea id="swal-detail" class="swal2-textarea" style="margin-bottom:10px;">${s.detail || ''}</textarea>
            <label style="font-weight:bold;">Okunuşu</label><input id="swal-pron" class="swal2-input" style="width:100%; margin-bottom:10px;" value="${s.pronunciation || ''}">
            <label style="font-weight:bold;">İkon Sınıfı</label><input id="swal-icon" class="swal2-input" style="width:100%;" value="${s.icon || ''}">
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
    if (!s) return Swal.fire('Hata', 'İçerik bulunamadı.', 'error');
    const { value: formValues } = await Swal.fire({
        title: 'Satış Metnini Düzenle',
        html: `<div class="card" style="text-align:left; border-left: 5px solid var(--sales); padding:15px; background:#ecfdf5;"><label style="font-weight:bold;">Başlık</label><input id="swal-title" class="swal2-input" style="width:100%; margin-bottom:10px;"
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
    let typeOptions = `<option value="info" ${i.type === 'info' ? 'selected' : ''}>Bilgi</option><option value="update" ${i.type === 'update' ? 'selected' : ''}>Değişiklik</option><option value="fix" ${i.type === 'fix' ? 'selected' : ''}>Çözüldü</option>`;
    
    const { value: formValues } = await Swal.fire({
        title: 'Duyuruyu Düzenle',
        html: `<div class="card" style="text-align:left; border-left: 5px solid var(--secondary); padding:15px; background:#fff8e1;"><label style="font-weight:bold;">Başlık</label><input id="swal-title" class="swal2-input" style="width:100%; margin-bottom:10px;"
        value="${i.title || ''}"><div style="display:flex; gap:10px; margin-bottom:10px;"><div style="flex:1;"><label style="font-weight:bold;">Tarih</label><input id="swal-date" class="swal2-input" style="width:100%;"
        value="${i.date || ''}"></div><div style="flex:1;"><label style="font-weight:bold;">Tür</label><select id="swal-type" class="swal2-input" style="width:100%;">${typeOptions}</select></div></div><label style="font-weight:bold;">Metin</label><textarea id="swal-desc" class="swal2-textarea" style="margin-bottom:10px;">${i.desc || ''}</textarea><label style="font-weight:bold;">Durum</label><select id="swal-status" class="swal2-input" style="width:100%;">${statusOptions}</select></div>`,
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
    if(activeNews.length === 0) { t.innerHTML = "Güncel duyuru yok."; t.style.animation = 'none'; return; }
    
    let tickerText = activeNews.map(i => {
        return `<span style="color:#fabb00; font-weight:bold;">[${i.date}]</span> <span style="color:#fff;">${i.title}:</span> <span style="color:#ddd;">${i.desc}</span>`;
    }).join(' &nbsp;&nbsp;&nbsp;&nbsp; • &nbsp;&nbsp;&nbsp;&nbsp; ');
    t.innerHTML = tickerText + ' &nbsp;&nbsp;&nbsp;&nbsp; • &nbsp;&nbsp;&nbsp;&nbsp; ' + tickerText;
    t.style.animation = 'ticker-scroll 190s linear infinite';
}
function openNews() {
    document.getElementById('news-modal').style.display = 'flex';
    const c = document.getElementById('news-container');
    c.innerHTML = '';
    newsData.forEach((i, index) => {
        let cl = i.type === 'fix' ? 'tag-fix' : (i.type === 'update' ? 'tag-update' : 'tag-info');
        let tx = i.type === 'fix' ? 'Çözüldü' : (i.type === 'update' ? 'Değişiklik' : 'Bilgi');
        let passiveStyle = i.status === 'Pasif' ? 'opacity:0.5; background:#eee;' : '';
        let passiveBadge = i.status === 'Pasif' ? '<span class="news-tag" style="background:#555; color:white;">PASİF</span>' : '';
        let editBtn = (isAdminMode && isEditingActive) ? `<i class="fas fa-pencil-alt edit-icon" style="top:0; right:0; font-size:0.9rem; padding:4px;" onclick="event.stopPropagation(); editNews(${index})"></i>` : '';
        c.innerHTML += `<div class="news-item" style="${passiveStyle}">${editBtn}<span class="news-date">${i.date}</span><span class="news-title">${i.title} ${passiveBadge}</span><div class="news-desc">${i.desc}</div><span class="news-tag ${cl}">${tx}</span></div>`;
    });
}


// =========================
// ✅ Yayın Akışı (E-Tablo'dan)
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
        throw new Error((d && d.message) ? d.message : "Yayın akışı alınamadı.");
    }
    return d.items || [];
}

async function openBroadcastFlow() {
  Swal.fire({
    title: "Yayın Akışı",
    didOpen: () => Swal.showLoading(),
    showConfirmButton: false
  });

  try {
    const itemsRaw = await fetchBroadcastFlow();

    if (!itemsRaw || !itemsRaw.length) {
      Swal.fire("Yayın Akışı", "Kayıt bulunamadı.", "info");
      return;
    }

    // ✅ Sıralama (epoch varsa kesin, yoksa tarih+saate göre)
    const items = [...itemsRaw].sort((a, b) => {
      const ae = Number(a?.startEpoch || 0);
      const be = Number(b?.startEpoch || 0);
      if (ae && be) return ae - be;

      const ak = String(a?.dateISO || a?.date || "") + " " + String(a?.time || "");
      const bk = String(b?.dateISO || b?.date || "") + " " + String(b?.time || "");
      return ak.localeCompare(bk);
    });

    const now = Date.now();

    // ✅ Tarihe göre grupla (dateISO)
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

    // ✅ Popup CSS (Swal içi)
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
        <span class="ba-dot"><i class="up"></i> Yaklaşan / Gelecek</span>
        <span class="ba-dot"><i class="pa"></i> Tarihi Geçmiş</span>
      </div>
    `;

        // ✅ Yaklaşan / Gelecek ve Geçmiş olarak ayır
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

    // ✅ Önce yaklaşanlar, sonra geçmişler
    renderSection("Yaklaşan / Gelecek", upcomingByDate, "Yaklaşan yayın bulunamadı.");
    html += `<div class="ba-divider"></div>`;
    renderSection("Geçmiş", pastByDate, "Geçmiş yayın bulunamadı.");

    html += `</div>`;

    Swal.fire({
      title: "Yayın Akışı",
      html,
      width: 980,
      confirmButtonText: "Kapat"
    });

  } catch (err) {
    Swal.fire("Hata", err?.message || "Yayın akışı alınamadı.", "error");
  }
}

// XSS koruması

function _formatBroadcastDateTr(it) {
    // Backend yeni alanları gönderiyorsa kullan
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

    return s; // en kötü haliyle göster
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
        let pronHtml = s.pronunciation ? `<div class="pronunciation-badge"> 🗣️  ${s.pronunciation}</div>` : '';
        let editBtn = (isAdminMode && isEditingActive) ? `<i class="fas fa-pencil-alt edit-icon" style="top:5px; right:5px; z-index:50;" onclick="event.stopPropagation(); editSport('${escapeForJsString(s.title)}')"></i>` : '';
        grid.innerHTML += `<div class="guide-item" onclick="showSportDetail(${index})">${editBtn}<i class="fas ${s.icon} guide-icon"></i><span class="guide-title">${s.title}</span>${pronHtml}<div class="guide-desc">${s.desc}</div><div class="guide-tip"><i class="fas fa-lightbulb"></i> ${s.tip}</div><div style="font-size:0.8rem; color:#999; margin-top:5px;">(Detay için tıkla)</div></div>`;
    });
}
function showSportDetail(index) {
    const sport = sportsData[index];
    const detailText = sport.detail ? sport.detail.replace(/\n/g,'<br>') : "Bu içerik için henüz detay eklenmemiş.";
    const pronDetail = sport.pronunciation ? `<div style="color:#e65100; font-weight:bold; margin-bottom:15px;"> 🗣️  Okunuşu: ${sport.pronunciation}</div>` : '';
    Swal.fire({
        title: `<i class="fas ${sport.icon}" style="color:#0e1b42;"></i> ${sport.title}`,
        html: `${pronDetail}<div style="text-align:left; font-size:1rem; line-height:1.6;">${detailText}</div>`,
        showCloseButton: true, showConfirmButton: false, width: '600px', background: '#f8f9fa'
    });
}
function openSales() {
    // TeleSatış artık tam ekran modül
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
// Tasarım/Güncelleme: Tekrarlayan soru engeli, akıllı 50:50, double rozet, daha net maç sonu ekranı

let pScore = 0, pBalls = 10, pCurrentQ = null;
let pQuestionQueue = [];        // oturum boyunca sorulacak soru indeksleri (karıştırılmış)
let pAskedCount = 0;            // kaç soru soruldu
let pCorrectCount = 0;          // kaç doğru
let pWrongCount = 0;            // kaç yanlış

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

    // Double aktifken diğerleri kilitlensin
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
        const experts = ["Umut Bey", "Doğuş Bey", "Deniz Bey", "Esra Hanım"];
        const expert = experts[Math.floor(Math.random() * experts.length)];

        let guess = correctAns;
        // %80 doğru, %20 yanlış tahmin
        if (Math.random() > 0.8 && currentQ.opts.length > 1) {
            const incorrect = currentQ.opts.map((_, i) => i).filter(i => i !== correctAns);
            guess = incorrect[Math.floor(Math.random() * incorrect.length)] ?? correctAns;
        }

        Swal.fire({
            icon: 'info',
            title: ' 📞 Telefon Jokeri',
            html: `${expert} soruyu cevaplıyor...<br><br>"Benim tahminim **${String.fromCharCode(65 + guess)}** şıkkı. Bundan ${Math.random() < 0.8 ? "çok eminim" : "emin değilim"}."`,
            confirmButtonText: 'Kapat'
        });

    } else if (type === 'half') {
        const optLen = Array.isArray(currentQ.opts) ? currentQ.opts.length : 0;
        if (optLen <= 2) {
            Swal.fire({ icon:'info', title:'✂️ 50:50', text:'Bu soruda 50:50 uygulanamaz.', toast:true, position:'top', showConfirmButton:false, timer:1800 });
            return;
        }

        // 4+ şıkta 2 yanlış, 3 şıkta 1 yanlış ele
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
            title: ' ✂️ 50:50',
            text: removeCount === 2 ? 'İki yanlış şık elendi!' : 'Bir yanlış şık elendi!',
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
            title: '2️ ⃣ Çift Cevap',
            text: 'Bir kez yanlış cevap hakkın var.',
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

    // Lobby ekranı
    const lobby = document.getElementById('qd-lobby');
    const game = document.getElementById('qd-game');
    if (lobby) lobby.style.display = 'block';
    if (game) game.style.display = 'none';

    // Reset göstergeler
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
    q: 'Müşteri: "Fiyat pahalı, iptal edeceğim." İlk yaklaşımın ne olmalı?',
    opts: [
      'Hemen iptal işlemini başlatalım.',
      'Haklısınız, sizi anlıyorum. Paket/avantajlara göre alternatif sunayım mı?',
      'Kampanya yok, yapacak bir şey yok.'
    ],
    a: 1,
    exp: 'Empati + ihtiyaç analizi itirazı yumuşatır ve iknayı artırır.'
  },
  {
    q: 'Müşteri: "Uygulama açılmıyor." En hızlı ilk kontrol ne?',
    opts: [
      'Şifreyi sıfırlat.',
      'İnternet bağlantısı / VPN / DNS kontrolü yaptır.',
      'Hemen cihazı fabrika ayarlarına döndür.'
    ],
    a: 1,
    exp: 'Önce kök nedeni daralt: bağlantı mı uygulama mı? Büyük adımları sona bırak.'
  },
  {
    q: 'Müşteri: "Yayın donuyor." Teknikte doğru soru hangisi?',
    opts: [
      'Hangi cihazda (TV/telefon) ve hangi ağda (Wi‑Fi/kablo) oluyor?',
      'Kaç gündür böyle?',
      'Şimdi kapatıp açın.'
    ],
    a: 0,
    exp: 'Cihaz + ağ bilgisi, sorunu hızlı izole etmeyi sağlar.'
  },
  {
    q: 'Müşteri: "İade istiyorum." En doğru yönlendirme?',
    opts: [
      'Hemen kapatalım.',
      'İade koşulları ve adımları net anlat, doğru kanala yönlendir (asistan/rehber).',
      'Tekrar arayın.'
    ],
    a: 1,
    exp: 'Net süreç + doğru kanal = memnuniyet + tekrar aramayı azaltır.'
  },
  {
    q: 'Müşteri: "Kampanyadan yararlanamıyorum." İlk adım?',
    opts: [
      'Kampanya koşulları (tarih/paket/cihaz) uygun mu kontrol et.',
      'Direkt kampanyayı tanımla.',
      'Sorun yok deyip kapat.'
    ],
    a: 0,
    exp: 'Uygunluk kontrolü yapılmadan işlem yapmak hataya sürükler.'
  },
  {
    q: 'Müşteri sinirli: "Kimse çözmedi!" Ne yaparsın?',
    opts: [
      'Sakinleştirici bir cümle + özet + net aksiyon planı.',
      'Sıraya alalım.',
      'Ses yükselt.'
    ],
    a: 0,
    exp: 'Kontrolü geri almak için empati + özet + plan üçlüsü çalışır.'
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
        Swal.fire('Bilgi', 'Sorular henüz yüklenmedi. Lütfen admin panelden soruları ekleyin ve sayfayı yenileyin.', 'info');
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

    // puanlama: doğru +2, yanlış -1
    qdScore += correct ? 2 : -1;
    if (qdScore < 0) qdScore = 0;
    updateQuickHud();

    Swal.fire({
        toast: true,
        position: 'top',
        icon: correct ? 'success' : 'warning',
        title: correct ? 'Doğru seçim!' : 'Yanlış seçim',
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

    const msg = timeout ? 'Süre bitti!' : 'Bitti!';
    Swal.fire({
        icon: 'info',
        title: `🧠 Hızlı Karar ${msg}`,
        html: `<div style="text-align:center;">
                <div style="font-size:1.0rem; margin-bottom:8px;">Skorun: <b>${qdScore}</b></div>
                <div style="color:#666; font-size:0.9rem;">İstersen yeniden başlatıp rekor deneyebilirsin.</div>
              </div>`,
        confirmButtonText: 'Tamam'
    });

    // Lobby'e dön
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
            loader.innerText = "Yüklenemedi.";
            loader.style.display = 'block';
            return;
        }

        table.style.display = 'table';
        let html = '';

        if (!data.leaderboard || data.leaderboard.length === 0) {
            html = '<tr><td colspan="4" style="text-align:center;">Henüz maç yapılmadı.</td></tr>';
        } else {
            data.leaderboard.forEach((u, i) => {
                const medal = i===0 ? '🥇' : (i===1 ? '🥈' : (i===2 ? '🥉' : `<span class="rank-badge">${i+1}</span>`));
                const bgStyle = (u.username === currentUser) ? 'background:rgba(250, 187, 0, 0.1);' : '';
                html += `<tr style="${bgStyle}"><td>${medal}</td><td>${u.username}</td><td>${u.games}</td><td>${u.average}</td></tr>`;
            });
        }
        tbody.innerHTML = html;
    })
    .catch(() => {
        loader.style.display = 'none';
        loader.innerText = "Bağlantı hatası.";
        loader.style.display = 'block';
    });
}

function buildQuestionQueue() {
    const n = quizQuestions.length;
    const idxs = Array.from({ length: n }, (_, i) => i);
    idxs.sort(() => Math.random() - 0.5);

    // 10 soru için yeter yoksa, yine de döngüye sokmayalım: kalan toplarda tekrar olabilir.
    // ama önce tüm sorular bir kez gelsin.
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

    // Soru kuyruğu
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

    // Önce kuyruktan tüket
    if (pQuestionQueue.length > 0) {
        const i = pQuestionQueue.shift();
        return quizQuestions[i];
    }

    // Kuyruk bitti ama top devam ediyor: artık random (soru azsa)
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
        Swal.fire('Hata', 'Bu soru hatalı formatta (şık yok).', 'error');
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

    // Double joker: ilk yanlışta bir hak daha
    if (!isCorrect && doubleChanceUsed && firstAnswerIndex === -1) {
        firstAnswerIndex = idx;
        if (btns[idx]) {
            btns[idx].classList.add('wrong-first-try');
            btns[idx].disabled = true;
        }
        Swal.fire({ toast: true, position: 'top', icon: 'info', title: 'İlk Hata! Kalan Hakkın: 1', showConfirmButton: false, timer: 1400, background: '#ffc107' });
        updateJokerButtons();
        return;
    }

    // Artık atış kesinleşti
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

                Swal.fire({ toast:true, position:'top', icon:'success', title:'Mükemmel Şut!', showConfirmButton:false, timer:900, background:'#a5d6a7' });
            }, 450);

        } else {
            pWrongCount++;

            const showWrong = () => {
                if (goalMsg) {
                    goalMsg.style.color = "#ef5350";
                    goalMsg.classList.add('show');
                }
                Swal.fire({ icon:'error', title:'Kaçırdın!', text:`Doğru: ${String.fromCharCode(65 + pCurrentQ.a)}`, showConfirmButton:true, timer:2400, background:'#ef9a9a' });
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
                setTimeout(() => { if (goalMsg) goalMsg.innerText = "DIŞARI!"; showWrong(); }, 450);
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
    const title = pScore >= 8 ? "EFSANE! 🏆" : (pScore >= 5 ? "İyi Maçtı! 👏" : "Antrenman Lazım 🤕");
    const acc = Math.round((pCorrectCount / Math.max(1, (pCorrectCount + pWrongCount))) * 100);

    const qEl = document.getElementById('p-question-text');
    if (qEl) {
        qEl.innerHTML = `
            <div style="font-size:1.5rem; color:#fabb00; font-weight:800;">MAÇ BİTTİ!</div>
            <div style="margin-top:4px; font-size:1.1rem; color:#fff;">${title}</div>
            <div style="margin-top:8px; font-size:1rem; color:#ddd;">
                <b>Skor:</b> ${pScore}/${totalShots} &nbsp; • &nbsp;
                <b>Doğruluk:</b> ${acc}%
            </div>
            <div style="margin-top:6px; font-size:0.9rem; color:#bbb;">
                Doğru: ${pCorrectCount} &nbsp; | &nbsp; Yanlış: ${pWrongCount}
            </div>
            <div style="margin-top:10px; font-size:0.85rem; color:#aaa;">
                Yeniden oynamak için aşağıdan başlatabilirsin.
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
        // lobby tablosunu güncel tut
        setTimeout(fetchLeaderboard, 600);
    });
}


// --- WIZARD FUNCTIONS ---
function openWizard(){
    document.getElementById('wizard-modal').style.display='flex';
    if (Object.keys(wizardStepsData).length === 0) {
        Swal.fire({ title: 'İade Asistanı Verisi Yükleniyor...', didOpen: () => Swal.showLoading() });
        loadWizardData().then(() => { Swal.close(); if (wizardStepsData['start']) renderStep('start'); else document.getElementById('wizard-body').innerHTML = '<h2 style="color:red;">Asistan verisi eksik.</h2>'; })
        .catch(() => { Swal.close(); document.getElementById('wizard-body').innerHTML = '<h2 style="color:red;">Veri çekme hatası.</h2>'; });
    } else { renderStep('start'); }
}
function renderStep(k){
    const s = wizardStepsData[k];
    if (!s) { document.getElementById('wizard-body').innerHTML = `<h2 style="color:red;">HATA: Adım ID (${k}) yok.</h2>`; return; }
    const b = document.getElementById('wizard-body');
    let h = `<h2 style="color:var(--primary);">${s.title || ''}</h2>`;
    if(s.result) {
        let i = s.result === 'red' ? ' 🛑 ' : (s.result === 'green' ? ' ✅ ' : ' ⚠️ ');
        let c = s.result === 'red' ? 'res-red' : (s.result === 'green' ? 'res-green' : 'res-yellow');
        h += `<div class="result-box ${c}"><div style="font-size:3rem;margin-bottom:10px;">${i}</div><h3>${s.title}</h3><p>${s.text}</p>${s.script ? `<div class="script-box">${s.script}</div>` : ''}</div><button class="restart-btn" onclick="renderStep('start')"><i class="fas fa-redo"></i> Başa Dön</button>`;
    } else {
        h += `<p>${s.text}</p><div class="wizard-options">`;
        s.options.forEach(o => { h += `<button class="option-btn" onclick="renderStep('${o.next}')"><i class="fas fa-chevron-right"></i> ${o.text}</button>`; });
        h += `</div>`; if(k !== 'start') h += `<button class="restart-btn" onclick="renderStep('start')" style="background:#eee;color:#333;margin-top:15px;">Başa Dön</button>`;
    }
    b.innerHTML = h;
}
// --- TECH WIZARD ---
const twState = { currentStep: 'start', history: [] };
function openTechWizard() {
    // Teknik Sihirbaz artık Teknik (tam ekran) içinde
    openTechArea('wizard');
}
function twRenderStep() {
    const contentDiv = document.getElementById('tech-wizard-content');
    const backBtn = document.getElementById('tw-btn-back');
    const stepData = techWizardData[twState.currentStep];
    if (twState.history.length > 0) backBtn.style.display = 'block'; else backBtn.style.display = 'none';
    if (!stepData) { contentDiv.innerHTML = `<div class="alert" style="color:red;">Hata: Adım bulunamadı (${twState.currentStep}).</div>`; return; }
    let html = `<div class="tech-step-title">${stepData.title || ''}</div>`;
    if (stepData.text) html += `<p style="font-size:1rem; margin-bottom:15px;">${stepData.text}</p>`;
    if (stepData.script) {
        const safeScript = encodeURIComponent(stepData.script);
        html += `<div class="tech-script-box"><span class="tech-script-label">Müşteriye iletilecek:</span>"${stepData.script}"<div style="margin-top:10px; text-align:right;"><button class="btn btn-copy" style="font-size:0.8rem; padding:5px 10px;" onclick="copyScriptContent('${safeScript}')"><i class="fas fa-copy"></i> Kopyala</button></div></div>`;
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
// --- YENİ KALİTE LMS MODÜLÜ (TAM EKRAN ENTEGRASYONU) ---
// ==========================================================
// Modülü Aç
function openQualityArea() {
    // Eski modalı kapat (eğer açıksa)
    const oldModal = document.getElementById('quality-modal');
    if(oldModal) oldModal.style.display = 'none';
    // Tam ekranı aç
    const fullScreen = document.getElementById('quality-fullscreen');
    fullScreen.style.display = 'flex';
    // Kullanıcı bilgisini güncelle
    document.getElementById('q-side-name').innerText = currentUser;
    document.getElementById('q-side-role').innerText = isAdminMode ? 'Yönetici' : 'Temsilci';
    document.getElementById('q-side-avatar').innerText = currentUser.charAt(0).toUpperCase();
    // Dönem filtresini doldur
    populateMonthFilterFull();
    // Yetki kontrolü (Admin butonlarını göster/gizle)
    const adminFilters = document.getElementById('admin-filters');
    const assignBtn = document.getElementById('assign-training-btn');
    const manualFeedbackBtn = document.getElementById('manual-feedback-admin-btn');
    
    if (isAdminMode) {
        if(adminFilters) adminFilters.style.display = 'flex';
        if(assignBtn) assignBtn.style.display = 'block';
        if(manualFeedbackBtn) manualFeedbackBtn.style.display = 'flex';
        
        // Kullanıcı listesi boşsa çek, sonra filtreleri doldur
        if (adminUserList.length === 0) {
            fetchUserListForAdmin().then(users => {
                const groupSelect = document.getElementById('q-admin-group');
                if(groupSelect) {
                    const groups = [...new Set(users.map(u => u.group))].sort();
                    groupSelect.innerHTML = `<option value="all">Tüm Gruplar</option>` + groups.map(g => `<option value="${g}">${g}</option>`).join('');
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
        
        // Admin değilse filtreleri gizle
        const dashFilterArea = document.querySelector('#view-dashboard .q-view-header > div');
        if(dashFilterArea && dashFilterArea.style.display !== 'none') {
             // Burada basitçe dashboard filtre fonksiyonu admin kontrolü yapıyor.
             populateDashboardFilters(); 
        }
    }
    // Varsayılan sekmeyi aç
    // Tıklanma simülasyonu ile ilk sekmeyi aktif et
    const defaultTab = document.querySelector('.q-nav-item.active');
    if (defaultTab) {
        switchQualityTab('dashboard', defaultTab);
    }
}
// Modülü Kapat
function closeFullQuality() {
    document.getElementById('quality-fullscreen').style.display = 'none';
    // Eğer qusers ise (sadece kalite yetkisi varsa) logout yapmalı veya uyarı vermeli
    if(localStorage.getItem("sSportRole") === 'qusers') {
        logout();
    }
}
// Sekme Değiştirme
function switchQualityTab(tabName, element) {
    // Menu active class
    document.querySelectorAll('.q-nav-item').forEach(item => item.classList.remove('active'));
    // Element varsa onu aktif yap, yoksa varsayılanı (dashboard) bulup aktif yap
    if (element) {
        element.classList.add('active');
    } else {
        document.querySelector(`.q-nav-item[onclick*="${tabName}"]`).classList.add('active');
    }
    
    // View active class
    document.querySelectorAll('.q-view-section').forEach(section => section.classList.remove('active'));
    document.getElementById(`view-${tabName}`).classList.add('active');
    // Veri Yükleme
    if (tabName === 'dashboard') loadQualityDashboard();
    else if (tabName === 'evaluations') fetchEvaluationsForAgent();
    // DÜZELTME: Feedback sekmesi açılırken önce Feedback_Logs çekilmeli
    else if (tabName === 'feedback') {
        populateFeedbackFilters();
        refreshFeedbackData();
    }
    else if (tabName === 'training') loadTrainingData();
}
// --- DASHBOARD FONKSİYONLARI ---
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
// YENİ: Dashboard Filtrelerini Doldurma
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
    groupSelect.innerHTML = '<option value="all">Tüm Gruplar</option>';
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g; opt.innerText = g;
        groupSelect.appendChild(opt);
    });
    // İlk yüklemede tüm agentları listele
    updateDashAgentList();
}
// YENİ: Dashboard Agent Listesini Güncelleme
function updateDashAgentList() {
    const groupSelect = document.getElementById('q-dash-group');
    const agentSelect = document.getElementById('q-dash-agent');
    if(!agentSelect) return;
    const selectedGroup = groupSelect.value;
    agentSelect.innerHTML = '<option value="all">Tüm Temsilciler</option>';
    
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

// ✅ Dashboard ring başlığı + admin temsilci ortalamaları
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
        tEl.textContent = `${g} Takım Ortalaması`;
    } else {
        tEl.textContent = 'Genel Puan Ortalaması';
    }
}

// Admin için: temsilci ortalamaları listesini bas
function renderDashAgentScores(evals) {
    const box = document.getElementById('q-dash-agent-scores');
    if(!box) return;

    // Sadece admin + agent=all iken göster (yoksa gereksiz kalabalık)
    if(!isAdminMode) { box.style.display='none'; return; }

    const gSel = document.getElementById('q-dash-group');
    const aSel = document.getElementById('q-dash-agent');
    const g = gSel ? gSel.value : 'all';
    const a = aSel ? aSel.value : 'all';

    if(a && a !== 'all') { box.style.display='none'; return; }

    // evals -> agent bazlı ortalama
    const byAgent = {};
    (evals || []).forEach(e => {
        const agent = e.agent || 'N/A';
        const group = e.group || '';
        const score = parseFloat(e.score) || 0;
        if(!byAgent[agent]) byAgent[agent] = { total:0, count:0, group: group };
        byAgent[agent].total += score;
        byAgent[agent].count += 1;
        // group boşsa son görüleni yaz
        if(!byAgent[agent].group && group) byAgent[agent].group = group;
    });

    const rows = Object.keys(byAgent).map(name => {
        const o = byAgent[name];
        return { name, group: o.group || (g !== 'all' ? g : ''), avg: o.count ? (o.total/o.count) : 0, count:o.count };
    });

    // Eğer group seçiliyse sadece o grubun kullanıcıları zaten geliyor; ama garanti olsun
    const filteredRows = (g && g !== 'all') ? rows.filter(r => (r.group || '') === g) : rows;

    // Sırala: en düşük ortalama üstte (iyileştirme alanı)
    filteredRows.sort((x,y)=> x.avg - y.avg);

    if(filteredRows.length === 0) { box.style.display='none'; return; }

    // İlk 8 kişiyi göster
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

// Detay alanını toleranslı parse et
function safeParseDetails(details) {
    if(!details) return null;
    if(Array.isArray(details)) return details;
    if(typeof details === 'object') return details;
    if(typeof details === 'string') {
        const s = details.trim();
        if(!s) return null;
        // Bazı eski kayıtlar çift tırnak kaçışlı gelebilir
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

// ✅ YENİ: Feedback (Geri Bildirimler) Filtrelerini Doldurma
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
    groupSelect.innerHTML = '<option value="all">Tüm Gruplar</option>';
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        groupSelect.appendChild(opt);
    });

    // İlk yüklemede tüm agentları listele
    updateFeedbackAgentList(false);
}

function updateFeedbackAgentList(shouldRefresh=true) {
    const groupSelect = document.getElementById('q-feedback-group');
    const agentSelect = document.getElementById('q-feedback-agent');
    if(!groupSelect || !agentSelect) return;

    const selectedGroup = groupSelect.value;

    // seçilen gruba göre kullanıcıları filtrele
    const filteredUsers = adminUserList.filter(u => {
        if(!u || !u.username) return false;
        if(selectedGroup === 'all') return true;
        return u.group === selectedGroup;
    });

    const agents = filteredUsers
        .map(u => u.username)
        .filter(a => a)
        .sort((a,b) => a.localeCompare(b, 'tr'));

    agentSelect.innerHTML = '<option value="all">Tüm Temsilciler</option>';
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
    // Feedback ekranı için (admin filtrelerine göre) değerlendirmeleri + logları çek, sonra listeyi bas
    await fetchEvaluationsForFeedback();
    await fetchFeedbackLogs();
    loadFeedbackList();
}


function refreshQualityData() {
    loadQualityDashboard();
}
async function fetchEvaluationsForDashboard() {
    // Dashboard filtrelerine göre değerlendirmeleri çek (admin ise seçilen grup/temsilciye göre)
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
    // Verileri çek (silent mode), veri gelince grafikleri çiz
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
            // Admin filtreleme mantığı
            if (isAdminMode) {
                // Eğer veri içinde grup bilgisi varsa onu kullan, yoksa adminUserList'ten bakmak gerekir.
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
                // Admin değilse sadece kendi verisi
                if(e.agent !== currentUser) matchAgent = false;
            }
            // MANUEL kayıtları dashboard'da gösterme
            const isManual = e.callId && String(e.callId).toUpperCase().startsWith('MANUEL-');
            return matchMonth && matchGroup && matchAgent && !isManual;
        });
        const total = filtered.reduce((acc, curr) => acc + (parseInt(curr.score)||0), 0);
        const count = filtered.length;
        const avg = count > 0 ? (total / count).toFixed(1) : 0;
        const targetHit = filtered.filter(e => e.score >= 90).length;
        const rate = count > 0 ? Math.round((targetHit / count) * 100) : 0;
        // UI Güncelle
        document.getElementById('q-dash-score').innerText = avg;
        document.getElementById('q-dash-count').innerText = count;
        document.getElementById('q-dash-target').innerText = `%${rate}`;
        
        // Ring Chart Rengi
        const ring = document.getElementById('q-dash-ring');
        let color = '#2e7d32';
        if(avg < 70) color = '#d32f2f'; else if(avg < 85) color = '#ed6c02';
        const ratio = (avg / 100) * 100;
        if(ring) ring.style.background = `conic-gradient(${color} ${ratio}%, #eee ${ratio}%)`;
        if(document.getElementById('q-dash-ring-text')) document.getElementById('q-dash-ring-text').innerText = Math.round(avg);
        updateDashRingTitle();
        // Admin için: temsilci ortalamaları
        renderDashAgentScores(filtered);
        // Grafik Çizdir
        renderDashboardChart(filtered);
    });
}
function renderDashboardChart(data) {
    const ctx = document.getElementById('q-breakdown-chart');
    if (!ctx) return;
    if (dashboardChart) {
        dashboardChart.destroy();
    }
    // --- KRİTER BAZLI ANALİZ ---
    let questionStats = {};
    if (data.length > 0) {
        data.forEach(item => {
            try {
                // Detay verisini kontrol et, string ise parse et
                let details = safeParseDetails(item.details);
                
                if(Array.isArray(details)) {
                    details.forEach(d => {
                        let qFullText = d.q; // Tam metin
                        // Soruyu anahtar olarak kullan (kısaltılmış versiyonu)
                        let qShortText = qFullText.length > 25 ? qFullText.substring(0, 25) + '...' : qFullText;
                        
                        if (!questionStats[qShortText]) {
                            // fullText'i tutuyoruz ki tooltip'te gösterebilelim
                            questionStats[qShortText] = { earned: 0, max: 0, fullText: qFullText }; 
                        }
                        
                        questionStats[qShortText].earned += parseInt(d.score || 0);
                        questionStats[qShortText].max += parseInt(d.max || 0);
                    });
                }
            } catch (e) {
                // JSON parse hatası veya eski veri formatı
                console.log("Detay verisi işlenemedi", e);
            }
        });
    }
    // İstatistikleri diziye çevirip başarı oranına göre sırala
    let statsArray = Object.keys(questionStats).map(key => {
        let s = questionStats[key];
        // Başarı oranı %
        let percentage = s.max > 0 ? (s.earned / s.max) * 100 : 0;
        return { label: key, fullLabel: s.fullText, value: percentage };
    });
    
    // Başarı oranına göre artan sıralama (En düşük başarı en başta)
    statsArray.sort((a, b) => a.value - b.value);
    // Eğer detay kırılımı yoksa (eski/boş kayıtlar), temsilci ortalamasına göre kırılım göster
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

        dashboardChart = new Chart(ctx, {
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
                                if (context.length > 0) return topIssues[context[0].dataIndex].fullLabel;
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
        return;
    }

    // Sadece en düşük 6 kriteri göster
    let topIssues = statsArray.slice(0, 6);
 
    let chartLabels = topIssues.map(i => i.label);
    let chartData = topIssues.map(i => i.value.toFixed(1));
    dashboardChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Başarı Oranı (%)',
                data: chartData,
                // Kriter Bazlı Renklendirme
                backgroundColor: chartData.map(val => val < 70 ? 'rgba(211, 47, 47, 0.7)' : (val < 90 ? 'rgba(237, 108, 2, 0.7)' : 'rgba(46, 125, 50, 0.7)')),
                borderColor: chartData.map(val => val < 70 ? '#b71c1c' : (val < 90 ? '#e65100' : '#1b5e20')),
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y', // Yatay çubuk grafik
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
                        // Tooltip başlığında tam metni gösterilmesi
                        title: function(context) {
                            if (context.length > 0) {
                                const dataIndex = context[0].dataIndex;
                                // fullLabel'i kullanarak tam metni döndür
                                return topIssues[dataIndex].fullLabel; 
                            }
                            return '';
                        },
                        label: function(context) {
                            return context.parsed.x + '% Başarı';
                        }
                    }
                }
            }
        }
    });
}
// --- EĞİTİM MODÜLÜ (YENİ) ---
function loadTrainingData() {
    const listEl = document.getElementById('training-list');
    listEl.innerHTML = '<div style="grid-column:1/-1; text-align:center;">Yükleniyor...</div>';
    
    fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "getTrainings", username: currentUser, token: getToken() })
    }).then(r => r.json()).then(data => {
        listEl.innerHTML = '';
        if(data.result === 'success' && data.trainings.length > 0) {
            data.trainings.forEach(t => {
                let statusHtml = t.isCompleted 
                    ? `<button class="t-btn t-btn-done"><i class="fas fa-check"></i> Tamamlandı</button>`
                    : `<button class="t-btn t-btn-start" onclick="openTrainingLink('${t.id}', '${t.link}')">Eğitime Git</button>`;
                
                let docHtml = t.docLink && t.docLink !== 'N/A' 
                    ? `<a href="${t.docLink}" target="_blank" class="t-doc-link"><i class="fas fa-file-download"></i> Dökümanı İndir</a>` 
                    : '';
                
                // GÜNCELLENMİŞ KART YAPISI (Tarih ve Süre Eklendi)
                listEl.innerHTML += `
                <div class="t-card">
                    <div class="t-card-header">
                        <span>${t.title}</span>
                        <span class="t-status-badge">Atanma: ${t.date}</span>
                    </div>
                    <div class="t-card-body">
                        ${t.desc}
                        ${docHtml}
                        <div style="margin-top:10px; display:flex; justify-content:space-between; font-size:0.8rem; color:#666; padding-top:10px; border-top:1px dashed #eee;">
                            <div><strong>Süre:</strong> ${t.duration || 'Belirtilmedi'}</div>
                            <div><strong>Başlangıç:</strong> ${t.startDate || 'N/A'} - <strong>Bitiş:</strong> ${t.endDate || 'N/A'}</div>
                        </div>
                        <div style="font-size:0.8rem; color:#999; margin-top:5px;">Atayan: ${t.creator}</div>
                    </div>
                    <div class="t-card-footer">
                        ${statusHtml}
                    </div>
                </div>`;
            });
        } else {
            listEl.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#888;">Atanmış eğitim bulunmuyor.</div>';
        }
    });
}
function openTrainingLink(id, link) {
    if(link && link !== 'N/A') {
        window.open(link, '_blank');
    } else {
        Swal.fire('Uyarı', 'Bu eğitim için geçerli bir link bulunmamaktadır.', 'warning');
    }
    
    // Linke tıkladıktan sonra onay sor
    Swal.fire({
        title: 'Eğitimi Tamamladın mı?',
        text: "Eğitim içeriğini inceleyip anladıysan onayla.",
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Evet, Tamamladım',
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
            Swal.fire('Harika!', 'Eğitim tamamlandı olarak işaretlendi.', 'success');
            loadTrainingData();
        } else {
            Swal.fire('Hata', d.message, 'error');
        }
    });
}
async function assignTrainingPopup() {
    const { value: formValues } = await Swal.fire({
        title: 'Yeni Eğitim & Döküman Ata',
        html: `
            <div class="t-modal-grid">
                <input id="swal-t-title" class="swal2-input" placeholder="Eğitim Başlığı" style="grid-column: 1 / 4;">
                <textarea id="swal-t-desc" class="swal2-textarea" style="height:100px; grid-column: 1 / 4;" placeholder="Eğitim açıklaması veya talimatlar..."></textarea>
                <input id="swal-t-link" class="swal2-input" placeholder="Video/Eğitim Linki (URL)" style="grid-column: 1 / 4;">
                <input id="swal-t-doc" class="swal2-input" placeholder="Döküman Linki (Drive/PDF URL) (İsteğe Bağlı)" style="grid-column: 1 / 4;">
                <input type="date" id="swal-t-start" class="swal2-input" value="${new Date().toISOString().substring(0, 10)}">
                <input type="date" id="swal-t-end" class="swal2-input">
                <input id="swal-t-duration" class="swal2-input" placeholder="Süre (Örn: 20dk)">
            </div>
            <select id="swal-t-target" class="swal2-input" onchange="updateTrainingTarget(this.value)" style="margin-top:10px;">
                <option value="Genel">Herkese (Tüm Ekip)</option>
                <option value="Telesatış">Telesatış Ekibi</option>
                <option value="Chat">Chat Ekibi</option>
                <option value="Individual">Kişiye Özel</option>
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
                Swal.showValidationMessage('Başlık ve Atama Alanı boş bırakılamaz');
                return false;
            }
            return {
                title: document.getElementById('swal-t-title').value,
                desc: document.getElementById('swal-t-desc').value,
                link: document.getElementById('swal-t-link').value,
                docLink: document.getElementById('swal-t-doc').value || 'N/A',
                target: target,
                targetAgent: agent, // Kişiye özel atama için
                creator: currentUser,
                startDate: formatDateToDDMMYYYY(document.getElementById('swal-t-start').value), 
                endDate: formatDateToDDMMYYYY(document.getElementById('swal-t-end').value), 
                duration: document.getElementById('swal-t-duration').value 
            }
        }
    });
    if (formValues) {
        Swal.fire({title:'Atanıyor...', didOpen:()=>Swal.showLoading()});
        fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "assignTraining", username: currentUser, token: getToken(), ...formValues })
        }).then(r=>r.json()).then(d=>{
            Swal.fire('Başarılı', 'Eğitim atandı.', 'success');
            loadTrainingData();
        });
    }
}
// --- FEEDBACK MODÜLÜ ---

// YENİ FONKSİYON: Feedback_Logs'u çekmek için
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
        console.error("Feedback Logs çekilirken hata oluştu:", error);
        feedbackLogsData = [];
    }
}

// YARDIMCI FONKSİYON: Dönem bilgisini MM.YYYY formatında döndürür
function formatPeriod(periodString) {
    if (!periodString || periodString === 'N/A') return 'N/A';
    
    // Zaten MM.YYYY formatındaysa direkt döndür
    if (periodString.match(/^\d{2}\.\d{4}$/)) {
        return periodString;
    }
    
    // Eğer uzun bir Date string'i ise (ör: Wed Oct 01 2025...) tarih nesnesine çevir
    try {
        const date = new Date(periodString);
        if (!isNaN(date.getTime())) {
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${month}.${year}`;
        }
    } catch (e) {
        // Hata oluşursa olduğu gibi bırak veya N/A döndür
        console.error("Dönem formatlama hatası:", e);
    }
    
    return periodString; // Başka formatta gelirse yine de olduğu gibi döndür
}

function loadFeedbackList() {
    const listEl = document.getElementById('feedback-list');
    listEl.innerHTML = '';
    
    // Admin butonunu göster/gizle
    const manualBtn = document.getElementById('manual-feedback-admin-btn');
    if(manualBtn) manualBtn.style.display = isAdminMode ? 'flex' : 'none';
    
    // YENİ FİLTRELEME MANTIĞI: Sadece feedbackType 'Mail' olanlar VEYA callId 'MANUEL' olanlar listelenir.
    const feedbackItems = allEvaluationsData.filter(e => {
        // feedbackType kontrolü (Büyük/küçük harf duyarlılığını ortadan kaldırırız)
        const isMailFeedback = e.feedbackType && e.feedbackType.toLowerCase() === 'mail';
        // Manuel kontrolü
        const isManualFeedback = e.callId && String(e.callId).toUpperCase().startsWith('MANUEL-');
        
        return isMailFeedback || isManualFeedback;
    });
    if(feedbackItems.length === 0) {
        listEl.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">Görüntülenecek filtrelenmiş geri bildirim yok (Sadece Mail veya Manuel).</div>';
        return;
    }
    
    feedbackItems.forEach(e => {
        // Geliştirme: Çağrı Tarihi ve ID eklendi (Gelişmiş Kart Tasarımı)
        const feedbackClass = e.feedbackType === 'Sözlü' ? '#2196f3' : (e.feedbackType === 'Mail' ? '#e65100' : (e.feedbackType === 'Bilgilendirme' ? '#0288d1' : (e.feedbackType === 'Feedback' ? '#2e7d32' : '#10b981')));
        
        // MANUEL CallID'den ön eki temizle
        const cleanCallId = String(e.callId).toUpperCase().startsWith('MANUEL-') ? String(e.callId).substring(7) : e.callId;
        
        // Konu/Başlık bilgisi 'details' alanından gelir (Manuel geri bildirim için)
        // Eğer detay alanı JSON ise (yani normal değerlendirme) veya boşsa varsayılan metin kullan
        const isEvaluationDetail = String(e.details).startsWith('[');
        const feedbackTopic = isEvaluationDetail ? 'Değerlendirme Konusu' : (e.details || 'Belirtilmemiş');
        
        // Dönem, Kanal ve Tipi belirle (Manuel kayıtlarda bu bilgileri Evaluations'tan değil, Feedback_Logs'tan çekiyoruz)
        const isManual = String(e.callId).toUpperCase().startsWith('MANUEL-');
        
        let period = e.period || e.date.substring(3);
        let channel = (e.channel && String(e.channel).trim()) ? String(e.channel).trim() : 'Yok';
        const infoType = e.feedbackType || 'Yok';

        // DÜZELTME MANTIĞI: Eğer kayıt Manuel ise, detaylı bilgiyi feedbackLogsData'dan çek.
        if (isManual) {
            // CallId'deki MANUEL- ön ekini atarak Feedback_Logs'taki Call_ID ile eşleştirme
            const logRow = feedbackLogsData.find(x => String(x.callId) === String(cleanCallId));
            if (logRow) {
                // Apps Script'ten gelen period değerini formatla (Tarih Nesnesi/String olma ihtimaline karşı)
                period = formatPeriod(logRow.period) || period;
                channel = logRow.channel && logRow.channel !== 'N/A' ? logRow.channel : 'Yok';
            }
        }
        
        listEl.innerHTML += `
            <div class="feedback-card" style="border-left-color: ${feedbackClass};">
                <div class="feedback-header">
                    <div style="font-weight:bold; color:#0e1b42; font-size:1.1rem;">${e.agent}</div>
                    <div class="feedback-info-right">
                        <span><i class="fas fa-user-check"></i> Değerleyen: ${e.evaluator}</span>
                        <span><i class="fas fa-id-badge"></i> Çağrı ID: ${cleanCallId}</span>
                        <span><i class="fas fa-calendar-alt"></i> Tarih: ${e.callDate}</span>
                    </div>
                </div>
                <div class="feedback-body">
                    <div style="font-weight:bold; color:#333; margin-bottom:5px;">Konu/Açıklama: ${feedbackTopic}</div>
                    <div style="color:#555; line-height:1.5; font-size:0.95rem;">${e.feedback}</div>
                </div>
                <div class="feedback-footer">
                     <div style="display:flex; gap:10px; font-size:0.7rem; color:#666; font-weight:600; margin-right:10px;">
                        <span><i class="fas fa-calendar-week"></i> Dönem: ${period}</span>
                        <span><i class="fas fa-comment-alt"></i> Kanal: ${channel}</span>
                        <span><i class="fas fa-tag"></i> Tip: ${infoType}</span>
                     </div>
                     
            </div>`;
    });
}
// Adminler için manuel geri bildirim ekleme (Çağrı dışı konular için)
async function addManualFeedbackPopup() {
    if (!isAdminMode) return;
    
    // Admin user listesi yoksa yükle
    if (adminUserList.length === 0) {
        Swal.fire({ title: 'Kullanıcı Listesi Yükleniyor...', didOpen: () => Swal.showLoading() });
        await fetchUserListForAdmin();
        Swal.close();
    }
    // Dönem filtre seçeneklerini oluştur
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    let monthOptions = '';
    for (let i = 0; i < 6; i++) {
        let month = (currentMonth - i + 12) % 12;
        let year = currentYear - (currentMonth - i < 0 ? 1 : 0);
        const text = `${MONTH_NAMES[month]} ${year}`;
        const value = `${String(month + 1).padStart(2, '0')}.${year}`; // Backend'in beklediği MM.YYYY formatı
        const isCurrent = (i === 0);
        monthOptions += `<option value="${value}" ${isCurrent ? 'selected' : ''}>${text}</option>`;
    }
    
    // YENİ HTML TASARIMI: Daha düzenli ve etiketli form
    const newHtmlContent = `
        <div class="manual-feedback-form">
            <div class="form-group">
                <label for="manual-q-agent">Temsilci Adı <span class="required">*</span></label>
                <select id="manual-q-agent" class="swal2-input"></select>
            </div>
            <div class="form-group">
                <label for="manual-q-topic">Konu / Başlık <span class="required">*</span></label>
                <input id="manual-q-topic" class="swal2-input" placeholder="Geri bildirim konusu (Örn: Yeni Kampanya Bilgilendirmesi)">
            </div>
            
            <div class="grid-2-cols">
                <div class="form-group">
                    <label for="manual-q-callid">Çağrı/Etkileşim ID <span class="required">*</span></label>
                    <input id="manual-q-callid" class="swal2-input" placeholder="ID (Örn: 123456)">
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
                        <option value="Canlı Destek">Canlı Destek</option>
                        <option value="E-posta">E-posta</option>
                        <option value="Sosyal Medya">Sosyal Medya</option>
                        <option value="Yok">Yok/Diğer</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="manual-q-period">Dönem</label>
                    <select id="manual-q-period" class="swal2-input">${monthOptions}</select>
                </div>
                <div class="form-group">
                    <label for="manual-q-type">Tip</label>
                    <select id="manual-q-type" class="swal2-input">
                        <option value="Feedback">Feedback</option>
                        <option value="Bilgilendirme">Bilgilendirme</option>
                        <option value="Sözlü">Sözlü</option>
                        <option value="Mail">Mail</option>
                        <option value="Özel">Özel Konu</option>
                    </select>
                </div>
            </div>
            
            <div class="form-group">
                <label for="manual-q-feedback">Geri Bildirim Detayları <span class="required">*</span></label>
                <textarea id="manual-q-feedback" class="swal2-textarea" placeholder="Buraya geri bildirimin detaylı metnini giriniz..."></textarea>
            </div>
        </div>
        <style>
            /* Manuel Geri Bildirim Formu Stil İyileştirmeleri */
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
            /* Input/Select/Textarea stillerini genel swal2-input stilinden devraldık */
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
    
    // Modalı görüntüdeki gibi düzenledik (Agent Select ve sade alanlar)
    const { value: formValues } = await Swal.fire({
        title: 'Manuel Geri Bildirim Yaz',
        html: newHtmlContent,
        width: '600px', // Modal genişliğini artırdık
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
            
            // YENİ ALANLAR
            const channel = document.getElementById('manual-q-channel').value;
            const period = document.getElementById('manual-q-period').value; // MM.YYYY formatında
            
            // YENİ ZORUNLU KONTROLLER
            const callId = document.getElementById('manual-q-callid').value.trim();
            const rawCallDate = document.getElementById('manual-q-date').value;
            const callDate = formatDateToDDMMYYYY(rawCallDate);
            if (!agentName || !feedback || !callId || !rawCallDate || !topic) { // Konu/Başlık da zorunlu yapıldı
                 Swal.showValidationMessage('Tüm (*) işaretli alanlar zorunludur!'); 
                 return false;
            }
            
            // Konu sadece başlık olarak gönderiliyor. Dönem ve Kanal ayrı alanlar olarak gönderilecek.
            return {
                agentName,
                // Backend'de ayrı loglama için CallID'yi MANUEL ile başlatıyoruz.
                callId: "MANUEL-" + callId, 
                callDate: callDate,
                score: 100, // Manuel olduğu için tam puan
                details: topic, // Sadece konuyu gönderiyoruz
                feedback,
                feedbackType,
                agentGroup: "Genel", // Manuel olduğu için Genel Grup olarak kaydedilir.
                // ÇÖZÜM: Yeni alanları ekliyoruz
                channel: channel,
                period: period
            };
        }
    });
    if (formValues) {
        // MÜKERRER KONTROL: Aynı temsilci + aynı Call ID daha önce kaydedildiyse uyar
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
                    title: 'Mükerrer Dinleme',
                    html: `<div style="text-align:left; line-height:1.4;">
                            <b>${formValues.agentName}</b> için <b>Call ID: ${escapeHtml(formValues.callId)}</b> daha önce kaydedilmiş görünüyor.<br>
                            <span style="color:#666; font-size:0.9rem;">Yine de yeni kayıt oluşturmak istiyor musun?</span>
                           </div>`,
                    showCancelButton: true,
                    confirmButtonText: 'Evet, kaydet',
                    cancelButtonText: 'Vazgeç',
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
                // DÜZELTME: Hem evaluations hem de feedback logs güncellenmeli
                fetchEvaluationsForAgent(formValues.agentName);
                fetchFeedbackLogs().then(() => { loadFeedbackList(); });
            } else if (d.result === "duplicate") {
                const decision = await Swal.fire({
                    icon: 'warning',
                    title: 'Mükerrer Dinleme',
                    html: `<div style="text-align:left; line-height:1.4;">
                            <b>${formValues.agentName}</b> için <b>Call ID: ${escapeHtml(formValues.callId)}</b> zaten var.<br>
                            <span style="color:#666; font-size:0.9rem;">Yine de yeni kayıt oluşturulsun mu?</span>
                           </div>`,
                    showCancelButton: true,
                    confirmButtonText: 'Evet, zorla kaydet',
                    cancelButtonText: 'Vazgeç',
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
    if(!silent) listEl.innerHTML = 'Yükleniyor...';
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
            // En yeni en üstte olması için ters çevir
            allEvaluationsData = data.evaluations.reverse();
            if(silent) return; // Silent mode ise burada bitir (veri yüklendi)
            listEl.innerHTML = '';
            
            // Sadece normal değerlendirmeleri filtrele ve göster
            const normalEvaluations = allEvaluationsData.filter(e => !String(e.callId).toUpperCase().startsWith('MANUEL-'));
            if (normalEvaluations.length === 0) { listEl.innerHTML = `<p style="text-align:center; color:#666;">Kayıt yok.</p>`; return; }
            
            normalEvaluations.forEach((evalItem, index) => {
                const scoreColor = evalItem.score >= 90 ? '#2e7d32' : (evalItem.score >= 70 ? '#ed6c02' : '#d32f2f');
                let editBtn = isAdminMode ? `<i class="fas fa-pen" style="font-size:1rem; color:#fabb00; cursor:pointer; margin-right:5px;" onclick="event.stopPropagation(); editEvaluation('${evalItem.callId}')"></i>` : '';
                let agentNameDisplay = (targetAgent === 'all' || targetAgent === targetGroup) ? `<span style="font-size:0.8rem; font-weight:bold; color:#555; background:#eee; padding:2px 6px; border-radius:4px; margin-left:10px;">${evalItem.agent}</span>` : '';
                
                // Detay HTML oluşturma
                let detailHtml = '';
                try {
                    // JSON'ı işlerken olası hatalara karşı try-catch
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
                        // JSON olmasına rağmen array değilse (manuel notlar)
                        detailHtml = `<p style="white-space:pre-wrap; margin:0; font-size:0.9rem; background:#fff8e1; padding:10px; border-radius:4px;">${evalItem.details}</p>`;
                    }
                    detailHtml += '</table>';
                } catch (e) { 
                    // JSON parse hatası veya eski/manuel veri formatı
                    detailHtml = `<p style="white-space:pre-wrap; margin:0; font-size:0.9rem; background:#fff8e1; padding:10px; border-radius:4px;">${evalItem.details}</p>`; 
                }
                
                // Geliştirme: Çağrı Tarihi ve Dinlenme Tarihi
                const callDateDisplay = evalItem.callDate && evalItem.callDate !== 'N/A' ? evalItem.callDate : 'N/A';
                const listenDateDisplay = evalItem.date || 'N/A';
                
                listEl.innerHTML += `
                <div class="evaluation-summary" id="eval-summary-${index}" style="border-left:4px solid ${scoreColor}; padding:15px; margin-bottom:10px; border-radius:8px; background:#fff; cursor:pointer;" onclick="toggleEvaluationDetail(${index})">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-weight:700; color:#2c3e50;">${evalItem.agent} ${agentNameDisplay}</div>
                            <!-- Geliştirme: Çağrı Tarihi ve Dinlenme Tarihi -->
                            <div class="eval-date-info">
                                <span><i class="fas fa-phone"></i> Çağrı: ${callDateDisplay}</span>
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
    } catch(err) { if(!silent) listEl.innerHTML = `<p style="color:red; text-align:center;">Hata oluştu.</p>`; }
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
        agentSelect.innerHTML = `<option value="all">-- Tüm ${selectedGroup} Ekibi --</option>`;
    } else {
        agentSelect.innerHTML = `<option value="all">-- Tüm Temsilciler --</option>`;
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
            if (data.result === "success") { adminUserList = data.users.filter(u => u.group !== 'Yönetim'); resolve(adminUserList); } 
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
    const { isConfirmed } = await Swal.fire({ icon: 'question', title: 'Rapor İndirilsin mi?', showCancelButton: true, confirmButtonText: 'İndir' });
    if (!isConfirmed) return;
    Swal.fire({ title: 'Hazırlanıyor...', didOpen: () => Swal.showLoading() });
    
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
            Swal.fire('Başarılı', 'Rapor indirildi.', 'success');
        } else { Swal.fire('Hata', data.message || 'Veri alınamadı.', 'error'); }
    });
}
// --- EVALUATION POPUP & EDIT ---
async function logEvaluationPopup() {
    const agentSelect = document.getElementById('q-admin-agent');
    const agentName = agentSelect ? agentSelect.value : "";
    
    if (!agentName || agentName === 'all') { Swal.fire('Uyarı', 'Lütfen listeden bir temsilci seçiniz.', 'warning'); return; }
    
    let agentGroup = 'Genel';
    const foundUser = adminUserList.find(u => u.name.toLowerCase() === agentName.toLowerCase());
    if (foundUser && foundUser.group) { agentGroup = foundUser.group; }
    
    const isChat = agentGroup.indexOf('Chat') > -1;
    const isTelesatis = agentGroup.indexOf('Telesatış') > -1;
    if (isChat) agentGroup = 'Chat';
    
    Swal.fire({ title: 'Hazırlanıyor...', didOpen: () => Swal.showLoading() });
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
            // Geliştirme: Puan başlığı üstüne gelince tam metin gösterilmesi için title eklendi
            const fullText = escapeForJsString(c.text); 
            if (isChat) {
                let mPts = parseInt(c.mediumScore) || 0; let bPts = parseInt(c.badScore) || 0;
                criteriaFieldsHtml += `<div class="criteria-row" id="row-${i}" data-max-score="${pts}"><div class="criteria-header"><span title="${fullText}">${i+1}. ${c.text}</span><span style="font-size:0.8rem;">Max: ${pts}</span></div><div class="criteria-controls"><div class="eval-button-group"><button class="eval-button eval-good active" data-score="${pts}" onclick="setButtonScore(${i}, ${pts}, ${pts})">İyi (${pts})</button>${mPts > 0 ? `<button class="eval-button eval-medium" data-score="${mPts}" onclick="setButtonScore(${i}, ${mPts}, ${pts})">Orta (${mPts})</button>` : ''}${bPts > 0 ? `<button class="eval-button eval-bad" data-score="${bPts}" onclick="setButtonScore(${i}, ${bPts}, ${pts})">Kötü (${bPts})</button>` : ''}</div><span class="score-badge" id="badge-${i}" style="margin-top:8px; display:block; background:#2e7d32;">${pts}</span></div><input type="text" id="note-${i}" class="note-input" placeholder="Not..." style="display:none;"></div>`;
            } else if (isTelesatis) {
                 criteriaFieldsHtml += `<div class="criteria-row" id="row-${i}" data-max-score="${pts}"><div class="criteria-header"><span title="${fullText}">${i+1}. ${c.text}</span><span>Max: ${pts}</span></div><div class="criteria-controls" style="display:flex; align-items:center; gap:15px; background:#f9f9f9;"><input type="range" class="custom-range slider-input" id="slider-${i}" min="0" max="${pts}" value="${pts}" data-index="${i}" oninput="updateRowSliderScore(${i}, ${pts})" style="flex-grow:1;"><span class="score-badge" id="badge-${i}" style="background:#2e7d32;">${pts}</span></div><input type="text" id="note-${i}" class="note-input" placeholder="Not..." style="display:none;"></div>`;
            }
        });
        criteriaFieldsHtml += `</div>`;
    }
    
    // GÜNCELLENMİŞ MODAL: Call ID zorunlu yapıldı
    const contentHtml = `
        <div class="eval-modal-wrapper">
            <div class="score-dashboard"><div><div style="font-size:0.9rem;">Değerlendirilen</div><div style="font-size:1.2rem; font-weight:bold; color:#fabb00;">${agentName}</div></div><div class="score-circle-outer" id="score-ring"><div class="score-circle-inner" id="live-score">${isCriteriaBased ? '100' : '100'}</div></div></div>
            <div class="eval-header-card"><div><label>Call ID <span style="color:red;">*</span></label><input id="eval-callid" class="swal2-input" style="height:35px; margin:0; width:100%;" placeholder="Call ID"></div><div><label>Tarih</label><input type="date" id="eval-calldate" class="swal2-input" style="height:35px; margin:0; width:100%;" value="${new Date().toISOString().substring(0, 10)}"></div></div>
            ${isCriteriaBased ? criteriaFieldsHtml : `<div style="padding:15px; border:1px dashed #ccc; text-align:center;"><label>Manuel Puan</label><br><input id="eval-manual-score" type="number" class="swal2-input" value="100" min="0" max="100" style="width:100px; text-align:center;"></div><textarea id="eval-details" class="swal2-textarea" placeholder="Detaylar..."></textarea>`}
            <div style="margin-top:15px; padding:10px; background:#fafafa; border:1px solid #eee;"><label>Geri Bildirim Tipi</label><select id="feedback-type" class="swal2-input" style="width:100%; height:40px; margin:0;"><option value="Yok" selected>Yok</option><option value="Sözlü">Sözlü</option><option value="Mail">Mail</option></select></div>
            <div style="margin-top:15px;"><label>Genel Geri Bildirim</label><textarea id="eval-feedback" class="swal2-textarea" style="margin-top:5px; height:80px;"></textarea></div>
        </div>`;
    
    const { value: formValues } = await Swal.fire({
        html: contentHtml, width: '600px', showCancelButton: true, confirmButtonText: ' 💾  Kaydet',
        didOpen: () => { 
            if (isTelesatis) window.recalcTotalSliderScore(); 
            else if (isChat) window.recalcTotalScore(); 
        },
        preConfirm: () => {
            const callId = document.getElementById('eval-callid').value.trim();
            if (!callId) {
                Swal.showValidationMessage('Call ID alanı boş bırakılamaz!');
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
                // DÜZELTME: Hem evaluations hem de feedback logs güncellenmeli
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
    if (!evalData) { Swal.fire('Hata', 'Kayıt bulunamadı.', 'error'); return; }
    
    const agentName = evalData.agent;
    const agentGroupRaw = evalData.group || 'Genel';
    const isChat = agentGroupRaw.indexOf('Chat') > -1;
    const isTelesatis = agentGroupRaw.indexOf('Telesatış') > -1;
    let agentGroup = isChat ? 'Chat' : (isTelesatis ? 'Telesatış' : 'Genel');
    
    Swal.fire({ title: 'İnceleniyor...', didOpen: () => Swal.showLoading() });
    let criteriaList = [];
    if(agentGroup && agentGroup !== 'Genel') criteriaList = await fetchCriteria(agentGroup);
    Swal.close();
    
    const isCriteriaBased = criteriaList.length > 0;
    let oldDetails = []; try { oldDetails = JSON.parse(evalData.details || "[]"); } catch(e) { oldDetails = []; }
    
    // GÜNCELLENMİŞ MODAL: Call ID gösteriliyor
    let contentHtml = `<div class="eval-modal-wrapper" style="border-top:5px solid #1976d2;"><div class="score-dashboard"><div><div style="font-size:0.9rem;">DÜZENLENEN</div><div style="font-size:1.2rem; font-weight:bold; color:#1976d2;">${agentName}</div></div><div class="score-circle-outer" id="score-ring"><div class="score-circle-inner" id="live-score">${evalData.score}</div></div></div><div class="eval-header-card"><div><label>Call ID</label><input id="eval-callid" class="swal2-input" value="${evalData.callId}" readonly style="background:#eee; height:35px; width:100%;"></div></div>`;
    
    if (isCriteriaBased) {
        contentHtml += `<div class="criteria-container">`;
        criteriaList.forEach((c, i) => {
            let pts = parseInt(c.points) || 0; if(pts===0) return;
            let mPts = parseInt(c.mediumScore) || 0; let bPts = parseInt(c.badScore) || 0;
            let oldItem = oldDetails.find(d => d.q === c.text) || (oldDetails[i] ? oldDetails[i] : {score:pts, note:''});
            let cVal = parseInt(oldItem.score); let cNote = oldItem.note || '';
            
            // Geliştirme: Puan başlığı üstüne gelince tam metin gösterilmesi için title eklendi
            const fullText = escapeForJsString(c.text); 
            if (isChat) {
                let gAct = cVal === pts ? 'active' : ''; let mAct = (cVal===mPts && mPts!==0) ? 'active' : ''; let bAct = (cVal===bPts && bPts!==0) ? 'active' : '';
                if(cVal===0 && bPts===0) bAct = 'active'; else if (cVal===0 && bPts>0) { gAct=''; mAct=''; bAct=''; }
                contentHtml += `<div class="criteria-row" id="row-${i}" data-max-score="${pts}"><div class="criteria-header"><span title="${fullText}">${i+1}. ${c.text}</span><span>Max: ${pts}</span></div><div class="criteria-controls"><div class="eval-button-group"><button class="eval-button eval-good ${gAct}" data-score="${pts}" onclick="setButtonScore(${i}, ${pts}, ${pts})">İyi</button>${mPts>0?`<button class="eval-button eval-medium ${mAct}" data-score="${mPts}" onclick="setButtonScore(${i}, ${mPts}, ${pts})">Orta</button>`:''}${bPts>0?`<button class="eval-button eval-bad ${bAct}" data-score="${bPts}" onclick="setButtonScore(${i}, ${bPts}, ${pts})">Kötü</button>`:''}</div><span class="score-badge" id="badge-${i}">${cVal}</span></div><input type="text" id="note-${i}" class="note-input" value="${cNote}" style="display:${cVal<pts?'block':'none'}"></div>`;
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
        html: contentHtml, width: '600px', showCancelButton: true, confirmButtonText: ' 💾  Güncelle',
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
        Swal.fire({ title: 'Güncelleniyor...', didOpen: () => Swal.showLoading() });
        fetch(SCRIPT_URL, { 
            method: 'POST', 
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: "updateEvaluation", username: currentUser, token: getToken(), ...formValues }) 
        })
        .then(r => r.json()).then(d => {
            if (d.result === "success") { 
                Swal.fire({ icon: 'success', title: 'Güncellendi', timer: 1500, showConfirmButton: false }); 
                // DÜZELTME: Güncelleme sonrası hem evaluations hem de feedback logs güncellenmeli
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
   ANA SAYFA + TEKNİK + TELESATIŞ (FULLSCREEN) GÜNCELLEMESİ
   ========================================================= */

const TELESales_OFFERS_FALLBACK = [{"offer": "YILLIK - 1299 TL", "segment": "WİNBACK", "description": "Kullanıcı daha önce aylık ya da yıllık herhangi bir paket kullanmış, ardından paket sonlanmış ve şu anda aktif paketi olmayan kullanıcıları aradığımız bir data", "note": "Kullanıcının izleme geçmişi olabilir."}, {"offer": "AYLIK  - 6 AY 109 TL", "segment": "WİNBACK", "description": "Kullanıcı daha önce aylık ya da yıllık herhangi bir paket kullanmış, ardından paket sonlanmış ve şu anda aktif paketi olmayan kullanıcıları aradığımız bir data", "note": "Kullanıcının izleme geçmişi olabilir."}, {"offer": "YILLIK - 1399 TL", "segment": "CANCELLİNG", "description": "Aboneliğinde iptal talebinde bulunmuş, paket süresi bitimine kadar erişime devam eden, geri kazanım için aradığımız bir data", "note": "Kullanıcının izleme geçmişi olabilir. İndirim oranı yüksek + Kullanıcının bir iptal nedeni olabilir"}, {"offer": "AYLIK  - 6 AY 119 TL", "segment": "CANCELLİNG", "description": "Aboneliğinde iptal talebinde bulunmuş, paket süresi bitimine kadar erişime devam eden, geri kazanım için aradığımız bir data", "note": "Kullanıcının izleme geçmişi olabilir. İndirim oranı yüksek + Kullanıcının bir iptal nedeni olabilir"}, {"offer": "YILLIK - 1499 TL", "segment": "ACTİVE GRACE", "description": "Paket yenileme sürecine giren fakat ücret alınamadığı için paketi yenilenemeyen kullanıcıları aradığımız bir data", "note": "Paket yenileme sürecinden bir ödeme sorunu oluştuğunu bu nedenle aboneliğinin yenilenmediğini, kullanıcıya hem bu sorunu çözmek hem de indirimli fiyatlar üzerinden yardımcı olmak +İçerik"}, {"offer": "AYLIK  - 6 AY 109 TL", "segment": "ACTİVE GRACE", "description": "Paket yenileme sürecine giren fakat ücret alınamadığı için paketi yenilenemeyen kullanıcıları aradığımız bir data", "note": "Paket yenileme sürecinden bir ödeme sorunu oluştuğunu bu nedenle aboneliğinin yenilenmediğini, kullanıcıya hem bu sorunu çözmek hem de indirimli fiyatlar üzerinden yardımcı olmak +İçerik"}, {"offer": "YILLIK - 1499 TL", "segment": "INBOUND", "description": "Inbound üzerinden gelen satın alma talepleri ya da satışa ikna edilen kullanıcılar için sunulan teklif", "note": ""}, {"offer": "AYLIK - 6 AY 139,5 TL", "segment": "INBOUND", "description": "Inbound üzerinden gelen satın alma talepleri ya da satışa ikna edilen kullanıcılar için sunulan teklif", "note": ""}];
const SPORTS_RIGHTS_FALLBACK = [{"item": "Euroleague maçları ve stüdyo programları", "period": "2025-2026 / 2026- 2027 / 2027-2028 / 2028-2029", "note": ""}, {"item": "Bundesliga", "period": "2025-2026 / 2026- 2027 / 2027-2028 / 2028-2029", "note": ""}, {"item": "Bundesliga 2", "period": "2025-2026 / 2026- 2027 / 2027-2028 / 2028-2029", "note": ""}, {"item": "İspanya LaLiga önemli maçları", "period": "2025 - 2026 / 2026 - 2027", "note": ""}, {"item": "LaLiga 2 önemli maçları", "period": "2025 - 2026 / 2026 - 2027", "note": ""}, {"item": "İtalya Serie A önemli maçları", "period": "2025 - 2026 / 2026 - 2027", "note": ""}, {"item": "Portekiz Liga Portugal önemli maçları", "period": "2025 - 2026", "note": ""}, {"item": "Suudi Arabistan Pro Lig önemli maçları", "period": "2025-2026 / 2026- 2027 / 2027-2028 / 2028-2029", "note": ""}, {"item": "Hollanda Ligi", "period": "2025-2026 / 2026- 2027 / 2027-2028 / 2028-2029", "note": ""}, {"item": "İskoçya Premiership önemli maçları", "period": "2025 - 2026 / 2026 - 2027", "note": ""}, {"item": "NCAA Amerikan Futbol", "period": "2025 - 2026 / 2026 - 2027", "note": ""}, {"item": "NCAA Basketbol", "period": "2025 - 2026 / 2026 - 2027", "note": ""}, {"item": "NFL", "period": "2025 - 2026", "note": ""}, {"item": "NBA", "period": "2025-2026 / 2026- 2027 / 2027-2028 / 2028-2029", "note": ""}, {"item": "EuroCup", "period": "2025-2026 / 2026- 2027 / 2027-2028 / 2028-2029", "note": ""}, {"item": "Yunanistan Basketbol Ligi önemli maçları", "period": "2025 - 2026 Sezon belirsiz", "note": ""}, {"item": "NCAA", "period": "2025 - 2026 / 2026 - 2027", "note": ""}, {"item": "Libertadores Kupası", "period": "2027, 2028, 2029, 2030 (4 seasons)", "note": ""}, {"item": "Copa Sudamericana", "period": "2027, 2028, 2029, 2030 (4 seasons)", "note": ""}, {"item": "WRC", "period": "2025", "note": "2026 da alınabilir net değil"}, {"item": "Nascar", "period": "2025 - 2026 - 2027 - 2028 ve 2029", "note": ""}, {"item": "IndyCar", "period": "2025 - 2026 - 2027", "note": ""}, {"item": "MotoGP - Moto2 - Moto3", "period": "2025 - 2026 - 2027", "note": ""}, {"item": "ATP Tenis Turnuvaları önemli maçlar", "period": "2025 - 2026 - 2027 and 2028", "note": ""}, {"item": "Wimbledon Tenis önemli maçlar", "period": "2025 - 2026 - 2027", "note": ""}, {"item": "UFC Dövüş Gecesi yayınları", "period": "2027 sonuna kadar bizde", "note": ""}, {"item": "Oktagon", "period": "2025", "note": ""}, {"item": "PFL MMA", "period": "2025", "note": ""}, {"item": "Cage Warriors Boks Maçları", "period": "2025", "note": ""}, {"item": "BKFC", "period": "Kaldırıldı", "note": ""}];

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
    // --- BUGÜN NELER VAR? (Yayın Akışı / bugünün maçları) ---
    const todayEl = document.getElementById('home-today');
    if(todayEl){
        todayEl.innerHTML = '<div class="home-mini-item">Yayın akışı yükleniyor...</div>';
        (async()=>{
            try{
                const items = await fetchBroadcastFlow();
                const todayISO = new Date().toISOString().slice(0,10);

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

                    // Saati geçen karşılaşmalar görünmesin
                    const now = Date.now();
                    const se = Number(it.startEpoch || 0);
                    if(se) return se > now;
                    const t = String(it.time || '').trim();
                    const m = t.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
                    if(!m) return true; // saat formatı yoksa göster
                    const hh = parseInt(m[1],10), mm = parseInt(m[2],10), ss = parseInt(m[3]||'0',10);
                    const dt = new Date();
                    dt.setHours(hh,mm,ss,0);
                    return dt.getTime() > now;
                });

                if(!todays.length){
                    todayEl.innerHTML = '<div class="home-mini-item">Bugün için yayın akışı kaydı bulunamadı.</div>';
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
                            <div class="home-mini-date">${time}${league?` • ${league}`:''}${ch?` • ${ch}`:''}</div>
                            <div class="home-mini-title">${title || 'Maç'}</div>
                            ${spk ? `<div class="home-mini-desc" style="margin-top:4px;color:#555">🎙 ${spk}</div>` : ''}
                          </div>
                        `;
                    }).join('') + (todays.length>shown.length ? `<div style="color:#666;font-size:.9rem;margin-top:6px">+${todays.length-shown.length} maç daha…</div>` : '');
                }


                // kartı tıklayınca yayın akışına git
                const card = todayEl.closest('.home-card');
                if(card){
                    card.classList.add('clickable');
                    card.onclick = ()=>openBroadcastFlow();
                }
            }catch(e){
                todayEl.innerHTML = '<div class="home-mini-item">Yayın akışı alınamadı.</div>';
            }
        })();
    }

    // --- DUYURULAR (son 3 duyuru) ---
    const annEl = document.getElementById('home-ann');
    if(annEl){
        const latest = (newsData || []).slice(0,3);
        if(latest.length===0){
            annEl.innerHTML = '<div class="home-mini-item">Henüz duyuru yok.</div>';
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

    // --- GÜNÜN SÖZÜ (HomeBlocks -> e-tabla) ---
    const quoteEl = document.getElementById('home-quote');
    if(quoteEl){
        const q = String((homeBlocks && homeBlocks.quote && homeBlocks.quote.content) ? homeBlocks.quote.content : (localStorage.getItem('homeQuote')||'')).trim();
        quoteEl.innerHTML = q ? escapeHtml(q) : '<span style="color:#999">Bugün için bir söz eklenmemiş.</span>';
    }

    // Admin: edit butonlarını aç
    try{
        const b1 = document.getElementById('home-edit-today');
        const b2 = document.getElementById('home-edit-ann');
        const b3 = document.getElementById('home-edit-quote');
        if(b1) b1.style.display = 'none'; // artık dinamik
        if(b2) b2.style.display = 'none'; // duyuru dinamik
        if(b3) b3.style.display = (isAdminMode && isEditingActive ? 'inline-flex' : 'none');
    }catch(e){}
}



// Ana Sayfa - Günün Sözü düzenleme (sadece admin mod + düzenleme açıkken)
function editHomeBlock(kind){
    if(!isAdminMode){
        Swal.fire("Yetkisiz", "Bu işlem için admin yetkisi gerekli.", "warning");
        return;
    }
    if(!isEditingActive){
        Swal.fire("Kapalı", "Düzenleme modu kapalı. Önce 'Düzenlemeyi Aç' demelisin.", "info");
        return;
    }
    if(kind !== 'quote'){
        Swal.fire("Bilgi", "Bu alan artık otomatik güncelleniyor.", "info");
        return;
    }
    const cur = String((homeBlocks && homeBlocks.quote && homeBlocks.quote.content) ? homeBlocks.quote.content : (localStorage.getItem('homeQuote') || '')).trim();
    Swal.fire({
        title: "Günün Sözü",
        input: "textarea",
        inputValue: cur,
        inputPlaceholder: "Bugünün sözünü yaz…",
        showCancelButton: true,
        confirmButtonText: "Kaydet",
        cancelButtonText: "Vazgeç",
        preConfirm: (val)=> (val||'').trim()
    }).then(res=>{
        if(!res.isConfirmed) return;
        const val = res.value || '';
        // local fallback
        try{ localStorage.setItem('homeQuote', val); }catch(e){}
        // e-tabla (HomeBlocks)
        apiCall('updateHomeBlock', { key:'quote', title:'Günün Sözü', content: val, visibleGroups:'' })
          .then(()=>{
            homeBlocks = homeBlocks || {};
            homeBlocks.quote = { key:'quote', title:'Günün Sözü', content: val, visibleGroups:'' };
            try{ localStorage.setItem('homeBlocksCache', JSON.stringify(homeBlocks||{})); }catch(e){}
            renderHomePanels();
            Swal.fire("Kaydedildi", "Günün sözü güncellendi.", "success");
          })
          .catch(()=>{
            renderHomePanels();
            Swal.fire("Kaydedildi", "Günün sözü güncellendi (yerel).", "success");
          });
    });
}

// Kart detayını doğrudan açmak için küçük bir yardımcı
function openCardDetail(cardId){
    const card = (cardsData||[]).find(x=>String(x.id)===String(cardId));
    if(!card){Swal.fire('Hata','Kart bulunamadı.','error');return;}
    showCardDetail(card);
}

/* -------------------------
   TELE SATIŞ FULLSCREEN
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
    if(!d || d.result !== "success") throw new Error((d && d.message) ? d.message : "Veri alınamadı.");
    // backend handleFetchData returns {data:[...]} ; other handlers may use {items:[...]}
    return d.data || d.items || [];
}

async function openTelesalesArea(){
    // Menü yetkisi: telesales (TeleSatış) - yetkisiz kullanıcı fullscreen'e giremesin
    try{
        const perm = (typeof menuPermissions!=="undefined" && menuPermissions) ? menuPermissions["telesales"] : null;
        if(perm && !isAllowedByPerm(perm)){
            Swal.fire("Yetkisiz", "TeleSatış ekranına erişimin yok.", "warning");
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
    if(nm) nm.innerText = currentUser || 'Kullanıcı';
    if(rl) rl.innerText = isAdminMode ? 'Admin' : 'Temsilci';

    // Data teklifleri: önce e-tabladan çekmeyi dene, olmazsa fallback
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
                title: o.title || o.Başlık || o.Baslik || o.Teklif || o['Teklif Adı'] || o['Teklif Adi'] || '',
                desc: o.desc || o.Açıklama || o.Aciklama || o.Detay || o['Detay/Not'] || o.Not || '',
                example: o.example || o.Örnek || o.Ornek || '',
                tips: o.tips || o.İpucu || o.Ipucu || '',
                objection: o.objection || o.Itiraz || '',
                reply: o.reply || o.Cevap || ''
            }))
            : (Array.isArray(window.telesalesOffersFromSheet) && window.telesalesOffersFromSheet.length
                ? window.telesalesOffersFromSheet
                : TELESales_OFFERS_FALLBACK);
    }

    // Segment filtresi kaldırıldı
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
    sel.innerHTML = '<option value="all">Tüm Segmentler</option>' + segs.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
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
        grid.innerHTML = bar + '<div style="opacity:.7;padding:20px;grid-column:1/-1">Sonuç bulunamadı.</div>';
        const cnt = document.getElementById('t-data-count'); if(cnt) cnt.innerText = '0 kayıt';
        return;
    }

    const cnt = document.getElementById('t-data-count');
    if(cnt) cnt.innerText = `${list.length} kayıt`;

    grid.innerHTML = bar + list.map((o, idx)=>`
        <div class="q-training-card" onclick="showTelesalesOfferDetail(${idx})" style="cursor:pointer">
          <div class="t-training-head">
            <div style="min-width:0">
              <div class="q-item-title" style="font-size:1.02rem">${escapeHtml(o.title||'Teklif')}</div>
            </div>
            <div class="t-training-badge">${escapeHtml(o.segment||o.tag||'')}</div>
          </div>
          <div class="t-training-desc">${escapeHtml((o.desc||'').slice(0,140))}${(o.desc||'').length>140?'...':''}</div>
          <div style="margin-top:10px;color:#999;font-size:.8rem">(Detay için tıkla)</div>
          ${(isAdminMode && isEditingActive) ? `
            <div style="margin-top:12px;display:flex;gap:10px">
              <button class="x-btn x-btn-admin" onclick="event.stopPropagation(); editTelesalesOffer(${idx});"><i class="fas fa-pen"></i> Düzenle</button>
              <button class="x-btn x-btn-admin" onclick="event.stopPropagation(); deleteTelesalesOffer(${idx});"><i class="fas fa-trash"></i> Sil</button>
            </div>
          ` : ``}
        </div>
    `).join('');
}

function addTelesalesOffer(){
    Swal.fire({
        title:"TeleSatış Teklifi Ekle",
        html: `
          <input id="to-title" class="swal2-input" placeholder="Başlık">
          <input id="to-seg" class="swal2-input" placeholder="Segment / Etiket (opsiyonel)">
          <textarea id="to-desc" class="swal2-textarea" placeholder="Açıklama"></textarea>
          <textarea id="to-detail" class="swal2-textarea" placeholder="Detay (opsiyonel)"></textarea>
        `,
        showCancelButton:true,
        confirmButtonText:"Ekle",
        cancelButtonText:"Vazgeç",
        preConfirm: ()=>{
            const title=(document.getElementById('to-title').value||'').trim();
            if(!title) return Swal.showValidationMessage("Başlık zorunlu");
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
          Swal.fire('Hata','Sunucu hatası.', 'error');
        }
    });
}

async function editTelesalesOffer(idx){
    const o = (telesalesOffers||[])[idx];
    if(!o) return;
    const { value: v } = await Swal.fire({
        title:"Teklifi Düzenle",
        html: `
          <input id="to-title" class="swal2-input" placeholder="Başlık" value="${escapeHtml(o.title||'')}">
          <input id="to-seg" class="swal2-input" placeholder="Segment / Etiket" value="${escapeHtml(o.segment||'')}">
          <textarea id="to-desc" class="swal2-textarea" placeholder="Açıklama">${escapeHtml(o.desc||'')}</textarea>
          <textarea id="to-detail" class="swal2-textarea" placeholder="Detay">${escapeHtml(o.detail||'')}</textarea>
        `,
        showCancelButton:true,
        confirmButtonText:"Kaydet",
        cancelButtonText:"Vazgeç",
        preConfirm: ()=>{
            const title=(document.getElementById('to-title').value||'').trim();
            if(!title) return Swal.showValidationMessage("Başlık zorunlu");
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
      Swal.fire('Hata','Sunucu hatası.', 'error');
    }
}

function deleteTelesalesOffer(idx){
    const o = (telesalesOffers||[])[idx];
    if(!o) return;
    Swal.fire({
        title:"Silinsin mi?",
        text:"Teklif pasife alınacak.",
        icon:"warning",
        showCancelButton:true,
        confirmButtonText:"Sil",
        cancelButtonText:"Vazgeç"
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
          Swal.fire('Hata','Sunucu hatası.', 'error');
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

    // İstek: TeleSatış Scriptler'deki ayrı "Düzenlemeyi Aç" kalksın.
    // Düzenleme sadece üst kullanıcı menüsündeki global "Düzenlemeyi Aç" aktifken yapılabilsin.
    const bar = (isAdminMode && isEditingActive) ? `
        <div style="display:flex;gap:10px;align-items:center;margin:6px 0 12px;">
          <button class="x-btn x-btn-admin" onclick="addTelesalesScript()"><i class="fas fa-plus"></i> Script Ekle</button>
        </div>
    ` : '';

    if(list.length===0){
        area.innerHTML = bar + '<div style="padding:16px;opacity:.7">Script bulunamadı.</div>';
        return;
    }

    area.innerHTML = bar + list.map((s, i)=>`
      <div class="news-item" style="border-left-color:#10b981;cursor:pointer" onclick="copyText('${escapeForJsString(s.text||'')}')">
        <span class="news-title">${escapeHtml(s.title||'Script')}</span>
        <div class="news-desc" style="white-space:pre-line">${escapeHtml(s.text||'')}</div>
        <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin-top:10px">
          <div class="news-tag" style="background:rgba(16,185,129,.08);color:#10b981;border:1px solid rgba(16,185,129,.25)">Tıkla & Kopyala</div>
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
          <input id="ts-title" class="swal2-input" placeholder="Başlık">
          <textarea id="ts-text" class="swal2-textarea" placeholder="Script metni"></textarea>
        `,
        showCancelButton:true,
        confirmButtonText:"Ekle",
        cancelButtonText:"Vazgeç",
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
        title:"Script Düzenle",
        html: `
          <input id="ts-title" class="swal2-input" placeholder="Başlık" value="${escapeHtml(s.title||'')}">
          <textarea id="ts-text" class="swal2-textarea" placeholder="Script metni">${escapeHtml(s.text||'')}</textarea>
        `,
        showCancelButton:true,
        confirmButtonText:"Kaydet",
        cancelButtonText:"Vazgeç",
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
    Swal.fire({title:"Silinsin mi?", icon:"warning", showCancelButton:true, confirmButtonText:"Sil", cancelButtonText:"Vazgeç"}).then(res=>{
        if(!res.isConfirmed) return;
        const arr = getTelesalesScriptsStore().filter((_,i)=>i!==idx);
        saveTelesalesScriptsStore(arr);
        renderTelesalesScripts();
    });
}

function renderTelesalesDocs(){
    const box = document.getElementById('t-docs');
    if(!box) return;
    const docs = (trainingData||[]).filter(t=>(t.target||'')==='Telesatış' || (t.title||'').toLowerCase().includes('telesatış'));
    if(docs.length===0){
        box.innerHTML = '<div style="opacity:.7;padding:10px">Bu ekibe atanmış döküman/eğitim görünmüyor.</div>';
        return;
    }
    box.innerHTML = docs.map(d=>`
      <div class="news-item" style="border-left-color:var(--secondary)">
        <span class="news-date">${escapeHtml((d.startDate||'') + (d.endDate?(' → '+d.endDate):''))}</span>
        <span class="news-title">${escapeHtml(d.title||'')}</span>
        <div class="news-desc">${escapeHtml(d.desc||'')}</div>
        ${d.link && d.link!=='N/A' ? `<a class="btn btn-link" href="${escapeHtml(d.link)}" target="_blank">Link</a>`:''}
        ${d.docLink && d.docLink!=='N/A' ? `<a class="btn btn-link" href="${escapeHtml(d.docLink)}" target="_blank">Döküman</a>`:''}
      </div>
    `).join('');
}

/* -------------------------
   TEKNİK FULLSCREEN
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
    if(nm) nm.innerText = currentUser || 'Kullanıcı';
    if(rl) rl.innerText = isAdminMode ? 'Admin' : 'Temsilci';

    // İlk açılışta "bozuk görünüm" (flicker) olmasın: veri gelene kadar bekle
    try{
        if((!database || database.length===0) && window.__dataLoadedPromise){
            const lists = ['x-broadcast-list','x-access-list','x-app-list','x-activation-list','x-cards'];
            lists.forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML = '<div class="home-mini-item">Yükleniyor...</div>'; });
            await window.__dataLoadedPromise;
        }
    }catch(e){}

    // İçerikler switchTechTab içinde yükleniyor
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

const TECH_DOC_CONTENT = {"broadcast": [{"title": "Smart TV – Canlı Yayında Donma Problemi Yaşıyorum", "body": "Müşterinin sorun yaşadığı yayın ya da yayınlarda genel bir sorun var mı kontrol edilir? Genel bir sorun var ise teknik ekibin incelediği yönünde bilgi verilir.\nMüşterinin kullandığı cihaz TVmanager ‘da loglardan kontrol edilir. Arçelik/Beko/Grundig/Altus marka Android TV olmayan Smart TV’lerden ise genel sorun hakkında bilgi verilir.\nYukarıdaki durumlar dışında yaşanan bir sorun ise TV ve modemin elektrik bağlantısını kesilip tekrar verilmesi istenir. « Yaşadığınız sorunu kontrol ederken TV ve modeminizin elektrik bağlantısını kesip 10 sn sonra yeniden açabilir misiniz? Ardından yeniden yayını açıp kontrol edebilir misiniz? (Ayrıca öneri olarak modemi kapatıp tekrar açtıktan sonra, sadece izleme yaptığı cihaz modeme bağlı olursa daha iyi bir bağlantı olacağı bilgisi verilebilir)\nSorun devam eder ise Smart TV tarayıcısından https://www.hiztesti.com.tr/ bir hız testi yapması sonucu bizimle paylaşması istenir.\nHız testi sonucu 8 Mbps altında ise internet bağlantı hızının düşük olduğunu internet servis sağlayıcısı iletişime geçmesi istenir.\n8 Mbps üzerinde ise müşteriden sorunu gösteren kısa bir video talep edilir.\nVideo kaydı ve hız testinin sonuçları gösteren bilgiler alındıktan sonra müşteriye incelenmesi için teknik ekibimize iletildiği inceleme tamamlandığında eposta ile bilgi verileceği yönünde bilgi verilir.\nSorun aynı gün içinde benzer cihazlarda farklı müşterilerde yaşıyor ise tüm bilgilerle Erlab’a arıza kaydı açılır. Sorun birkaç müşteri ile sınırlı ise 17:00 – 01:00 vardiyasındaki ekip arkadaşında sistemsel bir sorun olmadığına dair eposta gönderilmesi için bilgileri paylaşılır."}, {"title": "Mobil Uygulama – Canlı Yayında Donma Sorunu Yaşıyorum", "body": "Müşterinin sorun yaşadığı yayın ya da yayınlarda genel bir sorun var mı kontrol edilir? Genel bir sorun var ise teknik ekibin incelediği yönünde bilgi verilir.(Müşteri İOS veya Android işletim sistemli hangi cihazdan izliyorsa, mümkünse aynı işletim sistemli mobil cihazdan kontrol edilebilir, gerekirse ekip arkadaşlarından kontrol etmeleri istenebilir)\nGenel bir sorun yok ise, www.hiztesti.com.tr link üzerinden hız testi yapması sonucu bizimle paylaşması istenir.\nHız testi sonucu 8 mbps altında ise internet bağlantı hızının düşük olduğu internet servisi sağlayıcısı ile iletişime geçmesi istenir. (Öneri olarak modemi kapatıp tekrar açtıktan sonra sadece izleme yaptığı cihaz modeme bağlı olursa daha iyi bir bağlantı olacağı bilgisi verilebilir)\n8 mbps üzerinde ise, uygulama verilerin temizlenmesi veya uygulamanın silip tekrar yüklenmesi istenilir, sorun devam etmesi durumunda sorunu gösteren video kaydı istenir.\n 4. Hız testi, cihaz marka model ve sürüm bilgileri alındıktan sonra, incelenmesi için teknik ekibe iletildiği, inceleme tamamlandığında e-posta  ile bilgi verileceği yönünde bilgi verilir.\n 5. Sorun aynı gün içerinde benzer cihazlarda farklı müşterilerde yaşıyor ise tüm bilgilerle Erlab’a arıza kaydı açılır. Sorun birkaç müşteri ile sınırlı  ise 17:00 – 01:00 vardiyasındaki ekip arkadaşında sistemsel bir sorun olmadığına dair eposta gönderilmesi için bilgileri paylaşılır."}, {"title": "Bilgisayar – Canlı Yayında Donma Sorunu Yaşıyorum", "body": "Müşterinin sorun yaşadığı yayın ya da yayınlarda genel bir sorun var mı kontrol edilir? Genel bir sorun var ise teknik ekibin incelediği yönünde bilgi verilir.\nGenel bir sorun değilse, öncelikle https://www.hiztesti.com.tr/ bir hız testi yapması sonucu bizimle paylaşması istenir.\nHız testi sonucu 8 mbps altında ise internet bağlantı hızının düşük olduğunu internet servis sağlayıcısı iletişime geçmesi istenir.\n8 mbps üzerinde ise müşteriden aşağıdaki adımları uygulaması istenir.\n3. Bilgisayarın işletim sitemi öğrenilip, görüşme üzerinden ‘’pingWindows7’’ veya ‘’pingwindows10’’ kısayollarından müşteri sunucuları kontrol edilir.\n(Windows 10 üzeri işletim sistemi cihazlara pingwindows10 kısayolu gönderilebilir.)\n4. Sunucu kontrol ekranında kontrol edilmesi gereken, ok ile gösterilen yerden, sunucu ile kayıp olup olmadığı ve kırmızı alan içerisinde sunucu ile web sitemize kaç saniyede işlem sağladığı kontrol edilir.\n5. 1 – 35 arası normal sayılabilir, bu saniye aralığında sorun yaşanıyorsa, web sitemize daha hızlı tepsi süresi veren ve genellikle sorunsuz bir şekilde izleme sağlanabilen 193.192.103.249, 185.11.14.27 veya 195.175.178.8 sunucuları kontrol edilmelidir.\n6. Uygun sunucuyu tespit ettikten sonra canlı destek ekranında ‘’Host’’ ‘’host2’’ kısa yolları kullanarak, kısa yoldaki adımlar ile müşterinin sadece bizim sitemize bağlandığı sunucusunu, en uygun sunucu ile değiştirip tarayıcı açıp kapattırdıktan sonra tekrar yayını kontrol etmesini iletebiliriz. (Ayrıca müşteri yayınları auto değil, manuel olarak 720 veya 1080p seçip kontrol edilmesi önerilir)\n7. Sorun aynı gün içerinde benzer işletim sistemi veya sunucuda farklı müşterilerde yaşıyor ise tüm bilgilerle Erlab’a arıza kaydı açılır. Sorun birkaç müşteri ile sınırlı ise 17:00 – 01:00 vardiyasındaki ekip arkadaşında sistemsel bir sorun olmadığına dair eposta gönderilmesi için bilgileri paylaşılır"}, {"title": "YAYIN SORUNLARI", "body": "35 sn arası normal sayılabilir, bu saniye aralığında sorun yaşanıyorsa, web sitemize daha hızlı tepsi süresi veren ve genellikle sorunsuz bir şekilde izleme sağlanabilen 193.192.103.249, 185.11.14.27 veya 195.175.178.8 sunucuları kontrol edilmelidir."}, {"title": "MacOS – Canlı Yayında Donma Sorunu Yaşıyorum", "body": "Müşterinin sorun yaşadığı yayın ya da yayınlarda genel bir sorun var mı kontrol edilir? Genel bir sorun var ise teknik ekibin incelediği yönünde bilgi verilir.\nGenel bir sorun değilse, öncelikle https://www.hiztesti.com.tr/ bir hız testi yapması sonucu bizimle paylaşması istenir.\nHız testi sonucu 8 mbps altında ise internet bağlantı hızının düşük olduğunu internet servis sağlayıcısı iletişime geçmesi istenir.\n8 mbps üzerinde ise müşteriden aşağıdaki adımları uygulaması istenir.\nMindbehind üzerinden ‘’pingmacOS’’ kısayolundan müşteri sunucuları kontrol edilir.\nSunucu kontrol ekranında kontrol edilmesi gereken, ‘’packet loss’’ kısmında kayıp olup olmadığı,  alan içerisinde sunucu ile web sitemize kaç saniyede işlem sağladığı kontrol edilir.\n1 – 35 arası normal sayılabilir, bu saniye aralığında sorun yaşanıyorsa, web sitemize daha hızlı tepsi süresi veren ve genellikle sorunsuz bir şekilde izleme sağlanabilen 193.192.103.249, 185.11.14.27 veya 195.175.178.8 sunucuları kontrol edilmelidir.\nUygun sunucuyu tespit ettikten sonra canlı destek ekranında ‘’macOShost’’ kısa yolunu kullanarak, kısa yoldaki adımlar ile müşterinin sadece bizim sitemize bağlandığı sunucuyu, en uygun sunucu ile değiştirip tarayıcı açıp kapattırdıktan sonra tekrar yayını kontrol etmesini iletebiliriz. (Ayrıca müşteri yayınları auto değil, manuel olarak 720 veya 1080p seçip kontrol edilmesi önerilir)\nSorun aynı gün içerinde benzer işletim sistemi veya sunucuda farklı müşterilerde yaşıyor ise tüm bilgilerle Erlab’a arıza kaydı açılır. Sorun birkaç müşteri ile sınırlı ise 17:00 – 01:00 vardiyasındaki ekip arkadaşında sistemsel bir sorun olmadığına dair eposta gönderilmesi için bilgileri paylaşılır."}, {"title": "‘’Yayında beklenmedik bir kesinti oluştu’’ Uyarısı", "body": "Bu uyarı genel bir yayın sorunu olduğunda ya da kullanıcı Türkiye sınırları dışında bir yerden erişim sağladığında karşımıza çıkmaktadır.\nKullanıcının sorun yaşadığı yayın kontrol edilir ve genel bir yayın sorunu olup olmadığı teyit edilir.\nTvmanager’da SubscriberLog ekranından ip adresi alınır ve yurtdışı bir konum olup olmadığı teyit edilir.\nKullanıcı yurtdışında ise erişim sağlayamayacağı bilgisi verilir, VPN kullanıyor ise kapatması istenir.\nTVmanager Devices kısmında oturumlar sonlandırılır ve kullanıcıdan tekrar giriş yaparak kontrol etmesi rica edilir.\nMobil veri veya farklı bir ağda bu hata mesajının alınıp alınmadığı teyit edilir.\nCihaz ve modem kapama ve açma işlemi uygulanır.\nSorun devam eder ise inceleme için cihaz ve diğer bilgilerle teknik ekibimize bilgi verileceği iletilir. Excel de kullanıcıdan alınan bilgiler not edilir."}], "access": [{"title": "ERİŞİM SORUNLARI", "body": "‘’Lisans hakları sebebiyle Türkiye sınırları dışında hizmet verilememektedir.’’ Uyarısı\nAlınan hata müşterinin yurt dışında olması ve yurt içinde ise VPN ya da benzeri bir uygulamanın cihazında aktif olmasından kaynaklanmaktadır.\n\nMüşteriye yurt dışında olup olmadığı sorulur, yurt dışında ise ‘’lisans hakları sebebiyle yayınların yurt dışından izlenemediği’’ yönünde bilgi verilir.\nYurt içinde ise VPN ya da benzeri bir uygulamanın cihazında aktif olup ya da olmadığı sorulur. Aktif ise devre dışı bırakılıp tekrar denemesi önerilir.\nVPN ya da benzeri bir uygulama kullanmıyor ise müşterinin ip adresi öğrenilir ve https://tr.wizcase.com/tools/whats-my-ip/ ip adresi kontrol edilir.  Aynı zamanda adresin vpn üzerinden alınıp alınmadığının kontrolü için https://vpnapi.io adresine girilip kontrol edilir.\nIp adresi yurt dışı ya da ISP bilgisi bilinen bir servis sağlayıcısı değilse müşteriye bulunduğu lokasyonun otel, yurt vb. bir yer olup olmadığı ya da cihazının şirket cihazı olup olmadığı sorulur."}, {"title": "‘’IP Karantina’’ Uyarısı", "body": "İp Karantina sorunu genel bir sorun yok ise, eposta veya şifre bir çok defa hatalı girilmesinden dolayı alınır.\nKullanıcının ip adresi karantina da olup ya da olmadığı, TVmanager – CMS – Admission Gate menüsü üzerinden kontrol edilerek çıkarılabilir. İkinci bir seçenek olarak modem kapama ve açma işlemi yaptırılabilir."}], "app": [{"title": "Teknik Sorun Analizi Nasıl Yapılır?", "body": "App Kaynaklı Nedenler\nCihaz Kaynaklı Nedenler\nApp hataları başlığında uygulamanın açılmaması ya da kendi kendine kapanması şeklinde teknik sorunlar ile karşılaşabiliriz. Bu tip sorunlar, kullanıcı deneyimini doğrudan etkileyerek uygulamaya erişilememesine neden olur.\nUygulamanın eski sürümü\nÖnbellek sorunları\nUyumsuz cihazlar\nDolu RAM/Arka planda çalışan fazla uygulama\nCihazın güncel olmaması (Eski sistemi sürümleri)\nKullanıcıya Sorulabilecek Sorular:\nUygulama açılıyor mu, yoksa açılmadan kapanıyor mu?\nUygulama sürümü, cihaz işletim sistemi sürümü nedir? (TVmanager kontrolü)\nCihazda yeterli depolama alanı var mı?"}], "activation": [{"title": "‘’Promosyon Kodu Bulunamadı’’ Uyarısı", "body": "Görselde ki örnekte doğrusu ‘’YILLIKLOCA’’ olan kampanya kodu, küçük harf ile yazıldığında ‘’Promosyon Kodu Bulunamadı’’ hatası alınmıştır. Bu hata ile karşılaşıldığında kampanya kodunun yanlış, eksik, küçük harf ya da boşluk bırakılarak yazıldığını tespitle, kullanıcıyı bu doğrultuda doğru yazım için yönlendirmemiz gerekir."}, {"title": "‘’Kampanya Kodu Aktif Edilemedi’’ Uyarısı", "body": "Görseldeki örnekteki gibi eski bir promosyon kodu yazıldığında ‘’Kampanya Kodu Aktif Edilemedi’’ uyarısı alınır."}, {"title": "‘’Geçersiz Kampanya Kodu’’ Uyarısı", "body": "Görseldeki örnekteki gibi daha önce kullanılmış bir promosyon kodu yazıldığında ‘’Geçersiz Kampanya Kodu’’ hatası alınır.\nPromosyon kodunun hangi hesapta kullanıldığını aşağıdaki görseldeki gibi Campaign alanında arama yaparak görüntüleyebiliriz."}, {"title": "Playstore Uygulama Aktivasyon Sorunu", "body": "Bazı durumlarda, kullanıcılar Google Play Store üzerinden S Sport Plus uygulamasında abonelik satın aldıklarında veya yenileme gerçekleştiğinde, üyelikleri otomatik olarak aktifleşmeyebiliyor.  Bu durumda, kullanıcının uygulama üzerinden manuel olarak paket aktivasyonu yapması gerekmektedir.\n\nAktivasyon işleminin başarılı olabilmesi için:\n Google Play Store üzerinden satın alma işlemi yapılırken kullanılan Gmail hesabı, aktivasyon anında cihazda açık olmalıdır.\n Aktivasyon işlemi uygulama içerisinden yapılmalıdır.\nDestek ekibi tarafından Mindbehind üzerinden “paketgoogle” kısayolu kullanılarak yönlendirme sağlanabilir.  Kullanıcı başarılı bir şekilde paket aktivasyonu yaptıktan sonra, paket ataması sistemde gerçekleşir ve log kayıtlarında ilgili işlem aşağıdaki gibi görünür (ekli görsellerdeki gibi).  Bu işlem, paketin doğru şekilde tanımlanması için önemlidir."}, {"title": "App Store Uygulama Aktivasyon Sorunu", "body": "Müşteriler App Store üzerinden uygulamamızdan abonelik satın aldığı veya yenileme olduğu zaman bazen üyelik aktif olmuyor.\nÜyelikleri aktif olabilmeleri için, uygulama üzerinden paket aktivasyon yapmaları gerekiyor. Paket aktivasyon yaparken, satın alma yaparken hangi Apple kimliği hesabı açık ise, o hesap açıkken aktivasyon denemesi gerekiyor.\nMindbehind üzerinden ‘’paketapple’’ kısayolu kullanılır.\nMüşteri paket aktivasyonu yaptıktan sonra üyelik ataması ve loglarda nasıl gözüktüğü görsellerdeki gibidir.\nPaket aktivasyon butonu örnek görüntüsü yandaki gibidir."}, {"title": "AKTİVASYON SORUNLARI", "body": "İOS Uygulama Paket Aktivasyon ‘’Abonelik Başkasına Aittir’’ Sorunu\n\nİos uygulamamızda müşteri paket aktivasyon işlemi yaptığında ‘’Abonelik Başkasına Aittir’’ hatası geliyor ise, cihazda açık olan Apple kimliği ile satın alınmış, ancak aktivasyon yaptığı eposta adresi farklı bir eposta adresidir.\n\nFarklı eposta adresi ile paket aktivasyon yaptığında ‘’Subscriberlog’’ kısmında örnek ekran görüntüsünde kırmızı alana alınan ‘’packageValidation’’  kısmı çıkar, ok ile gösterilen ID kısmından doğru üyeliği ID araması ile bulabiliriz."}, {"title": "AKTİVASYON SORUNLARI", "body": "Android ‘’Paket Başka Bir Kullanıcıya Ait Olduğu İçin Paket Atama İşlemi Başarısız Oldu’’ Sorunu\n\nAndroid uygulamamızda müşteri paket aktivasyon işlemi yaptığında ‘’Paket Başka Bir Kullanıcıya Ait Olduğu İçin Paket Atama İşlemi Başarısız Oldu’’ hatası geliyor ise, cihazda açık olan Play Store gmail hesabı ile satın alınmış, ancak aktivasyon yaptığı eposta adresi farklı bir eposta adresidir.\n\nFarklı eposta adresi ile paket aktivasyon yaptığında ‘’Subscriberlog’’ kısmında örnek ekran görüntüsünde kırmızı alana alınan ‘’Validate Google Package’’  kısmı çıkar, ok ile gösterilen ID kısmından doğru üyeliği ID araması ile bulabiliriz."}, {"title": "AKTİVASYON SORUNLARI", "body": "Android Uygulama Paket Aktivasyon İşlem Tamamlanamadı veya Üyelik Bulunamama Sorunu\nAndroid uygulamamızda müşteri ödeme yapmış olmasına rağmen paket aktivasyonu yaptığında ‘’İşlem tamamlandı, İşlem Tamamlanamadı veya Abone bulunamadı’’ hatası geliyor ve üyelik aktif olmuyor ise, müşteriden GPA kodunu paylaşılması istenir.\nGPA kodu, Google tarafından ödeme yapıldığına dair müşteriye gönderilen ödeme faturası (makbuz) içerisinde yer almaktadır.\nBu GPA kodu ile üyeliği Tvmanager üzerinden aşağıdaki görseldeki gibi Reporting > General > Payments kısmında tarihi aralığı ayarlanıp ‘’Transaction Identifer’’ kısmından arama yapılıp, üyelik ID’sine ‘’Subscriber ID’’ üzerinden ulaşılabilir."}, {"title": "AKTİVASYON SORUNLARI", "body": "Türksat Abone Bulunamadı veya Abone Active Değil Sorunu\nBu hata, Hizmet ID veya Geçici Kod hatalı yazılmasından dolayı alınır.  Müşteriler genellikle bazı büyük küçük harfleri karıştırabiliyor veya sistemden dolayı bazen bu sorun alınabiliyor.\nÇözüm olarak harf hatası olmaması için Tvmanager>Reporting>General>Thirtdparty Provisions kısmından tarih aralığı belirleyip, Hizmet ID numarasını ‘’Extrenal ID’’ kısmından aratıp, kullanıcı Türksat bilgilerini bulup ‘’UniqueID’’ kısmından geçici kodu bulup, kullanıcıya paylaştığımızda, ID ve Geçici kodu kopyala yapıştırır şeklinde ilerlemesini iletebiliriz.\nAynı sorun devam eder ise, kullanıcıdan onay alıp, ID ve geçici kod ile kullanıcının üyeliğini kendimiz yapabiliriz. Müşterinin üyeliğini biz tarafından yapıldı ise, müşteriye şifresini nasıl güncelleyebileceği ile ilgili bilgi verilir."}]};

function renderTechSections(){
    // Kaynak: Sheet'ten gelen teknik kartlar + admin override (localStorage)
    const baseCards = (database||[]).filter(c=>String(c.category||'').toLowerCase()==='teknik');
    let override = [];
    try{ override = JSON.parse(localStorage.getItem('techCardsOverride') || '[]'); }catch(e){ override = []; }
    const techCards = (Array.isArray(override) && override.length) ? override : baseCards;

    // Heuristik sınıflandırma
    const buckets = {broadcast:[], access:[], app:[], activation:[], cards:[]};
    techCards.forEach(c=>{
        const hay = `${c.title||''} ${c.text||''} ${c.script||''}`.toLowerCase();
        if(hay.includes('yayın') || hay.includes('don') || hay.includes('buffer') || hay.includes('akış') || hay.includes('tv')){
            buckets.broadcast.push(c);
        }else if(hay.includes('erişim') || hay.includes('vpn') || hay.includes('proxy') || hay.includes('login') || hay.includes('giriş') || hay.includes('yurtdışı')){
            buckets.access.push(c);
        }else if(hay.includes('app') || hay.includes('uygulama') || hay.includes('hata') || hay.includes('crash') || hay.includes('versiyon')){
            buckets.app.push(c);
        }else if(hay.includes('aktivasyon') || hay.includes('satın') || hay.includes('satınalma') || hay.includes('store') || hay.includes('ödeme') || hay.includes('google') || hay.includes('apple')){
            buckets.activation.push(c);
        }else{
            buckets.broadcast.push(c);
        }
        buckets.cards.push(c);
    });

    window.__techBuckets = buckets;

    // Search input bağlama
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

    // İlk çizim
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
          <button class="x-btn x-btn-admin" onclick="toggleTechEdit()"><i class="fas fa-pen"></i> ${techEditMode ? 'Düzenlemeyi Kapat' : 'Düzenlemeyi Aç'}</button>
          ${techEditMode ? `<button class="x-btn x-btn-admin" onclick="addTechCard('${bucketKey}')"><i class="fas fa-plus"></i> Kart Ekle</button>` : ``}
          <span style="color:#888;font-weight:800;font-size:.9rem">Bu düzenlemeler tarayıcıda saklanır (local).</span>
        </div>
    ` : '');

    if(!filtered.length){
        listEl.innerHTML = bar + '<div class="home-mini-item">Kayıt bulunamadı.</div>';
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
    const badge = escapeHtml(c.code || c.category || 'TEKNİK');
    const rawText = (c.text||'').toString();
    const text = escapeHtml(rawText);
    const link = (c.link||'').trim();
    const script = (c.script||'').trim();
    const key = techCardKey(c, idx);

    // Detay butonunu gösterme kriteri (uzun metin / script / link)
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
            <button class="x-btn x-btn-admin" onclick="editTechCard(${JSON.stringify(key)})"><i class="fas fa-pen"></i> Düzenle</button>
            <button class="x-btn x-btn-admin" onclick="deleteTechCard(${JSON.stringify(key)})"><i class="fas fa-trash"></i> Sil</button>
          ` : ``}
        </div>
      </div>
    `;
}

// Teknik kart detayını popup'ta aç (ana ekran kartları gibi)
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
            Swal.fire({icon:'warning', title:'Kayıt bulunamadı', timer:1200, showConfirmButton:false});
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
        Swal.fire('Hata', 'Detay açılamadı.', 'error');
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
          <input id="tc-title" class="swal2-input" placeholder="Başlık">
          <input id="tc-badge" class="swal2-input" placeholder="Etiket (ör: TEKNİK)">
          <input id="tc-link" class="swal2-input" placeholder="Link (opsiyonel)">
          <textarea id="tc-text" class="swal2-textarea" placeholder="Açıklama"></textarea>
          <textarea id="tc-script" class="swal2-textarea" placeholder="Script (opsiyonel)"></textarea>
        `,
        showCancelButton: true,
        confirmButtonText: "Ekle",
        cancelButtonText: "Vazgeç",
        preConfirm: ()=>{
            const title = (document.getElementById('tc-title').value||'').trim();
            if(!title) return Swal.showValidationMessage("Başlık zorunlu");
            return {
                id: 'local_' + Date.now(),
                title,
                code: (document.getElementById('tc-badge').value||'TEKNİK').trim(),
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
        title: "Kartı Düzenle",
        html: `
          <input id="tc-title" class="swal2-input" placeholder="Başlık" value="${escapeHtml(c.title||'')}">
          <input id="tc-badge" class="swal2-input" placeholder="Etiket" value="${escapeHtml(c.code||c.category||'TEKNİK')}">
          <input id="tc-link" class="swal2-input" placeholder="Link" value="${escapeHtml(c.link||'')}">
          <textarea id="tc-text" class="swal2-textarea" placeholder="Açıklama">${escapeHtml(c.text||'')}</textarea>
          <textarea id="tc-script" class="swal2-textarea" placeholder="Script">${escapeHtml(c.script||'')}</textarea>
        `,
        showCancelButton: true,
        confirmButtonText: "Kaydet",
        cancelButtonText: "Vazgeç",
        preConfirm: ()=>{
            const title = (document.getElementById('tc-title').value||'').trim();
            if(!title) return Swal.showValidationMessage("Başlık zorunlu");
            return {
                ...c,
                title,
                code: (document.getElementById('tc-badge').value||'TEKNİK').trim(),
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
        cancelButtonText:"Vazgeç"
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
        el.innerHTML = '<div style="padding:16px;opacity:.7">Bu başlık altında içerik yok.</div>';
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
                el.innerHTML = '<div style="padding:12px 2px;opacity:.7">Bu başlık altında teknik döküman bulunamadı.</div>';
                return;
            }

            el.innerHTML = items.map((it,idx)=>`
                <div class="doc-card">
                  <button type="button" class="doc-head" onclick="toggleDocAccordion(this)">
                    <span class="doc-title">${escapeHtml(it.title||('İçerik ' + (idx+1)))}</span>
                    <i class="fas fa-chevron-down"></i>
                  </button>
                  <div class="doc-body" style="display:none; white-space:pre-line">${escapeHtml(it.body||'')}</div>
                </div>
            `).join('');
        }catch(err){
            console.error('renderTechDocs error', err);
            el.innerHTML = '<div style="padding:12px 2px;opacity:.7">Dökümanlar yüklenemedi. (Konsolu kontrol edin)</div>';
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

    // Ayrı state: fullscreen içindeki gömülü sihirbaz
    window.embeddedTwState = window.embeddedTwState || { currentStep: 'start', history: [] };

    // Veri yoksa yükle
    if(!techWizardData || Object.keys(techWizardData).length === 0){
        box.innerHTML = '<div style="padding:16px;opacity:.7">Sihirbaz yükleniyor...</div>';
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
        box.innerHTML = `<div class="tech-alert">Hata: Adım bulunamadı (${escapeHtml(String(st.currentStep))}).</div>`;
        return;
    }

    const backVisible = st.history && st.history.length>0;

    let html = `
      <div style="display:flex; gap:8px; align-items:center; justify-content:space-between; margin-bottom:12px; flex-wrap:wrap">
        <div style="display:flex; gap:8px; align-items:center">
          ${backVisible ? `<button type="button" class="tech-btn tech-btn-option" onclick="embeddedTwBack('${targetId}')">⬅ Geri</button>` : ''}
          <button type="button" class="tech-btn tech-btn-option" onclick="embeddedTwReset('${targetId}')">↻ Sıfırla</button>
        </div>
        <div style="opacity:.7; font-size:.9rem">Adım: ${escapeHtml(stepData.title || '')}</div>
      </div>

      <div class="tech-step-title">${escapeHtml(stepData.title || '')}</div>
    `;

    if(stepData.text){
        html += `<div style="font-size:1rem; margin:10px 0; white-space:pre-line">${escapeHtml(stepData.text)}</div>`;
    }
    if(stepData.script){
        html += `<div class="tech-script-box"><span class="tech-script-label">Müşteriye iletilecek:</span>${escapeHtml(stepData.script)}</div>`;
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
   TEKNİK KARTLAR (FULLSCREEN)
   - Eski kart görünümü (liste)
   - Düzenleme, E-Tablo (Data) üzerinden (updateContent/addCard)
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
        <input id="tc-title" class="swal2-input" placeholder="Başlık">
        <textarea id="tc-text" class="swal2-textarea" placeholder="Açıklama"></textarea>
        <textarea id="tc-script" class="swal2-textarea" placeholder="Script (opsiyonel)"></textarea>
        <input id="tc-link" class="swal2-input" placeholder="Link (opsiyonel)">
      `,
      showCancelButton: true,
      confirmButtonText: 'Ekle',
      cancelButtonText: 'Vazgeç',
      preConfirm: ()=>{
        const title = (document.getElementById('tc-title').value||'').trim();
        if(!title) return Swal.showValidationMessage('Başlık zorunlu');
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
      Swal.fire('Hata','Sunucu hatası.','error');
    }
}

async function editTechCardSheet(dbIndex){
    if(!isAdminMode) return;
    const it = (database||[])[dbIndex];
    if(!it) return;
    const { value: v } = await Swal.fire({
      title: 'Teknik Kartı Düzenle',
      html: `
        <input id="tc-title" class="swal2-input" placeholder="Başlık" value="${escapeHtml(it.title||'')}">
        <textarea id="tc-text" class="swal2-textarea" placeholder="Açıklama">${escapeHtml(it.text||'')}</textarea>
        <textarea id="tc-script" class="swal2-textarea" placeholder="Script">${escapeHtml(it.script||'')}</textarea>
        <input id="tc-link" class="swal2-input" placeholder="Link" value="${escapeHtml(it.link||'')}">
      `,
      showCancelButton: true,
      confirmButtonText: 'Kaydet',
      cancelButtonText: 'Vazgeç',
      preConfirm: ()=>{
        const title = (document.getElementById('tc-title').value||'').trim();
        if(!title) return Swal.showValidationMessage('Başlık zorunlu');
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
    // sendUpdate sırayla update eder
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
      text:'Kart pasife alınacak.',
      icon:'warning',
      showCancelButton:true,
      confirmButtonText:'Sil',
      cancelButtonText:'Vazgeç'
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
      box.innerHTML = bar + '<div style="opacity:.7;padding:16px">Kayıt bulunamadı.</div>';
      return;
    }

    box.innerHTML = bar + filtered.map(c=>{
      const edit = (isAdminMode && isEditingActive)
        ? `<div style="display:flex;gap:8px;margin-top:10px">
             <button class="x-btn x-btn-admin" onclick="editTechCardSheet(${c.__dbIndex})"><i class="fas fa-pen"></i> Düzenle</button>
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
            const extra = `Yayın hakkı bitiş: ${hit.end || hit.duration}`;
            if(s.tip && !s.tip.includes('Yayın hakkı')) s.tip = `${s.tip} • ${extra}`;
            else if(!s.tip) s.tip = extra;
            if(s.detail && !s.detail.includes('Yayın hakkı')) s.detail = `${s.detail}\n\n${extra}`;
            else if(!s.detail) s.detail = extra;
        }
    });
}

// Var olan veri yüklemesi bittikten sonra hak bilgisi ekle
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
  broadcast: 'Yayın',
  access: 'Erişim Sorunları',
  app: 'App Hataları',
  activation: 'Aktivasyon',
  info: 'Bilgi'
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
  return "";
}

async function __fetchTechDocs(){
  if(!SCRIPT_URL){
    if(typeof showGlobalError === "function") showGlobalError("SCRIPT_URL ayarlı değil. Sağ alttan ayarlayabilirsin.");
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
      baslik: (r.Başlık || r.Baslik || r.Title || r["Başlık"] || "").toString().trim(),
      icerik: (r.İçerik || r.Icerik || r.Content || r["İçerik"] || "").toString(),
      adim: (r.Adım || r.Adim || r.Step || r["Adım"] || "").toString(),
      not: (r.Not || "").toString(),
      link: (r.Link || "").toString(),
      durum: (r.Durum || "").toString()
    }))
    .filter(x => x.categoryKey && x.baslik);
}

async function __fetchTechDocCategories(){
  // K sütunundan okunan kategori listesi (boşsa A sütunundan türetilir)
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
    tabKey==="info" ? "x-info-list" : ""
  );
  if(!listEl) return;

  if(!items || items.length===0){
    listEl.innerHTML = `<div style="padding:16px;opacity:.75">Bu başlık altında henüz içerik yok. (Sheet: Teknik_Dokumanlar)</div>`;
    return;
  }

  // Admin bar (düzenleme global menüden açılır)
  const adminBar = (isAdminMode && isEditingActive)
    ? `<div style="display:flex;gap:10px;align-items:center;margin:0 0 12px;">
         <button class="x-btn x-btn-admin" onclick="addTechDoc('${tabKey}')"><i class=\"fas fa-plus\"></i> Yeni Konu Ekle</button>
       </div>`
    : ``;

  function render(filtered){
    listEl.innerHTML = adminBar + filtered.map((it, idx) => {
      const body = [
        it.icerik ? `<div class="q-doc-body">${it.icerik}</div>` : "",
        it.adim ? `<div class="q-doc-meta"><b>Adım:</b> ${__escapeHtml(it.adim)}</div>` : "",
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

// Teknik fullscreen üst arama kutuları (index.html) için
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

// Teknik_Dokumanlar kategori listesi (Sheet K sütunu)
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
  const m = { broadcast:'Yayın', access:'Erişim Sorunları', app:'App Hataları', activation:'Aktivasyon', info:'Bilgi' };
  return m[tabKey] || 'Yayın';
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
      <input id="td-title" class="swal2-input" placeholder="Başlık">
      <textarea id="td-content" class="swal2-textarea" placeholder="İçerik"></textarea>
      <input id="td-step" class="swal2-input" placeholder="Adım (opsiyonel)">
      <input id="td-note" class="swal2-input" placeholder="Not (opsiyonel)">
      <input id="td-link" class="swal2-input" placeholder="Link (opsiyonel)">
    `,
    showCancelButton:true,
    confirmButtonText:'Ekle',
    cancelButtonText:'Vazgeç',
    preConfirm: ()=>{
      const cat = (document.getElementById('td-cat')?.value || defaultLabel || '').trim();
      if(!cat) return Swal.showValidationMessage('Kategori zorunlu');
      const title = (document.getElementById('td-title').value||'').trim();
      if(!title) return Swal.showValidationMessage('Başlık zorunlu');
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
    Swal.fire('Hata','Sunucu hatası.', 'error');
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
    title: 'Teknik Konuyu Düzenle',
    html: `
      <select id="td-cat" class="swal2-select" style="width:100%;max-width:420px">
        ${optionsHtml}
      </select>
      <input id="td-title" class="swal2-input" placeholder="Başlık" value="${__escapeHtml(it.baslik||'')}">
      <textarea id="td-content" class="swal2-textarea" placeholder="İçerik">${__escapeHtml(it.icerik||'')}</textarea>
      <input id="td-step" class="swal2-input" placeholder="Adım" value="${__escapeHtml(it.adim||'')}">
      <input id="td-note" class="swal2-input" placeholder="Not" value="${__escapeHtml(it.not||'')}">
      <input id="td-link" class="swal2-input" placeholder="Link" value="${__escapeHtml(it.link||'')}">
    `,
    showCancelButton:true,
    confirmButtonText:'Kaydet',
    cancelButtonText:'Vazgeç',
    preConfirm: ()=>{
      const cat = (document.getElementById('td-cat')?.value || it.kategori || '').trim();
      if(!cat) return Swal.showValidationMessage('Kategori zorunlu');
      const title = (document.getElementById('td-title').value||'').trim();
      if(!title) return Swal.showValidationMessage('Başlık zorunlu');
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
    Swal.fire('Hata','Sunucu hatası.', 'error');
  }
}

function deleteTechDoc(tabKey, baslik){
  if(!isAdminMode) return;
  Swal.fire({
    title:'Silinsin mi?',
    text:'Konu pasife alınacak.',
    icon:'warning',
    showCancelButton:true,
    confirmButtonText:'Sil',
    cancelButtonText:'Vazgeç'
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
      Swal.fire('Hata','Sunucu hatası.', 'error');
    }
  });
}

// override / extend existing switchTechTab
window.switchTechTab = async function(tab){
  try{
    // existing visual tab switch
    document.querySelectorAll('#tech-fullscreen .q-nav-item').forEach(li => li.classList.remove('active'));
    const tabMap = {broadcast:'x-view-broadcast',access:'x-view-access',app:'x-view-app',activation:'x-view-activation',info:'x-view-info',wizard:'x-view-wizard',cards:'x-view-cards'};
    const viewId = tabMap[tab];
    // activate clicked item
    const items = Array.from(document.querySelectorAll('#tech-fullscreen .q-nav-menu .q-nav-item'));
    const idx = ['broadcast','access','app','activation','info','wizard','cards'].indexOf(tab);
    if(idx>=0 && items[idx]) items[idx].classList.add('active');

    document.querySelectorAll('#tech-fullscreen .q-view-section').forEach(v => v.classList.remove('active'));
    const viewEl = document.getElementById(viewId);
    if(viewEl) viewEl.classList.add('active');

    if(['broadcast','access','app','activation','info'].includes(tab)){
      const all = await loadTechDocsIfNeeded(false);
      const filtered = all.filter(x => x.categoryKey === tab);
      __renderTechList(tab, filtered);
    }

    if(tab === 'wizard'){
      // Teknik sihirbazı fullscreen içine göm
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
