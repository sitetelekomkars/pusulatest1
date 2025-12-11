const BAKIM_MODU = false;
// Apps Script URL'si
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycby3kd04k2u9XdVDD1-vdbQQAsHNW6WLIn8bNYxTlVCL3U1a0WqZo6oPp9zfBWIpwJEinQ/exec";

// --- OYUN DEĞİŞKENLERİ ---
let jokers = { call: 1, half: 1, double: 1 };
let doubleChanceUsed = false;
let firstAnswerIndex = -1;

// --- GLOBAL DEĞİŞKENLER ---
const VALID_CATEGORIES = ['Teknik', 'İkna', 'Kampanya', 'Bilgi'];
let database = [], newsData = [], sportsData = [], salesScripts = [], quizQuestions = [];
let techWizardData = {}; 
let wizardStepsData = {};
let currentUser = "";
let isAdminMode = false;    
let isEditingActive = false;
let sessionTimeout;
let activeCards = [];
let currentCategory = 'all';
let adminUserList = [];
let allEvaluationsData = [];
const MONTH_NAMES = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

// ==========================================================
// --- KALİTE PUANLAMA LOGİĞİ (ORTAK & DÜZELTİLMİŞ) ---
// ==========================================================

// CHAT İÇİN (BUTONLU)
window.setButtonScore = function(index, score, max) {
    const row = document.getElementById(`row-${index}`);
    const badge = document.getElementById(`badge-${index}`);
    const noteInput = document.getElementById(`note-${index}`);
    const buttons = row.querySelectorAll('.eval-button');
    buttons.forEach(b => b.classList.remove('active'));
    const activeBtn = row.querySelector(`.eval-button[data-score="${score}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    badge.innerText = score;
    
    // Not zorunluluğu kaldırıldı, sadece puan kırıldığında göster
    if (score < max) {
        noteInput.style.display = 'block';
        badge.style.background = '#d32f2f'; // Kırmızıya çek
    } else {
        noteInput.style.display = 'none';
        noteInput.value = ''; // Notu temizle
        badge.style.background = '#2e7d32'; // Yeşile çek
    }
    window.recalcTotalScore();
};

// TELESATIŞ İÇİN (SLIDER)
window.updateRowSliderScore = function(index, max) {
    const slider = document.getElementById(`slider-${index}`);
    const badge = document.getElementById(`badge-${index}`);
    const noteInput = document.getElementById(`note-${index}`);
    if(!slider) return;
    const val = parseInt(slider.value);
    badge.innerText = val;
    
    // Not zorunluluğu kaldırıldı, sadece puan kırıldığında göster
    if (val < max) {
        noteInput.style.display = 'block';
        badge.style.background = '#d32f2f';
    } else {
        noteInput.style.display = 'none';
        noteInput.value = '';
        badge.style.background = '#2e7d32';
    }
    window.recalcTotalSliderScore();
};

window.recalcTotalScore = function() {
    let currentTotal = 0;
    const scoreBadges = document.querySelectorAll('.score-badge');
    scoreBadges.forEach(b => { currentTotal += parseInt(b.innerText) || 0; });
    const liveScoreEl = document.getElementById('live-score');
    if(liveScoreEl) liveScoreEl.innerText = currentTotal;
};

window.recalcTotalSliderScore = function() {
    let currentTotal = 0;
    const sliders = document.querySelectorAll('.slider-input');
    sliders.forEach(s => { currentTotal += parseInt(s.value) || 0; });
    const liveScoreEl = document.getElementById('live-score');
    if(liveScoreEl) liveScoreEl.innerText = currentTotal;
};

// --- YARDIMCI FONKSİYONLAR ---
function getToken() { return localStorage.getItem("sSportToken"); }
function getFavs() { return JSON.parse(localStorage.getItem('sSportFavs') || '[]'); }
function toggleFavorite(title) {
    event.stopPropagation();
    let favs = getFavs();
    if (favs.includes(title)) favs = favs.filter(t => t !== title);
    else favs.push(title);
    localStorage.setItem('sSportFavs', JSON.stringify(favs));
    if (currentCategory === 'fav') filterCategory(document.querySelector('.btn-fav'), 'fav');
    else renderCards(activeCards);
}
function isFav(title) { return getFavs().includes(title); }
function formatDateToDDMMYYYY(dateString) {
    if (!dateString) return 'N/A';
    if (dateString.match(/^\d{2}\.\d{2}\.\d{4}/)) return dateString;
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
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
        const parts = dateStr.split(' ')[0].split('.');
        date = new Date(parts[2], parts[1] - 1, parts[0]);
    } else { date = new Date(dateStr); }
    if (isNaN(date.getTime())) return false;
    const diffDays = Math.ceil(Math.abs(new Date() - date) / (1000 * 60 * 60 * 24));
    return diffDays <= 3;
}
function getCategorySelectHtml(currentCategory, id) {
    let options = VALID_CATEGORIES.map(cat => `<option value="${cat}" ${cat === currentCategory ? 'selected' : ''}>${cat}</option>`).join('');
    return `<select id="${id}" class="swal2-input" style="width:100%; margin-top:5px;">${options}</select>`;
}
function escapeForJsString(text) {
    if (!text) return "";
    return text.toString().replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '');
}
function copyScriptContent(encodedText) { copyText(decodeURIComponent(encodedText)); }
function copyText(t) {
    navigator.clipboard.writeText(t.replace(/\\n/g, '\n')).then(() => 
        Swal.fire({icon:'success', title:'Kopyalandı', toast:true, position:'top-end', showConfirmButton:false, timer:1500}) );
}
document.addEventListener('contextmenu', event => event.preventDefault());
document.onkeydown = function(e) { if(e.keyCode == 123) return false; }
document.addEventListener('DOMContentLoaded', () => { checkSession(); });

// --- SESSION & LOGIN & BİLDİRİM KONTROLÜ (YENİ) ---
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
        
        if (!BAKIM_MODU) {
            document.getElementById("main-app").style.display = "block";
            loadContentData();
            loadWizardData();
            loadTechWizardData();
            if (savedRole === 'qusers') { 
                document.getElementById('cardGrid').style.display = 'none';
                document.querySelector('.control-wrapper').style.display = 'none';
                openQualityArea(); 
            }
            checkNewFeedbacks(); // Yeni: Bildirim kontrolü
        }
    }
}
function enterBas(e) { if (e.key === "Enter") girisYap(); }
function girisYap() {
    const uName = document.getElementById("usernameInput").value.trim();
    const uPass = document.getElementById("passInput").value.trim();
    const loadingMsg = document.getElementById("loading-msg");
    const errorMsg = document.getElementById("error-msg");

    if(!uName || !uPass) { errorMsg.style.display = "block"; return; }
    
    loadingMsg.style.display = "block";
    document.querySelector('.login-btn').disabled = true;
    
    fetch(SCRIPT_URL, {
        method: 'POST', 
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "login", username: uName, password: CryptoJS.SHA256(uPass).toString() })
    }).then(r => r.json()).then(data => {
        loadingMsg.style.display = "none";
        document.querySelector('.login-btn').disabled = false;
        if (data.result === "success") {
            currentUser = data.username;
            localStorage.setItem("sSportUser", currentUser);
            localStorage.setItem("sSportToken", data.token);
            localStorage.setItem("sSportRole", data.role);
            
            if (data.forceChange === true) {
                Swal.fire({icon: 'warning', title: 'Güvenlik', text: 'Şifrenizi değiştirin.', allowOutsideClick: false}).then(() => { changePasswordPopup(true); });
            } else {
                document.getElementById("login-screen").style.display = "none";
                document.getElementById("main-app").style.display = "block";
                checkNewFeedbacks(); 
                loadContentData();
                loadWizardData();
                loadTechWizardData();
            }
        } else { errorMsg.innerText = data.message || "Hatalı giriş!"; errorMsg.style.display = "block"; }
    });
}
function checkNewFeedbacks() {
    const agentName = localStorage.getItem("sSportUser");
    if (!agentName || isAdminMode) return; 
    
    fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "checkNotifications", username: agentName })
    })
    .then(r => r.json())
    .then(data => {
        if (data.result === "success" && data.hasFeedback) {
            const lastSeenId = localStorage.getItem('lastSeenFeedbackId');
            
            if (lastSeenId !== String(data.id)) {
                let iconType = 'info';
                let titleColor = '#0e1b42';
                
                if (data.score === 0 || data.score < 70) { iconType = 'warning'; titleColor = '#d32f2f'; }
                else if (data.score >= 100) { iconType = 'success'; titleColor = '#2e7d32'; }
                else if (data.score >= 70 && data.score < 100) { iconType = 'info'; titleColor = '#ed6c02'; }
                
                Swal.fire({
                    title: `<span style="color:${titleColor}">🔔 Yeni Geri Bildirim!</span>`,
                    html: `
                        <div style="text-align:left; font-size:0.95rem; line-height:1.6;">
                            <p><strong>Tarih:</strong> ${data.date}</p>
                            <p><strong>Tür:</strong> ${data.type}</p>
                            <p><strong>Puan:</strong> <span style="font-weight:bold; font-size:1.1rem; color:${titleColor}">${data.score}</span></p>
                            <div style="background:#f8f9fa; padding:15px; border-left:5px solid ${titleColor}; border-radius:4px; margin-top:10px; font-style:italic; color:#555; white-space: pre-wrap;">
                                "${data.feedback}"
                            </div>
                        </div>
                    `,
                    icon: iconType,
                    confirmButtonText: 'Okudum, Anlaşıldı',
                    confirmButtonColor: titleColor,
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    backdrop: `rgba(0,0,123,0.4)`
                }).then((result) => {
                    if (result.isConfirmed) {
                        localStorage.setItem('lastSeenFeedbackId', data.id);
                    }
                });
            }
        }
    });
}
function checkAdmin(role) { 
    const addBtn = document.getElementById('dropdownAddCard');
    const editBtn = document.getElementById('dropdownQuickEdit');
    isAdminMode = (role === "admin");
    const isQualityUser = (role === 'qusers');
    if(isAdminMode) {
        if(addBtn) addBtn.style.display = 'flex';
        if(editBtn) editBtn.style.display = 'flex';
    } else {
        if(addBtn) addBtn.style.display = 'none';
        if(editBtn) editBtn.style.display = 'none';
    }
    if(isQualityUser) {
        document.querySelectorAll('.filter-btn:not(.btn-fav)').forEach(btn => {
            if (btn.innerText.indexOf('Kalite') === -1) {
                btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; btn.style.filter = 'grayscale(100%)';
            }
        });
    }
}
function logout() { 
    currentUser = ""; isAdminMode = false;
    localStorage.clear();
    location.reload();
}
function startSessionTimer() { 
    if (sessionTimeout) clearTimeout(sessionTimeout);
    sessionTimeout = setTimeout(() => { Swal.fire('Oturum Doldu').then(() => logout()); }, 28800000);
}
async function changePasswordPopup(isMandatory = false) { 
    const { value: formValues } = await Swal.fire({
        title: 'Şifre Değiştir',
        html: `<input id="swal-old-pass" type="password" class="swal2-input" placeholder="Eski Şifre"><input id="swal-new-pass" type="password" class="swal2-input" placeholder="Yeni Şifre">`,
        showCancelButton: !isMandatory,
        allowOutsideClick: !isMandatory,
        preConfirm: () => [document.getElementById('swal-old-pass').value, document.getElementById('swal-new-pass').value]
    });
    if (formValues) {
        fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: "changePassword", username: currentUser, oldPass: CryptoJS.SHA256(formValues[0]).toString(), newPass: CryptoJS.SHA256(formValues[1]).toString(), token: getToken() })
        }).then(r=>r.json()).then(d=>{
            if(d.result==="success") Swal.fire('Başarılı','Giriş yapın.','success').then(()=>logout());
            else Swal.fire('Hata', d.message, 'error');
        });
    }
}

// --- DATA FETCHING & CRUD (İÇERİK MODÜLLERİ) ---
function loadContentData() { 
    document.getElementById('loading').style.display = 'block';
    fetch(SCRIPT_URL, { method: 'POST', headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "fetchData" }) }).then(r=>r.json()).then(data => {
        document.getElementById('loading').style.display = 'none';
        if (data.result === "success") {
            const raw = data.data;
            database = raw.filter(i => ['card','bilgi','teknik','kampanya','ikna'].includes(i.Type.toLowerCase())).map(i => ({ title: i.Title, category: i.Category, text: i.Text, script: i.Script, code: i.Code, link: i.Link, date: formatDateToDDMMYYYY(i.Date) }));
            newsData = raw.filter(i => i.Type.toLowerCase() === 'news').map(i => ({ date: formatDateToDDMMYYYY(i.Date), title: i.Title, desc: i.Text, type: i.Category, status: i.Status }));
            sportsData = raw.filter(i => i.Type.toLowerCase() === 'sport').map(i => ({ title: i.Title, icon: i.Icon, desc: i.Text, tip: i.Tip, detail: i.Detail, pronunciation: i.Pronunciation }));
            salesScripts = raw.filter(i => i.Type.toLowerCase() === 'sales').map(i => ({ title: i.Title, text: i.Text }));
            quizQuestions = raw.filter(i => i.Type.toLowerCase() === 'quiz').map(i => ({ q: i.Text, opts: i.QuizOptions ? i.QuizOptions.split(',') : [], a: parseInt(i.QuizAnswer) }));
            activeCards = database;
            renderCards(database);
            startTicker();
        }
    });
}
function loadWizardData() { 
    fetch(SCRIPT_URL, { method: 'POST', headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "getWizardData" }) }).then(r=>r.json()).then(d=>{ if(d.result==="success") wizardStepsData=d.steps; });
}
function loadTechWizardData() { 
    fetch(SCRIPT_URL, { method: 'POST', headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "getTechWizardData" }) }).then(r=>r.json()).then(d=>{ if(d.result==="success") techWizardData=d.steps; });
}
function renderCards(data) { 
    const container = document.getElementById('cardGrid'); container.innerHTML = '';
    if (data.length === 0) { container.innerHTML = '<div style="grid-column:1/-1;text-align:center;">Kayıt yok.</div>'; return; }
    data.forEach((item, index) => {
        const editIcon = (isAdminMode && isEditingActive) ? `<i class="fas fa-pencil-alt edit-icon" onclick="editContent(${index})"></i>` : '';
        const newBadge = isNew(item.date) ? '<span class="new-badge">YENİ</span>' : '';
        const favClass = isFav(item.title) ? 'fas fa-star active' : 'far fa-star';
        let html = `<div class="card ${item.category}">${newBadge}<div class="icon-wrapper">${editIcon}<i class="${favClass} fav-icon" onclick="toggleFavorite('${escapeForJsString(item.title)}')"></i></div><div class="card-header"><h3 class="card-title">${highlightText(item.title)}</h3><span class="badge">${item.category}</span></div><div class="card-content" onclick="showCardDetail('${escapeForJsString(item.title)}', '${escapeForJsString(item.text)}')"><div class="card-text-truncate">${highlightText(item.text)}</div></div><div class="script-box">${highlightText(item.script)}</div><div class="card-actions"><button class="btn btn-copy" onclick="copyText('${escapeForJsString(item.script)}')">Kopyala</button></div></div>`;
        container.innerHTML += html;
    });
}
function highlightText(text) { 
    const term = document.getElementById('searchInput').value.trim();
    if(!term || !text) return text;
    return text.toString().replace(new RegExp(`(${term})`, "gi"), '<span class="highlight">$1</span>');
}
function filterCategory(btn, cat) { 
    currentCategory = cat;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterContent();
}
function filterContent() { 
    const search = document.getElementById('searchInput').value.toLowerCase().trim();
    let filtered = database;
    if (currentCategory === 'fav') filtered = filtered.filter(i => isFav(i.title));
    else if (currentCategory !== 'all') filtered = filtered.filter(i => i.category === currentCategory);
    if (search) filtered = filtered.filter(i => (i.title+i.text+i.script).toLowerCase().includes(search));
    activeCards = filtered;
    renderCards(filtered);
}
function showCardDetail(title, text) { Swal.fire({ title: title, html: `<div style="text-align:left;">${text.replace(/\n/g,'<br>')}</div>`, width: '600px' }); }

function addNewCardPopup() { /* ... implementation ... */ }
function editContent(index) { /* ... implementation ... */ }
function editSport(title) { /* ... implementation ... */ }
function editSales(title) { /* ... implementation ... */ }
function editNews(index) { /* ... implementation ... */ }
function sendUpdate(o, c, v, t='card') { /* ... implementation ... */ }
function startTicker() { /* ... implementation ... */ }
function openNews() { /* ... implementation ... */ }
function openGuide() { /* ... implementation ... */ }
function openSales() { /* ... implementation ... */ }
function openWizard() { /* ... implementation ... */ }
function openTechWizard() { /* ... implementation ... */ }
function openPenaltyGame() { /* ... implementation ... */ }
function toggleEditMode() { /* ... implementation ... */ }
function toggleSales(index) { /* ... implementation ... */ }


// =================================================================
// --- KALİTE HUB (TAM EKRAN & YENİ ÖZELLİKLER) ---
// =================================================================

function populateMonthFilter() {
    const selectEl = document.getElementById('month-select-filter');
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    for (let i = 0; i < 6; i++) {
        let month = (currentMonth - i + 12) % 12;
        let year = currentYear;
        if (currentMonth - i < 0) { year = currentYear - 1; }
        const monthStr = (month + 1).toString().padStart(2, '0');
        const yearStr = year.toString();
        const value = `${monthStr}.${yearStr}`;
        const text = `${MONTH_NAMES[month]} ${yearStr}`;
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        if (i === 0) { option.selected = true; }
        selectEl.appendChild(option);
    }
}
function openQualityArea() {
    document.getElementById('quality-modal').style.display = 'flex';
    document.getElementById('admin-filters').style.display = isAdminMode ? 'flex' : 'none';
    populateMonthFilter();
    
    if (isAdminMode) {
        fetchUserListForAdmin().then(users => {
            const groupSelect = document.getElementById('group-select-admin');
            const agentSelect = document.getElementById('agent-select-admin');
            
            if(groupSelect && agentSelect) {
                const groups = [...new Set(users.map(u => u.group))].sort();
                groupSelect.innerHTML = `<option value="all">Tüm Gruplar</option>` + groups.map(g => `<option value="${g}">${g}</option>`).join('');
                updateAgentListBasedOnGroup();
            }
        });
    } else {
        fetchEvaluationsForAgent(currentUser);
    }
    switchHubTab('dashboard');
}

function switchHubTab(tabId) {
    document.querySelectorAll('.hub-menu-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.hub-tab-content').forEach(t => t.classList.remove('active'));
    
    const btns = document.querySelectorAll('.hub-menu-btn');
    btns.forEach(btn => {
        if(btn.getAttribute('onclick').includes(tabId)) btn.classList.add('active');
    });
    
    document.getElementById(`tab-${tabId}`).classList.add('active');
    
    if(tabId === 'dashboard') fetchEvaluationsForAgent();
    if(tabId === 'education') loadEducationData();
}

function updateAgentListBasedOnGroup() { 
    const groupSelect = document.getElementById('group-select-admin');
    const agentSelect = document.getElementById('agent-select-admin');
    const selectedGroup = groupSelect.value;
    agentSelect.innerHTML = '';
    
    let filteredUsers = adminUserList;
    if (selectedGroup !== 'all') {
        filteredUsers = adminUserList.filter(u => u.group === selectedGroup);
        agentSelect.innerHTML = `<option value="all">-- Tüm ${selectedGroup} --</option>`;
    } else {
        agentSelect.innerHTML = `<option value="all">-- Tüm Temsilciler --</option>`;
    }
    filteredUsers.forEach(u => { agentSelect.innerHTML += `<option value="${u.name}">${u.name}</option>`; });
    fetchEvaluationsForAgent();
}
function hubAgentChanged() { 
    fetchEvaluationsForAgent();
    if(document.getElementById('tab-education').classList.contains('active')) loadEducationData();
}
async function fetchEvaluationsForAgent(forcedName) { 
    const listEl = document.getElementById('evaluations-list');
    const agentSelect = document.getElementById('agent-select-admin');
    const groupSelect = document.getElementById('group-select-admin');
    
    let targetAgent = forcedName || (isAdminMode && agentSelect ? agentSelect.value : currentUser);
    let targetGroup = isAdminMode && groupSelect ? groupSelect.value : 'all';
    const selectedMonth = document.getElementById('month-select-filter').value;

    document.getElementById('quality-loader').style.display = 'block';
    
    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST', headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "fetchEvaluations", targetAgent: targetAgent, targetGroup: targetGroup, username: currentUser, token: getToken() })
        });
        const data = await response.json();
        document.getElementById('quality-loader').style.display = 'none';

        if (data.result === "success") {
            allEvaluationsData = data.evaluations;
            let filteredEvals = allEvaluationsData.filter(e => e.date.substring(3) === selectedMonth);
            
            // Dashboard İstatistikleri
            const totalScore = filteredEvals.reduce((sum, e) => sum + (parseFloat(e.score) || 0), 0);
            const count = filteredEvals.length;
            const avg = count > 0 ? (totalScore / count).toFixed(1) : "-";
            const targetRate = count > 0 ? Math.round((filteredEvals.filter(e => e.score >= 90).length / count) * 100) : "-";
            
            if(document.getElementById('dash-avg-score')) document.getElementById('dash-avg-score').innerText = avg;
            if(document.getElementById('dash-eval-count')) document.getElementById('dash-eval-count').innerText = count;
            if(document.getElementById('dash-target-rate')) document.getElementById('dash-target-rate').innerText = "%" + targetRate;

            // Liste Render (Önceki HTML yapısını korur)
            listEl.innerHTML = '';
            if (filteredEvals.length === 0) listEl.innerHTML = '<p style="text-align:center;color:#999;">Kayıt bulunamadı.</p>';
            
            filteredEvals.reverse().forEach((item, index) => {
                const scoreColor = item.score >= 90 ? '#2e7d32' : (item.score >= 70 ? '#ed6c02' : '#d32f2f');
                const displayCallDate = formatDateToDDMMYYYY(item.callDate);
                const displayLogDate  = formatDateToDDMMYYYY(item.date);
                let typeIcon = item.feedbackType === 'Manuel Log' ? '<i class="fas fa-bolt" title="Hızlı Feedback"></i>' : '<i class="fas fa-phone-alt"></i>';
                let editBtn = isAdminMode ? `<i class="fas fa-pen" style="float:right; cursor:pointer; color:#aaa;" onclick="editEvaluation('${item.callId}')"></i>` : '';
                let agentNameDisplay = (targetAgent === 'all' || targetAgent === targetGroup) ? `<span style="font-size:0.8rem; font-weight:bold; color:#555; background:#eee; padding:2px 6px; border-radius:4px; margin-left:10px;">${item.agent}</span>` : '';
                
                let detailHtml = '';
                try {
                    const detailObj = JSON.parse(item.details);
                    detailHtml = '<table style="width:100%; font-size:0.85rem; border-collapse:collapse; margin-top:10px;">';
                    detailObj.forEach(d_item => {
                        let rowColor = d_item.score < d_item.max ? '#ffebee' : '#f9f9f9';
                        let noteDisplay = d_item.note ? `<br><em style="color: #d32f2f; font-size:0.8rem;">(Not: ${d_item.note})</em>` : '';
                        detailHtml += `<tr style="background:${rowColor}; border-bottom:1px solid #fff;">
                            <td style="padding:8px; border-radius:4px;">${d_item.q}${noteDisplay}</td>
                            <td style="padding:8px; font-weight:bold; text-align:right;">${d_item.score}/${d_item.max}</td>
                        </tr>`;
                    });
                    detailHtml += '</table>';
                } catch (e) { detailHtml = `<p style="white-space:pre-wrap; margin:0; font-size:0.9rem;">${item.details}</p>`; }

                listEl.innerHTML += `
                <div class="evaluation-summary" onclick="toggleEvaluationDetail(${index})" id="eval-summary-${index}" style="position:relative; border:1px solid #eaedf2; border-left:4px solid ${scoreColor}; padding:15px; margin-bottom:10px; border-radius:8px; background:#fff; cursor:pointer; transition:all 0.2s ease;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                ${typeIcon}
                                <span style="font-weight:700; color:#2c3e50; font-size:1.05rem;">${displayCallDate}</span>
                                ${agentNameDisplay}
                            </div>
                            <div style="font-size:0.75rem; color:#94a3b8; margin-left:22px;">
                                <span style="font-weight:500;">Log:</span> ${displayLogDate} 
                                <span style="margin:0 4px; color:#cbd5e0;">|</span> 
                                <span style="font-weight:500;">ID:</span> ${item.callId || '-'}
                            </div>
                        </div>
                        <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end;">
                            <div style="display:flex; align-items:center;">
                                ${editBtn} 
                                <span style="font-weight:800; font-size:1.6rem; color:${scoreColor}; line-height:1;">${item.score}</span>
                            </div>
                            <span style="font-size:0.65rem; color:#a0aec0; letter-spacing:0.5px; font-weight:600;">PUAN</span>
                        </div>
                    </div>
                    <div class="evaluation-details-content" id="eval-details-${index}" style="max-height:0; overflow:hidden;">
                        <hr style="border:none; border-top:1px dashed #eee; margin:12px 0;">
                        ${item.feedbackType !== 'Manuel Log' ? detailHtml : ''}
                        <div style="margin-top:10px; background:#f8f9fa; padding:10px; border-radius:6px; border-left:3px solid #e2e8f0;">
                             <strong style="color:#4a5568; font-size:0.8rem;">Geri Bildirim:</strong>
                             <p style="color:#2d3748; font-size:0.9rem; margin:5px 0 0 0; white-space: pre-wrap;">${item.feedback || 'Geri bildirim girilmedi.'}</p>
                        </div>
                    </div>
                </div>`;
            });
        }
    } catch(err) {
        document.getElementById('quality-loader').style.display = 'none';
        listEl.innerHTML = `<p style="color:red; text-align:center;">Bağlantı hatası.</p>`;
    }
}

function toggleEvaluationDetail(index) {
    const detailEl = document.getElementById(`eval-details-${index}`);
    const isVisible = detailEl.style.maxHeight !== '0px' && detailEl.style.maxHeight !== '';
    if (isVisible) {
        detailEl.style.maxHeight = '0px';
    } else {
        detailEl.style.maxHeight = detailEl.scrollHeight + 100 + 'px';
    }
}
function logEvaluationPopup() { /* ... implementation ... */ }
function saveManualFeedback() { /* ... implementation ... */ }
function loadEducationData() { /* ... implementation ... */ }
function assignEducation() { /* ... implementation ... */ }
function completeEducation(id) { /* ... implementation ... */ }
function fetchUserListForAdmin() { 
    return fetch(SCRIPT_URL, { method: 'POST', headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "getUserList", username: currentUser, token: getToken() }) })
    .then(r=>r.json()).then(d => { adminUserList = d.users || []; return adminUserList; });
}
function fetchCriteria(group) { 
    return fetch(SCRIPT_URL, { method: 'POST', headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "getCriteria", group: group }) })
    .then(r=>r.json()).then(d => d.criteria || []);
}
function exportEvaluations() { /* ... implementation ... */ }
function editEvaluation(callId) { /* ... implementation ... */ }

// --- OYUN & WIZARD FONKSİYONLARI ---
const twState = { currentStep: 'start', history: [] };
function twRenderStep() { /* ... implementation ... */ }
function twChangeStep(n) { twState.history.push(twState.currentStep); twState.currentStep=n; twRenderStep(); }
function twGoBack() { if(twState.history.length>0) { twState.currentStep=twState.history.pop(); twRenderStep(); } }
function twResetWizard() { twState.currentStep='start'; twState.history=[]; twRenderStep(); }

function openWizard() {
    document.getElementById('wizard-modal').style.display='flex';
    if(!wizardStepsData['start']) loadWizardData();
    renderStep('start');
}
function renderStep(k) { /* ... implementation ... */ }
function openPenaltyGame() { /* ... implementation ... */ }
function showLobby() { /* ... implementation ... */ }
function startGameFromLobby() { /* ... implementation ... */ }
function fetchLeaderboard() { /* ... implementation ... */ }
function startPenaltySession() { /* ... implementation ... */ }
function loadPenaltyQuestion() { /* ... implementation ... */ }
function shootBall(i) { /* ... implementation ... */ }
function finishPenaltyGame() { /* ... implementation ... */ }
function resetField() { /* ... implementation ... */ }
