const BAKIM_MODU = false;
// Apps Script URL'si
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycby3kd04k2u9XdVDD1-vdbQQAsHNW6WLIn8bNYxTlVCL3U1a0WqZo6oPp9zfBWIpwJEinQ/exec";
// Oyun Değişkenleri
let jokers = { call: 1, half: 1, double: 1 };
let doubleChanceUsed = false;
let firstAnswerIndex = -1;
const VALID_CATEGORIES = ['Teknik', 'İkna', 'Kampanya', 'Bilgi'];
const MONTH_NAMES = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
// --- GLOBAL DEĞİŞKENLER ---
let database = [], newsData = [], sportsData = [], salesScripts = [], quizQuestions = [];
let techWizardData = {}; // Teknik Sihirbaz Verisi
let currentUser = "";
let isAdminMode = false;    
let isEditingActive = false;
let sessionTimeout;
let activeCards = [];
let currentCategory = 'all';
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
function getFavs() { return JSON.parse(localStorage.getItem('sSportFavs') || '[]'); }
function toggleFavorite(title) {
    event.stopPropagation();
    let favs = getFavs();
    if (favs.includes(title)) { favs = favs.filter(t => t !== title); } 
    else { favs.push(title); }
    localStorage.setItem('sSportFavs', JSON.stringify(favs));
    if (currentCategory === 'fav') { filterCategory(document.querySelector('.btn-fav'), 'fav'); } 
    else { renderCards(activeCards); }
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
    if (savedUser && savedToken) {
        currentUser = savedUser;
        document.getElementById("login-screen").style.display = "none";
        document.getElementById("user-display").innerText = currentUser;
        checkAdmin(savedRole);
        startSessionTimer();
        
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
                checkAdmin(savedRole);
                startSessionTimer();
                
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
    
    isAdminMode = (role === "admin");
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
            quickEditDropdown.innerHTML = '<i class="fas fa-pen" style="color:var(--secondary);"></i> Düzenlemeyi Aç';
            quickEditDropdown.classList.remove('active');
        }
    } else {
        if(addCardDropdown) addCardDropdown.style.display = 'none';
        if(quickEditDropdown) quickEditDropdown.style.display = 'none';
    }
}
function logout() {
    currentUser = ""; isAdminMode = false; isEditingActive = false;
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
            newsData = rawData.filter(i => i.Type.toLowerCase() === 'news').map(i => ({
                date: formatDateToDDMMYYYY(i.Date), title: i.Title, desc: i.Text, type: i.Category, status: i.Status
            }));
            sportsData = rawData.filter(i => i.Type.toLowerCase() === 'sport').map(i => ({
                title: i.Title, icon: i.Icon, desc: i.Text, tip: i.Tip, detail: i.Detail, pronunciation: i.Pronunciation
            }));
            salesScripts = rawData.filter(i => i.Type.toLowerCase() === 'sales').map(i => ({ title: i.Title, text: i.Text }));
            quizQuestions = rawData.filter(i => i.Type.toLowerCase() === 'quiz').map(i => ({
                q: i.Text, opts: i.QuizOptions ? i.QuizOptions.split(',').map(o => o.trim()) : [], a: parseInt(i.QuizAnswer)
            }));
            
            if(currentCategory === 'fav') { filterCategory(document.querySelector('.btn-fav'), 'fav'); } 
            else { activeCards = database; renderCards(database); }
            startTicker();
        } else { document.getElementById('loading').innerHTML = `Veriler alınamadı: ${data.message || 'Bilinmeyen Hata'}`; }
    }).catch(error => { document.getElementById('loading').innerHTML = 'Bağlantı Hatası! Sunucuya ulaşılamıyor.'; });
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
function filterCategory(btn, cat) {
    currentCategory = cat;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterContent();
}
function filterContent() {
    const search = document.getElementById('searchInput').value.toLocaleLowerCase('tr-TR').trim();
    let filtered = database;
    if (currentCategory === 'fav') { filtered = filtered.filter(i => isFav(i.title)); } 
    else if (currentCategory !== 'all') { filtered = filtered.filter(i => i.category === currentCategory); }
    
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
    renderCards(filtered);
}
function showCardDetail(title, text) {
    Swal.fire({
        title: title, html: `<div style="text-align:left; font-size:1rem; line-height:1.6;">${text.replace(/\\n/g,'<br>')}</div>`,
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
    });

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
    document.getElementById('sales-modal').style.display = 'flex';
    const c = document.getElementById('sales-grid');
    c.innerHTML = '';
    salesScripts.forEach((s, index) => {
        let editBtn = (isAdminMode && isEditingActive) ? `<i class="fas fa-pencil-alt edit-icon" style="top:10px; right:40px; z-index:50;" onclick="event.stopPropagation(); editSales('${escapeForJsString(s.title)}')"></i>` : '';
        c.innerHTML += `<div class="sales-item" id="sales-${index}" onclick="toggleSales('${index}')">${editBtn}<div class="sales-header"><span class="sales-title">${s.title}</span><i class="fas fa-chevron-down" id="icon-${index}" style="color:#10b981;"></i></div><div class="sales-text">${(s.text || '').replace(/\n/g,'<br>')}<div style="text-align:right; margin-top:15px;"><button class="btn btn-copy" onclick="event.stopPropagation(); copyText('${escapeForJsString(s.text || '')}')"><i class="fas fa-copy"></i> Kopyala</button></div></div></div>`;
    });
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

function openPenaltyGame() {
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
    document.getElementById('tech-wizard-modal').style.display = 'flex';
    if (Object.keys(techWizardData).length === 0) {
        Swal.fire({ title: 'Veriler Yükleniyor...', didOpen: () => Swal.showLoading() });
        loadTechWizardData().then(() => { Swal.close(); twResetWizard(); });
    } else { twRenderStep(); }
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
            <div style="margin-top:15px; padding:10px; background:#fafafa; border:1px solid #eee;"><label>Geri Bildirim Tipi</label><select id="feedback-type" class="swal2-input" style="width:100%; height:40px; margin:0;"><option value="Yok">Yok</option><option value="Sözlü">Sözlü</option><option value="Mail" selected>Mail</option></select></div>
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
