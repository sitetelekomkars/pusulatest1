const BAKIM_MODU = false;
// Apps Script URL'si
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycby3kd04k2u9XdVDD1-vdbQQAsHNW6WLIn8bNYxTlVCL3U1a0WqZo6oPp9zfBWIpwJEinQ/exec";

// ==========================================================
// --- GLOBAL DEĞİŞKENLER ---
// ==========================================================
let jokers = { call: 1, half: 1, double: 1 };
let doubleChanceUsed = false;
let firstAnswerIndex = -1;
const VALID_CATEGORIES = ['Teknik', 'İkna', 'Kampanya', 'Bilgi'];

let database = [], newsData = [], sportsData = [], salesScripts = [], quizQuestions = [];
let techWizardData = {}; 
let currentUser = "";
let isAdminMode = false;    
let isEditingActive = false;
let sessionTimeout;
let activeCards = [];
let currentCategory = 'all';
let adminUserList = [];
let allEvaluationsData = [];
let wizardStepsData = {};

let currentQualityView = 'dashboard';
const MONTH_NAMES = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

// ==========================================================
// --- YARDIMCI FONKSİYONLAR ---
// ==========================================================
function getToken() { return localStorage.getItem("sSportToken"); }
function getFavs() { return JSON.parse(localStorage.getItem('sSportFavs') || '[]'); }

function toggleFavorite(title) {
    event.stopPropagation();
    let favs = getFavs();
    if (favs.includes(title)) {
        favs = favs.filter(t => t !== title);
    } else {
        favs.push(title);
    }
    localStorage.setItem('sSportFavs', JSON.stringify(favs));
    if (currentCategory === 'fav') {
        filterCategory(document.querySelector('.btn-fav'), 'fav');
    } else {
        renderCards(activeCards);
    }
}

function isFav(title) { return getFavs().includes(title); }

function formatDateToDDMMYYYY(dateString) {
    if (!dateString) return 'N/A';
    if (dateString.match(/^\d{2}\.\d{2}\.\d{4}/)) { return dateString; }
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
    return `<select id="${id}" class="swal2-input custom-swal-select">${options}</select>`;
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
    navigator.clipboard.writeText(t.replace(/\\n/g, '\n')).then(() => 
        Swal.fire({icon:'success', title:'Kopyalandı', toast:true, position:'top-end', showConfirmButton:false, timer:1500}) );
}

function highlightText(htmlContent) {
    if (!htmlContent) return "";
    const searchTerm = document.getElementById('searchInput').value.toLocaleLowerCase('tr-TR').trim();
    if (!searchTerm) return htmlContent;
    try {
        const regex = new RegExp(`(${searchTerm})`, "gi");
        return htmlContent.toString().replace(regex, '<span class="highlight">$1</span>');
    } catch(e) {
        return htmlContent;
    }
}

document.addEventListener('contextmenu', event => event.preventDefault());
document.onkeydown = function(e) { if(e.keyCode == 123) return false; }

document.addEventListener('DOMContentLoaded', () => {
    checkSession();
});

// ==========================================================
// --- SESSION & LOGIN ---
// ==========================================================
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
            
            if (savedRole === 'qusers') {
                const grid = document.getElementById('cardGrid');
                if (grid) grid.style.display = 'none';
                const controls = document.querySelector('.control-wrapper');
                if (controls) controls.style.display = 'none';
                const ticker = document.querySelector('.news-ticker-box');
                if (ticker) ticker.style.display = 'none';
                
                openQualityArea();
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
    if(!uName || !uPass) {
        errorMsg.innerText = "Lütfen bilgileri giriniz.";
        errorMsg.style.display = "block";
        return;
    }
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
                    icon: 'warning',
                    title: '    ⚠️     Güvenlik Uyarısı',
                    text: 'İlk girişiniz. Lütfen şifrenizi değiştirin.',
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    confirmButtonText: 'Şifremi Değiştir'
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
                        const grid = document.getElementById('cardGrid');
                        if (grid) grid.style.display = 'none';
                        const controls = document.querySelector('.control-wrapper');
                        if (controls) controls.style.display = 'none';
                        const ticker = document.querySelector('.news-ticker-box');
                        if (ticker) ticker.style.display = 'none';
                        openQualityArea();
                    }
                }
            }
        } else {
            errorMsg.innerText = data.message || "Hatalı giriş!";
            errorMsg.style.display = "block";
        }
    }).catch(error => {
        console.error("Login Error:", error);
        loadingMsg.style.display = "none";
        document.querySelector('.login-btn').disabled = false;
        errorMsg.innerText = "Sunucu hatası! Lütfen sayfayı yenileyin.";
        errorMsg.style.display = "block";
    });
}

function checkAdmin(role) {
    isAdminMode = (role === "admin");
    const addBtn = document.getElementById('dropdownAddCard');
    const editBtn = document.getElementById('dropdownQuickEdit');
    
    if(isAdminMode){
        if(addBtn) addBtn.style.display='flex';
        if(editBtn) {
            editBtn.style.display='flex';
            editBtn.innerHTML='<i class="fas fa-pen" style="color:var(--secondary);"></i> Düzenlemeyi Aç';
            editBtn.classList.remove('active');
        }
    } else {
        if(addBtn) addBtn.style.display='none';
        if(editBtn) editBtn.style.display='none';
    }
}

function logout() {
    currentUser = "";
    isAdminMode = false;
    isEditingActive = false;
    document.body.classList.remove('editing');
    
    localStorage.removeItem("sSportUser");
    localStorage.removeItem("sSportToken");
    localStorage.removeItem("sSportRole");
    
    if (sessionTimeout) clearTimeout(sessionTimeout);
    
    document.getElementById("main-app").style.display = "none";
    document.getElementById("login-screen").style.display = "flex";
    document.getElementById("passInput").value = "";
    document.getElementById("usernameInput").value = "";
    document.getElementById("error-msg").style.display = "none";
}

function startSessionTimer() {
    if (sessionTimeout) clearTimeout(sessionTimeout);
    sessionTimeout = setTimeout(() => {
        Swal.fire({ icon: 'warning', title: 'Oturum Süresi Doldu', text: 'Güvenlik nedeniyle otomatik çıkış yapıldı.', confirmButtonText: 'Tamam' }).then(() => { logout(); });
    },  28800000);
}

function openUserMenu() {
    let options = {
        title: `Merhaba, ${currentUser}`,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '    🔑     Şifre Değiştir',
        denyButtonText: '    🚪     Çıkış Yap',
        cancelButtonText: 'İptal'
    };
    Swal.fire(options).then((result) => {
        if (result.isConfirmed) changePasswordPopup();
        else if (result.isDenied) logout();
    });
}

async function changePasswordPopup(isMandatory = false) {
    const { value: formValues } = await Swal.fire({
        title: isMandatory ? 'Yeni Şifre Belirleyin' : 'Şifre Değiştir',
        html: `${isMandatory ? '<p style="font-size:0.9rem; color:#d32f2f;">İlk giriş şifrenizi değiştirmeden devam edemezsiniz.</p>' : ''}<input id="swal-old-pass" type="password" class="swal2-input" placeholder="Eski Şifre (Mevcut)"><input id="swal-new-pass" type="password" class="swal2-input" placeholder="Yeni Şifre">`,
        focusConfirm: false,
        showCancelButton: !isMandatory,
        allowOutsideClick: !isMandatory,
        allowEscapeKey: !isMandatory,
        confirmButtonText: 'Değiştir',
        cancelButtonText: 'İptal',
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
                action: "changePassword",
                username: currentUser,
                oldPass: CryptoJS.SHA256(formValues[0]).toString(),
                newPass: CryptoJS.SHA256(formValues[1]).toString(),
                token: getToken()
            })
        })
        .then(response => response.json())
        .then(data => {
            if(data.result === "success") {
                Swal.fire('Başarılı!', 'Şifreniz güncellendi. Güvenlik gereği yeniden giriş yapınız.', 'success').then(() => { logout(); });
            } else {
                Swal.fire('Hata', data.message || 'İşlem başarısız.', 'error').then(() => { if(isMandatory) changePasswordPopup(true); });
            }
        }).catch(err => {
            Swal.fire('Hata', 'Sunucu hatası.', 'error');
            if(isMandatory) changePasswordPopup(true);
        });
    } else if (isMandatory) {
        changePasswordPopup(true);
    }
}

// ==========================================================
// --- 3. VERİ ÇEKME (KARTLAR, WIZARD, TECHWIZARD) ---
// ==========================================================
function loadContentData() {
    document.getElementById('loading').style.display = 'block';
    fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "fetchData" })
    })
    .then(response => response.json())
    .then(data => {
        document.getElementById('loading').style.display = 'none';
        if (data.result === "success") {
            const rawData = data.data;
            const fetchedCards = rawData.filter(i => ['card','bilgi','teknik','kampanya','ikna'].includes(i.Type.toLowerCase())).map(i => ({
                title: i.Title,
                category: i.Category,
                text: i.Text,
                script: i.Script,
                code: i.Code,
                link: i.Link,
                date: formatDateToDDMMYYYY(i.Date)
            }));
            const fetchedNews = rawData.filter(i => i.Type.toLowerCase() === 'news').map(i => ({
                date: formatDateToDDMMYYYY(i.Date),
                title: i.Title,
                desc: i.Text,
                type: i.Category,
                status: i.Status
            }));
            const fetchedSports = rawData.filter(i => i.Type.toLowerCase() === 'sport').map(i => ({
                title: i.Title,
                icon: i.Icon,
                desc: i.Text,
                tip: i.Tip,
                detail: i.Detail,
                pronunciation: i.Pronunciation
            }));
            const fetchedSales = rawData.filter(i => i.Type.toLowerCase() === 'sales').map(i => ({
                title: i.Title,
                text: i.Text
            }));
            const fetchedQuiz = rawData.filter(i => i.Type.toLowerCase() === 'quiz').map(i => ({
                q: i.Text,
                opts: i.QuizOptions ? i.QuizOptions.split(',').map(o => o.trim()) : [],
                a: parseInt(i.QuizAnswer)
            }));
            database = fetchedCards;
            newsData = fetchedNews;
            sportsData = fetchedSports;
            salesScripts = fetchedSales;
            quizQuestions = fetchedQuiz;
            if(currentCategory === 'fav') {
                filterCategory(document.querySelector('.btn-fav'), 'fav');
            } else {
                activeCards = database;
                renderCards(database);
            }
            startTicker();
        } else {
            document.getElementById('loading').innerHTML = `Veriler alınamadı: ${data.message || 'Bilinmeyen Hata'}`;
        }
    })
    .catch(error => {
        console.error("Fetch Hatası:", error);
        document.getElementById('loading').innerHTML = 'Bağlantı Hatası! Sunucuya ulaşılamıyor.';
    });
}

function loadWizardData() {
    return new Promise((resolve, reject) => {
        fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "getWizardData" })
        })
        .then(response => response.json())
        .then(data => {
            if (data.result === "success" && data.steps) {
                wizardStepsData = data.steps;
                resolve();
            } else {
                wizardStepsData = {};
                reject(new Error("Wizard verisi yüklenemedi."));
            }
        })
        .catch(error => {
            wizardStepsData = {};
            reject(error);
        });
    });
}

function loadTechWizardData() {
    return new Promise((resolve, reject) => {
        fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "getTechWizardData" })
        })
        .then(response => response.json())
        .then(data => {
            if (data.result === "success" && data.steps) {
                techWizardData = data.steps;
                resolve();
            } else {
                techWizardData = {};
            }
        })
        .catch(error => {
            techWizardData = {};
        });
    });
}

// ==========================================================
// --- 4. RENDER & FİLTRELEME (ANA KARTLAR) ---
// ==========================================================
function renderCards(data) {
    activeCards = data;
    const container = document.getElementById('cardGrid');
    container.innerHTML = '';
    
    if (data.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#777;">Kayıt bulunamadı.</div>';
        return;
    }
    data.forEach((item, index) => {
        const safeTitle = escapeForJsString(item.title);
        const isFavorite = isFav(item.title);
        const favClass = isFavorite ? 'fas fa-star active' : 'far fa-star';
        const newBadge = isNew(item.date) ? '<span class="new-badge">YENİ</span>' : '';
        const editIconHtml = (isAdminMode && isEditingActive) 
            ? `<i class="fas fa-pencil-alt edit-icon" onclick="editContent(${index})" style="display:block;"></i>` 
            : '';
        
        let rawText = item.text || "";
        let formattedText = rawText.replace(/\n/g, '<br>').replace(/\*(.*?)\*/g, '<b>$1</b>');
        
        let html = `<div class="card ${item.category}">${newBadge}
            <div class="icon-wrapper">
                ${editIconHtml}
                <i class="${favClass} fav-icon" onclick="toggleFavorite('${safeTitle}')"></i>
            </div>
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
        container.innerHTML += html;
    });
}

function highlightText(htmlContent) {
    if (!htmlContent) return "";
    const searchTerm = document.getElementById('searchInput').value.toLocaleLowerCase('tr-TR').trim();
    if (!searchTerm) return htmlContent;
    try {
        const regex = new RegExp(`(${searchTerm})`, "gi");
        return htmlContent.toString().replace(regex, '<span class="highlight">$1</span>');
    } catch(e) {
        return htmlContent;
    }
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
    if (currentCategory === 'fav') {
        filtered = filtered.filter(i => isFav(i.title));
    } else if (currentCategory !== 'all') {
        filtered = filtered.filter(i => i.category === currentCategory);
    }
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
        title: title,
        html: `<div style="text-align:left; font-size:1rem; line-height:1.6;">${text.replace(/\\n/g,'<br>')}</div>`,
        showCloseButton: true,
        showConfirmButton: false,
        width: '600px',
        background: '#f8f9fa'
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
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: "updateContent", title: o, column: c, value: v, type: t, originalText: o, username: currentUser, token: getToken() })
    }).then(r => r.json())
    .then(data => {
        if (data.result === "success") {
            Swal.fire({icon: 'success', title: 'Başarılı', timer: 1500, showConfirmButton: false});
            setTimeout(loadContentData, 1600);
        } else {
            Swal.fire('Hata', 'Kaydedilemedi: ' + (data.message || 'Bilinmeyen Hata'), 'error');
        }
    }).catch(err => Swal.fire('Hata', 'Sunucu hatası.', 'error'));
}

// ==========================================================
// --- GÜNCELLENMİŞ EDİT (DÜZENLEME) PENCERESİ ---
// ==========================================================
async function editContent(index) {
    const item = activeCards[index];
    const catSelectHTML = getCategorySelectHtml(item.category, 'swal-cat');
    
    // Görseldeki gibi temiz, alt alta sıralanmış input yapısı
    const htmlContent = `
    <div style="display:flex; flex-direction:column; gap:15px; text-align:left;">
        <input id="swal-title" class="swal2-input custom-swal-input" value="${item.title}" placeholder="Başlık">
        ${catSelectHTML}
        <textarea id="swal-text" class="swal2-textarea custom-swal-textarea" placeholder="İçerik Metni">${(item.text||'').replace(/<br>/g,'\n')}</textarea>
        <textarea id="swal-script" class="swal2-textarea custom-swal-textarea" placeholder="Script Metni">${(item.script||'').replace(/<br>/g,'\n')}</textarea>
        <input id="swal-code" class="swal2-input custom-swal-input" value="${item.code||''}" placeholder="Kod (Opsiyonel)">
        <input id="swal-link" class="swal2-input custom-swal-input" value="${item.link||''}" placeholder="Link (Opsiyonel)">
    </div>
    `;

    const { value: formValues } = await Swal.fire({
        title: 'Düzenle',
        html: htmlContent,
        width: '600px',
        showCancelButton: true,
        confirmButtonText: 'Kaydet',
        cancelButtonText: 'İptal',
        customClass: {
            popup: 'custom-swal-popup'
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

// ==========================================================
// --- GÜNCELLENMİŞ SPOR REHBERİ (GÖRSELDEKİ GİBİ) ---
// ==========================================================
function openGuide() {
    document.getElementById('guide-modal').style.display = 'flex';
    const grid = document.getElementById('guide-grid');
    grid.innerHTML = '';
    
    sportsData.forEach((s, index) => {
        let editBtn = (isAdminMode && isEditingActive) 
            ? `<div class="guide-edit-btn" onclick="event.stopPropagation(); editSport('${escapeForJsString(s.title)}')"><i class="fas fa-pencil-alt"></i></div>` 
            : '';
        
        let pronHtml = s.pronunciation ? `<div class="guide-pronunciation">🗣️ ${s.pronunciation}</div>` : '';
        let tipHtml = s.tip ? `<div class="guide-tip-box"><i class="fas fa-lightbulb"></i> ${s.tip}</div>` : '';
        
        // Görseldeki kart yapısına birebir uygun HTML
        grid.innerHTML += `
        <div class="guide-card-new" onclick="showSportDetail(${index})">
            ${editBtn}
            <div class="guide-icon-area">
                <i class="fas ${s.icon} guide-icon-large"></i>
            </div>
            <div class="guide-content-area">
                <div class="guide-card-title">${s.title}</div>
                ${pronHtml}
                <div class="guide-card-desc">${s.desc || ''}</div>
                ${tipHtml}
            </div>
            <div class="guide-footer">(Detay için tıkla)</div>
        </div>`;
    });
}

function showSportDetail(x) { 
    const s=sportsData[x]; 
    const detailText = s.detail ? s.detail.replace(/\n/g,'<br>') : "Detay bilgisi yok.";
    const pronDetail = s.pronunciation ? `<div style="color:#e65100; font-weight:bold; margin-bottom:15px; font-style:italic;">🗣️ Okunuşu: ${s.pronunciation}</div>` : '';
    
    Swal.fire({ 
        title: `<i class="fas ${s.icon}" style="color:#0e1b42;"></i> ${s.title}`,
        html: `${pronDetail}<div style="text-align:left; font-size:1rem; line-height:1.6;">${detailText}</div>`, 
        width:'600px',
        background: '#f8f9fa' 
    }); 
}

// ==========================================================
// --- 5. YENİ KALİTE MODÜLÜ (DASHBOARD, EVAL, FEEDBACK, EĞİTİM) ---
// ==========================================================

// --- NAVİGASYON ---
function switchQualityTab(viewName) {
    currentQualityView = viewName;
    
    // Sidebar active sınıfı güncelle
    document.querySelectorAll('.q-menu li').forEach(li => li.classList.remove('active'));
    document.getElementById(`tab-${viewName}`).classList.add('active');

    // View görünürlüğü güncelle
    document.querySelectorAll('.q-view').forEach(view => view.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');

    // Başlığı güncelle
    const titles = {
        'dashboard': 'Özet (Dashboard)',
        'evaluations': 'Çağrı Değerlendirme Geçmişi',
        'feedback': 'Geri Bildirimlerim',
        'training': 'Eğitim Atamaları'
    };
    document.getElementById('page-title').innerText = titles[viewName];

    // Verileri Yükle
    refreshQualityData();
}

// --- VERİ YENİLEME (TEK MERKEZ) ---
function refreshQualityData() {
    // Admin kontrollerini göster/gizle
    const adminDisplay = isAdminMode ? 'flex' : 'none';
    const adminBlock = isAdminMode ? 'block' : 'none';
    
    document.getElementById('admin-filters').style.display = adminDisplay;
    document.getElementById('eval-admin-actions').style.display = adminBlock;
    document.getElementById('fb-admin-actions').style.display = adminBlock;
    document.getElementById('train-admin-actions').style.display = adminBlock;

    const targetAgent = isAdminMode ? document.getElementById('agent-select-admin').value : currentUser;
    
    // Dashboard ve Evaluasyonlar
    if (currentQualityView === 'dashboard' || currentQualityView === 'evaluations') {
        fetchEvaluationsForAgent(targetAgent); 
    }
    
    // Feedback Sekmesi
    if (currentQualityView === 'feedback') {
        loadCombinedFeedbacks(targetAgent);
    }

    // Eğitim Sekmesi
    if (currentQualityView === 'training') {
        loadTrainings(targetAgent);
    }
}

function openQualityArea() {
    document.getElementById('quality-modal').style.display = 'flex';
    populateMonthFilter();
    
    // Admin listesi yüklenmesi
    if (isAdminMode) {
        fetchUserListForAdmin().then(users => {
            const groupSelect = document.getElementById('group-select-admin');
            const agentSelect = document.getElementById('agent-select-admin');
            
            if(groupSelect && agentSelect) {
                const groups = [...new Set(users.map(u => u.group))].sort();
                groupSelect.innerHTML = `<option value="all">Tüm Gruplar</option>` + 
                    groups.map(g => `<option value="${g}">${g}</option>`).join('');
                
                updateAgentListBasedOnGroup();
            }
        });
    }
    
    // Varsayılan Tabı Aç
    switchQualityTab('dashboard');
}

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

function updateAgentListBasedOnGroup() {
    const groupSelect = document.getElementById('group-select-admin');
    const agentSelect = document.getElementById('agent-select-admin');
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
    
    filteredUsers.forEach(u => {
        agentSelect.innerHTML += `<option value="${u.name}">${u.name}</option>`;
    });
    
    refreshQualityData(); 
}

// --- EVALUATIONS VE DASHBOARD STATS ---
async function fetchEvaluationsForAgent(forcedName) {
    const listEl = document.getElementById('evaluations-list');
    const dashAvg = document.getElementById('dash-avg-score');
    const dashCount = document.getElementById('dash-eval-count');
    const dashTarget = document.getElementById('dash-target-rate');
    
    listEl.innerHTML = '<div style="text-align:center; padding:20px;">Yükleniyor...</div>';
    
    // Admin Seçimleri
    const groupSelect = document.getElementById('group-select-admin');
    const agentSelect = document.getElementById('agent-select-admin');
    
    let targetAgent = forcedName || currentUser;
    let targetGroup = 'all';
    
    if (isAdminMode) {
        targetAgent = forcedName || (agentSelect ? agentSelect.value : currentUser);
        targetGroup = groupSelect ? groupSelect.value : 'all';
        
        if(targetAgent === 'all' && targetGroup === 'all') {
            listEl.innerHTML = '<div style="padding:20px; text-align:center; color:#1976d2;"><i class="fas fa-users fa-2x"></i><br><br><b>Tüm Şirket Verisi</b><br>Detaylı analiz için yukarıdaki "Rapor" butonunu kullanın.</div>';
            if(dashAvg) dashAvg.innerText = "-";
            if(dashCount) dashCount.innerText = "-";
            if(dashTarget) dashTarget.innerText = "-%";
            return;
        }
    }
    
    const selectedMonth = document.getElementById('month-select-filter').value;
    
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
            allEvaluationsData = data.evaluations;
            let filteredEvals = allEvaluationsData.filter(evalItem => {
                const evalDate = evalItem.date.substring(3);
                return evalDate === selectedMonth;
            });
            const monthlyTotal = filteredEvals.reduce((sum, evalItem) => sum + (parseFloat(evalItem.score) || 0), 0);
            const monthlyCount = filteredEvals.length;
            const monthlyAvg = monthlyCount > 0 ? (monthlyTotal / monthlyCount) : 0;
            const targetScore = 90;
            const targetHitCount = filteredEvals.filter(e => (parseFloat(e.score) || 0) >= targetScore).length;
            const targetRate = monthlyCount > 0 ? Math.round((targetHitCount / monthlyCount) * 100) : 0;
            
            if(dashAvg) dashAvg.innerText = monthlyAvg % 1 === 0 ? monthlyAvg : monthlyAvg.toFixed(1);
            if(dashCount) dashCount.innerText = monthlyCount;
            if(dashTarget) dashTarget.innerText = `%${targetRate}`;
            
            if (filteredEvals.length === 0) {
                listEl.innerHTML = `<p style="text-align:center; color:#666; margin-top:20px;">Bu dönem için kayıt yok.</p>`;
                return;
            }
            
            let html = '';
            filteredEvals.reverse().forEach((evalItem, index) => {
                const scoreColor = evalItem.score >= 90 ? '#2e7d32' : (evalItem.score >= 70 ? '#ed6c02' : '#d32f2f');
                const displayCallDate = formatDateToDDMMYYYY(evalItem.callDate);
                const displayLogDate  = formatDateToDDMMYYYY(evalItem.date);
                
                let detailHtml = '';
                try {
                    const detailObj = JSON.parse(evalItem.details);
                    detailHtml = '<table style="width:100%; font-size:0.85rem; border-collapse:collapse; margin-top:10px;">';
                    detailObj.forEach(item => {
                        let rowColor = item.score < item.max ? '#ffebee' : '#f9f9f9';
                        let noteDisplay = item.note ? `<br><em style="color: #d32f2f; font-size:0.8rem;">(Not: ${item.note})</em>` : '';
                        detailHtml += `<tr style="background:${rowColor}; border-bottom:1px solid #fff;">
                            <td style="padding:8px; border-radius:4px;">${item.q}${noteDisplay}</td>
                            <td style="padding:8px; font-weight:bold; text-align:right;">${item.score}/${item.max}</td>
                        </tr>`;
                    });
                    detailHtml += '</table>';
                } catch (e) { detailHtml = `<p style="white-space:pre-wrap; margin:0; font-size:0.9rem;">${evalItem.details}</p>`; }
                
                let editBtn = isAdminMode ? `<i class="fas fa-pen" style="font-size:1rem; color:#fabb00; cursor:pointer; margin-right:5px; padding:5px;" onclick="event.stopPropagation(); editEvaluation('${evalItem.callId}')" title="Kaydı Düzenle"></i>` : '';
                let agentNameDisplay = (targetAgent === 'all' || targetAgent === targetGroup) ? `<span style="font-size:0.8rem; font-weight:bold; color:#555; background:#eee; padding:2px 6px; border-radius:4px; margin-left:10px;">${evalItem.agent}</span>` : '';
                
                html += `<div class="evaluation-summary" id="eval-summary-${index}" style="position:relative; border:1px solid #eaedf2; border-left:4px solid ${scoreColor}; padding:15px; margin-bottom:10px; border-radius:8px; background:#fff; cursor:pointer; transition:all 0.2s ease;" onclick="toggleEvaluationDetail(${index})">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <i class="fas fa-phone-alt" style="color:#b0b8c1; font-size:0.9rem;"></i>
                                <span style="font-weight:700; color:#2c3e50; font-size:1.05rem;">${displayCallDate}</span>
                                ${agentNameDisplay}
                            </div>
                            <div style="font-size:0.75rem; color:#94a3b8; margin-left:22px;">
                                <span style="font-weight:500;">Log:</span> ${displayLogDate} 
                                <span style="margin:0 4px; color:#cbd5e0;">|</span> 
                                <span style="font-weight:500;">ID:</span> ${evalItem.callId || '-'}
                            </div>
                        </div>
                        <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end;">
                            <div style="display:flex; align-items:center;">
                                ${editBtn} 
                                <span style="font-weight:800; font-size:1.6rem; color:${scoreColor}; line-height:1;">${evalItem.score}</span>
                            </div>
                            <span style="font-size:0.65rem; color:#a0aec0; letter-spacing:0.5px; font-weight:600;">PUAN</span>
                        </div>
                    </div>
                    <div class="evaluation-details-content" id="eval-details-${index}">
                        <hr style="border:none; border-top:1px dashed #eee; margin:12px 0;">
                        ${detailHtml}
                        <div style="margin-top:10px; background:#f8f9fa; padding:10px; border-radius:6px; border-left:3px solid #e2e8f0;">
                             <strong style="color:#4a5568; font-size:0.8rem;">Geri Bildirim:</strong>
                             <p style="color:#2d3748; font-size:0.9rem; margin:5px 0 0 0;">${evalItem.feedback || 'Geri bildirim girilmedi.'}</p>
                        </div>
                    </div>
                </div>`;
            });
            listEl.innerHTML = html;
        } else {
            listEl.innerHTML = `<p style="color:red; text-align:center;">Veri çekme hatası: ${data.message || 'Bilinmeyen Hata'}</p>`;
        }
    } catch(err) {
        listEl.innerHTML = `<p style="color:red; text-align:center;">Bağlantı hatası.</p>`;
    }
}

function toggleEvaluationDetail(index) {
    const detailEl = document.getElementById(`eval-details-${index}`);
    const isVisible = detailEl.style.maxHeight !== '0px' && detailEl.style.maxHeight !== '';
    if (isVisible) {
        detailEl.style.maxHeight = '0px';
        detailEl.style.marginTop = '0';
    } else {
        detailEl.style.maxHeight = detailEl.scrollHeight + 100 + 'px';
        detailEl.style.marginTop = '10px';
    }
}

// --- FEEDBACK YÖNETİMİ ---
async function loadCombinedFeedbacks(agentName) {
    const listEl = document.getElementById('feedback-list');
    listEl.innerHTML = '<div style="text-align:center; padding:20px;">Yükleniyor...</div>';

    try {
        // Manuel Feedbackleri Çek
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: "getGeneralFeedbacks", username: currentUser, token: getToken() })
        });
        const data = await response.json();
        const manualFeedbacks = data.feedbacks || [];

        // Çağrı Feedbacklerini allEvaluationsData'dan süz
        const callFeedbacks = allEvaluationsData
            .filter(e => e.agent === agentName && e.feedback && e.feedback.length > 2)
            .map(e => ({
                date: e.date || formatDateToDDMMYYYY(e.callDate), 
                type: 'Çağrı Değ.',
                topic: `Call ID: ${e.callId} - Skor: ${e.score}`,
                message: e.feedback,
                source: 'call'
            }));
        
        let combined = [...manualFeedbacks.filter(f => f.agent === agentName), ...callFeedbacks];
        combined.reverse(); 

        if (combined.length === 0) {
            listEl.innerHTML = '<p style="text-align:center; color:#999; margin-top:20px;">Henüz geri bildirim yok.</p>';
            return;
        }

        let html = '';
        combined.forEach(fb => {
            const borderClass = fb.source === 'call' ? 'fb-source-call' : 'fb-source-manual';
            const icon = fb.source === 'call' ? '<i class="fas fa-headset"></i>' : '<i class="fas fa-comment-alt"></i>';
            html += `
            <div class="feedback-card ${borderClass}">
                <div class="fb-header">
                    <span>${icon} ${fb.date}</span>
                    <span style="font-weight:bold;">${fb.topic}</span>
                </div>
                <div class="fb-content">${fb.message}</div>
                <div class="fb-badge">${fb.type}</div>
            </div>`;
        });
        listEl.innerHTML = html;

    } catch (e) {
        console.error(e);
        listEl.innerHTML = 'Veri hatası.';
    }
}

async function openManualFeedbackPopup() {
    const agent = document.getElementById('agent-select-admin').value;
    const { value: formValues } = await Swal.fire({
        title: 'Hızlı Feedback Ekle',
        html: `
            <label>Konu</label><input id="fb-topic" class="swal2-input" placeholder="Örn: Müşteri Memnuniyeti">
            <label>Tip</label>
            <select id="fb-type" class="swal2-input">
                <option value="Pozitif">Pozitif</option>
                <option value="Gelişim">Gelişim</option>
                <option value="Uyarı">Uyarı</option>
            </select>
            <label>Mesaj</label><textarea id="fb-msg" class="swal2-textarea" placeholder="Mesajınız..."></textarea>
        `,
        focusConfirm: false,
        showCancelButton: true,
        preConfirm: () => {
            return {
                topic: document.getElementById('fb-topic').value,
                fbType: document.getElementById('fb-type').value,
                message: document.getElementById('fb-msg').value,
                targetAgent: agent
            }
        }
    });

    if (formValues) {
        fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: "logGeneralFeedback", username: currentUser, token: getToken(), ...formValues })
        }).then(r => r.json()).then(d => {
            Swal.fire('Başarılı', 'Feedback eklendi', 'success');
            loadCombinedFeedbacks(agent);
        });
    }
}

// --- EĞİTİM YÖNETİMİ ---
async function loadTrainings(agentName) {
    const listEl = document.getElementById('training-list');
    listEl.innerHTML = 'Yükleniyor...';
    
    fetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: "getTrainings", username: currentUser, token: getToken() })
    }).then(r => r.json()).then(data => {
        const trainings = data.trainings.filter(t => t.agent === agentName);
        if (trainings.length === 0) {
            listEl.innerHTML = '<p style="text-align:center; color:#999; margin-top:20px;">Atanmış eğitim bulunmuyor.</p>';
            return;
        }
        let html = '';
        trainings.forEach(t => {
            html += `
            <div class="training-item">
                <div>
                    <div style="font-weight:bold; color:#333;">${t.title}</div>
                    <div style="font-size:0.8rem; color:#888;">${t.date}</div>
                </div>
                <div>
                    <a href="${t.link}" target="_blank" class="training-link">Eğitime Git <i class="fas fa-external-link-alt"></i></a>
                    <span class="badge" style="background:#e3f2fd; color:#0277bd; margin-left:10px;">${t.status}</span>
                </div>
            </div>`;
        });
        listEl.innerHTML = html;
    });
}

async function openAssignTrainingPopup() {
    const agent = document.getElementById('agent-select-admin').value;
    const { value: formValues } = await Swal.fire({
        title: 'Eğitim Ata',
        text: `${agent} kişisine eğitim atanacak.`,
        html: `
            <input id="tr-title" class="swal2-input" placeholder="Eğitim Başlığı">
            <input id="tr-link" class="swal2-input" placeholder="Eğitim Linki / URL">
        `,
        showCancelButton: true,
        confirmButtonText: 'Ata',
        preConfirm: () => {
             return {
                title: document.getElementById('tr-title').value,
                link: document.getElementById('tr-link').value,
                targetAgent: agent
            }
        }
    });

    if (formValues) {
        fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: "assignTraining", username: currentUser, token: getToken(), ...formValues })
        }).then(r => r.json()).then(d => {
            Swal.fire('Başarılı', 'Eğitim atandı.', 'success');
            loadTrainings(agent);
        });
    }
}

// --- LOGGING & EDITING EVALS (Mevcut Fonksiyonlar) ---
function fetchUserListForAdmin() {
    return new Promise((resolve) => {
        fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "getUserList", username: currentUser, token: getToken() })
        })
        .then(response => response.json())
        .then(data => {
            if (data.result === "success") {
                const filteredUsers = data.users.filter(u => u.group !== 'Yönetim');
                adminUserList = filteredUsers;
                resolve(filteredUsers); 
            } else
                resolve([]);
        }).catch(err => resolve([]));
    });
}

function fetchCriteria(groupName) {
    return new Promise((resolve) => {
        fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "getCriteria", group: groupName, username: currentUser, token: getToken() })
        })
        .then(response => response.json())
        .then(data => {
            if (data.result === "success")
                resolve(data.criteria || []);
            else
                resolve([]);
        }).catch(err => {
            console.error(err);
            resolve([]);
        });
    });
}

async function exportEvaluations() {
    if (!isAdminMode) {
        Swal.fire('Hata', 'Bu işlem için yönetici yetkisi gereklidir.', 'error');
        return;
    }
    const agentSelect = document.getElementById('agent-select-admin');
    const groupSelect = document.getElementById('group-select-admin');
    
    const targetAgent = agentSelect ? agentSelect.value : 'all';
    const targetGroup = groupSelect ? groupSelect.value : 'all';
    const agentName = targetAgent === 'all' ? (targetGroup === 'all' ? 'Tüm Şirket' : targetGroup + ' Ekibi') : targetAgent;
    
    const { isConfirmed } = await Swal.fire({
        icon: 'question',
        title: 'Raporu Onayla',
        html: `<strong>${agentName}</strong> için tüm değerlendirme kayıtları (kırılım detayları dahil) CSV formatında indirilecektir. Onaylıyor musunuz?`,
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-download"></i> İndir',
        cancelButtonText: 'İptal'
    });
    if (!isConfirmed) return;
    
    Swal.fire({ title: 'Kırılım Raporu Hazırlanıyor...', didOpen: () => Swal.showLoading() });
    
    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
                action: "exportEvaluations",
                targetAgent: targetAgent,
                targetGroup: targetGroup,
                username: currentUser,
                token: getToken()
            })
        });
        
        const data = await response.json();
        if (data.result === "success" && data.csvData) {
            const blob = new Blob(["\ufeff" + data.csvData], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            if (link.download !== undefined) {
                const url = URL.createObjectURL(blob);
                link.setAttribute("href", url);
                link.setAttribute("download", data.fileName);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                Swal.fire('Başarılı', `Rapor <strong>${data.fileName}</strong> adıyla indirildi.`, 'success');
            } else {
                Swal.fire('Hata', 'Tarayıcınız otomatik indirmeyi desteklemiyor.', 'error');
            }
        } else {
            Swal.fire('Hata', data.message || 'Rapor verisi alınamadı.', 'error');
        }
    } catch (err) {
        Swal.fire('Hata', 'Sunucuya bağlanılamadı.', 'error');
    }
}

// --- PUANLAMA MANTIĞI (Slider & Buttons) ---
window.setButtonScore = function(index, score, max) {
    const row = document.getElementById(`row-${index}`);
    const badge = document.getElementById(`badge-${index}`);
    const noteInput = document.getElementById(`note-${index}`);
    const buttons = row.querySelectorAll('.eval-button');
    buttons.forEach(b => b.classList.remove('active'));
    const activeBtn = row.querySelector(`.eval-button[data-score="${score}"]`);
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

async function logEvaluationPopup() {
    const agentSelect = document.getElementById('agent-select-admin');
    const agentName = agentSelect ? agentSelect.value : "";
    
    if (!agentName || agentName === 'all') {
        Swal.fire('Uyarı', 'Lütfen işlem yapmak için listeden bir personel seçiniz.', 'warning');
        return;
    }
    
    let agentGroup = 'Genel';
    const foundUser = adminUserList.find(u => u.name.toLowerCase() === agentName.toLowerCase());
    if (foundUser && foundUser.group) { agentGroup = foundUser.group; }
    
    const isChat = agentGroup.indexOf('Chat') > -1;
    const isTelesatis = agentGroup.indexOf('Telesatış') > -1;
    if (isChat) agentGroup = 'Chat';
    
    Swal.fire({ title: 'Değerlendirme Formu Hazırlanıyor...', didOpen: () => Swal.showLoading() });
    
    let criteriaList = [];
    if(agentGroup && agentGroup !== 'Genel') { 
        criteriaList = await fetchCriteria(agentGroup);
    } 
    Swal.close();
    
    const todayISO = new Date().toISOString().substring(0, 10);
    const isCriteriaBased = criteriaList.length > 0;
    
    let criteriaFieldsHtml = '';
    let manualScoreHtml = '';
    
    if (isCriteriaBased) {
        criteriaFieldsHtml += `<div class="criteria-container">`;
        criteriaList.forEach((c, i) => {
            let pts = parseInt(c.points) || 0;
            if (pts === 0) return;
            if (isChat) {
                let mPts = parseInt(c.mediumScore) || 0;
                let bPts = parseInt(c.badScore) || 0;
                criteriaFieldsHtml += `
                    <div class="criteria-row" id="row-${i}" data-max-score="${pts}">
                        <div class="criteria-header"><span>${i+1}. ${c.text}</span><span style="font-size:0.8rem; color:#999;">Max: ${pts}</span></div>
                        <div class="criteria-controls">
                            <div class="eval-button-group">
                                <button class="eval-button eval-good active" data-score="${pts}" onclick="setButtonScore(${i}, ${pts}, ${pts})">İyi (${pts})</button>
                                ${mPts > 0 ? `<button class="eval-button eval-medium" data-score="${mPts}" onclick="setButtonScore(${i}, ${mPts}, ${pts})">Orta (${mPts})</button>` : ''}
                                ${bPts > 0 ? `<button class="eval-button eval-bad" data-score="${bPts}" onclick="setButtonScore(${i}, ${bPts}, ${pts})">Kötü (${bPts})</button>` : ''}
                            </div>
                            <span class="score-badge" id="badge-${i}" style="margin-top: 8px; display:block; background:#2e7d32;">${pts}</span>
                        </div>
                        <input type="text" id="note-${i}" class="note-input" placeholder="Not..." style="display:none;">
                    </div>`;
            } else if (isTelesatis) {
                 criteriaFieldsHtml += `
                    <div class="criteria-row" id="row-${i}" data-max-score="${pts}">
                        <div class="criteria-header"><span>${i+1}. ${c.text}</span><span style="font-size:0.8rem; color:#999;">Max: ${pts}</span></div>
                        <div class="criteria-controls" style="display: flex; align-items: center; gap: 15px; background: #f9f9f9; padding: 8px; border-radius: 6px;">
                            <input type="range" class="custom-range slider-input" id="slider-${i}" min="0" max="${pts}" value="${pts}" data-index="${i}" oninput="updateRowSliderScore(${i}, ${pts})" style="flex-grow: 1;">
                            <span class="score-badge" id="badge-${i}" style="background:#2e7d32;">${pts}</span>
                        </div>
                        <input type="text" id="note-${i}" class="note-input" placeholder="Not..." style="display:none;">
                    </div>`;
            }
        });
        criteriaFieldsHtml += `</div>`;
    } else {
        manualScoreHtml = `
            <div style="padding:15px; border:1px dashed #ccc; background:#fff; border-radius:8px; text-align:center; margin-bottom:15px;">
                <p style="color:#e65100;">(Bu grup için otomatik kriter bulunamadı)</p>
                <label style="font-weight:bold;">Manuel Puan</label><br>
                <input id="eval-manual-score" type="number" class="swal2-input" value="100" min="0" max="100" style="width:100px; text-align:center; font-size:1.5rem; font-weight:bold;">
            </div>
            <textarea id="eval-details" class="swal2-textarea" placeholder="Değerlendirme detayları..." style="margin-bottom:15px;"></textarea>
        `;
    }
    
    const contentHtml = `
        <div class="eval-modal-wrapper">
            <div class="score-dashboard">
                <div>
                    <div style="font-size:0.9rem; opacity:0.8;">Değerlendirilen</div>
                    <div style="font-size:1.2rem; font-weight:bold; color:#fabb00;">${agentName}</div>
                    <div style="font-size:0.8rem; opacity:0.7;">${agentGroup}</div>
                </div>
                <div class="score-circle-outer" id="score-ring">
                    <div class="score-circle-inner" id="live-score">${isCriteriaBased ? '100' : '100'}</div>
                </div>
            </div>
            <div class="eval-header-card">
                <div><label style="font-size:0.8rem;">Call ID</label><input id="eval-callid" class="swal2-input" style="height:35px; width:100%;"></div>
                <div><label style="font-size:0.8rem;">Tarih</label><input type="date" id="eval-calldate" class="swal2-input" style="height:35px; width:100%;" value="${todayISO}"></div>
            </div>
            ${manualScoreHtml} ${criteriaFieldsHtml}
            <div style="margin-top:15px;">
                <select id="feedback-type" class="swal2-input" style="width:100%; height:40px;">
                    <option value="Yok">Geri Bildirim Yok</option>
                    <option value="Sözlü">Sözlü (Verbal)</option>
                    <option value="Mail">Mail (E-posta)</option>
                </select>
                <textarea id="eval-feedback" class="swal2-textarea" style="margin-top:5px; height:80px;" placeholder="Genel Geri Bildirim..."></textarea>
            </div>
        </div>`;
    
    const { value: formValues } = await Swal.fire({
        title: '', html: contentHtml, width: '600px', padding: '0 0 20px 0', showCancelButton: true, confirmButtonText: '💾 Kaydet',
        didOpen: () => { if (isTelesatis) window.recalcTotalSliderScore(); else if (isChat) window.recalcTotalScore(); },
        preConfirm: () => {
            const callId = document.getElementById('eval-callid').value;
            const callDateRaw = document.getElementById('eval-calldate').value;
            const feedback = document.getElementById('eval-feedback').value;
            const feedbackType = document.getElementById('feedback-type').value; 
            if (!callId || !callDateRaw ) { Swal.showValidationMessage('Eksik bilgi.'); return false; }
            const dateParts = callDateRaw.split('-');
            const formattedCallDate = `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`;
            
            if (isCriteriaBased) {
                let total = 0, detailsArr = [];
                for (let i = 0; i < criteriaList.length; i++) {
                    const c = criteriaList[i];
                    if (parseInt(c.points) === 0) continue; 
                    let val, note;
                    if (isChat) {
                        val = parseInt(document.getElementById(`badge-${i}`).innerText) || 0;
                        note = document.getElementById(`note-${i}`).value;
                    } else if (isTelesatis) {
                        val = parseInt(document.getElementById(`slider-${i}`).value) || 0;
                        note = document.getElementById(`note-${i}`).value;
                    }
                    total += val;
                    detailsArr.push({ q: c.text, max: parseInt(c.points), score: val, note: note });
                }
                return { agentName, agentGroup, callId, callDate: formattedCallDate, score: total, details: JSON.stringify(detailsArr), feedback, feedbackType }; 
            } else {
                const score = document.getElementById('eval-manual-score').value;
                const details = document.getElementById('eval-details').value;
                return { agentName, agentGroup, callId, callDate: formattedCallDate, score: parseInt(score), details, feedback, feedbackType }; 
            }
        }
    });
    if (formValues) {
        Swal.fire({ title: 'Kaydediliyor...', didOpen: () => { Swal.showLoading() } });
        fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: "logEvaluation", username: currentUser, token: getToken(), ...formValues })
        }).then(r => r.json()).then(d => {
            if (d.result === "success") {
                Swal.fire({ icon: 'success', title: 'Kaydedildi', timer: 1500, showConfirmButton: false });
                fetchEvaluationsForAgent(formValues.agentName);
            } else Swal.fire('Hata', d.message, 'error');
        });
    }
}

async function editEvaluation(targetCallId) {
    const evalData = allEvaluationsData.find(item => String(item.callId).trim() === String(targetCallId).trim());
    if (!evalData) return Swal.fire('Hata', 'Kayıt bulunamadı.', 'error');
    
    const agentName = evalData.agent || evalData.agentName;
    const agentGroupRaw = evalData.group || 'Genel';
    const isChat = agentGroupRaw.indexOf('Chat') > -1;
    const isTelesatis = agentGroupRaw.indexOf('Telesatış') > -1;
    const agentGroup = isChat ? 'Chat' : (isTelesatis ? 'Telesatış' : 'Genel');
    
    Swal.fire({ title: 'Veriler Yükleniyor...', didOpen: () => Swal.showLoading() });
    let criteriaList = [];
    if(agentGroup && agentGroup !== 'Genel') criteriaList = await fetchCriteria(agentGroup);
    Swal.close();
    
    const isCriteriaBased = criteriaList.length > 0;
    let oldDetails = [];
    try { oldDetails = JSON.parse(evalData.details || "[]"); } catch(e) { oldDetails = []; }
    
    let contentHtml = `
    <div class="eval-modal-wrapper" style="border-top: 5px solid #1976d2;">
    <div class="score-dashboard">
    <div><div style="font-size:0.9rem; opacity:0.8;">DÜZENLENEN</div><div style="font-size:1.2rem; font-weight:bold; color:#1976d2;">${agentName}</div></div>
    <div class="score-circle-outer" id="score-ring"><div class="score-circle-inner" id="live-score">${evalData.score}</div></div>
    </div>
    <div class="eval-header-card">
    <div><label style="font-size:0.8rem;">Call ID</label><input id="eval-callid" class="swal2-input" style="height:35px; background:#eee;" value="${evalData.callId}" readonly></div>
    </div>`;
    
    if (isCriteriaBased) {
        contentHtml += `<div class="criteria-container">`;
        criteriaList.forEach((c, i) => {
            let pts = parseInt(c.points) || 0, mPts = parseInt(c.mediumScore) || 0, bPts = parseInt(c.badScore) || 0;
            if (pts === 0) return;
            let oldItem = oldDetails.find(d => d.q === c.text) || oldDetails[i] || { score: pts, note: '' };
            let currentVal = parseInt(oldItem.score), currentNote = oldItem.note || '';
            
            if (isChat) {
                let gA = currentVal === pts ? 'active' : '', mA = currentVal === mPts && mPts!==0 ? 'active' : '', bA = currentVal === bPts && bPts!==0 ? 'active' : '';
                contentHtml += `
                <div class="criteria-row" id="row-${i}" data-max-score="${pts}">
                    <div class="criteria-header"><span>${i+1}. ${c.text}</span></div>
                    <div class="criteria-controls"><div class="eval-button-group">
                        <button class="eval-button eval-good ${gA}" data-score="${pts}" onclick="setButtonScore(${i}, ${pts}, ${pts})">İyi (${pts})</button>
                        ${mPts > 0 ? `<button class="eval-button eval-medium ${mA}" data-score="${mPts}" onclick="setButtonScore(${i}, ${mPts}, ${pts})">Orta (${mPts})</button>` : ''}
                        ${bPts > 0 ? `<button class="eval-button eval-bad ${bA}" data-score="${bPts}" onclick="setButtonScore(${i}, ${bPts}, ${pts})">Kötü (${bPts})</button>` : ''}
                    </div><span class="score-badge" id="badge-${i}">${currentVal}</span></div>
                    <input type="text" id="note-${i}" class="note-input" value="${currentNote}" style="display:${currentVal < pts ? 'block' : 'none'};">
                </div>`;
            } else if (isTelesatis) {
                 contentHtml += `
                    <div class="criteria-row" id="row-${i}" data-max-score="${pts}">
                        <div class="criteria-header"><span>${i+1}. ${c.text}</span></div>
                        <div class="criteria-controls" style="display: flex; gap: 15px;">
                            <input type="range" class="custom-range slider-input" id="slider-${i}" min="0" max="${pts}" value="${currentVal}" oninput="updateRowSliderScore(${i}, ${pts})" style="flex-grow: 1;">
                            <span class="score-badge" id="badge-${i}">${currentVal}</span>
                        </div>
                        <input type="text" id="note-${i}" class="note-input" value="${currentNote}" style="display:${currentVal < pts ? 'block' : 'none'};">
                    </div>`;
            }
        });
        contentHtml += `</div>`;
    } else {
        contentHtml += `<div style="padding:15px; border:1px dashed #ccc; text-align:center;"><label>Manuel Puan</label><br><input id="eval-manual-score" type="number" class="swal2-input" value="${evalData.score}" min="0" max="100"></div><textarea id="eval-details" class="swal2-textarea">${typeof evalData.details === 'string' ? evalData.details : ''}</textarea>`;
    }
    contentHtml += `<div><label>Revize Feedback</label><textarea id="eval-feedback" class="swal2-textarea">${evalData.feedback || ''}</textarea></div></div>`;
    
    const { value: formValues } = await Swal.fire({
        html: contentHtml, width: '600px', showCancelButton: true, confirmButtonText: 'Güncelle',
        didOpen: () => { if(isTelesatis) window.recalcTotalSliderScore(); else if (isChat) window.recalcTotalScore(); },
        preConfirm: () => {
            const callId = document.getElementById('eval-callid').value;
            const feedback = document.getElementById('eval-feedback').value;
            if (isCriteriaBased) {
                let total = 0, detailsArr = [];
                for (let i = 0; i < criteriaList.length; i++) {
                    const c = criteriaList[i];
                    if (parseInt(c.points) === 0) continue; 
                    let val, note = document.getElementById(`note-${i}`).value;
                    if (isChat) val = parseInt(document.getElementById(`badge-${i}`).innerText) || 0;
                    else if (isTelesatis) val = parseInt(document.getElementById(`slider-${i}`).value) || 0;
                    else val = parseInt(c.points);
                    total += val;
                    detailsArr.push({ q: c.text, max: parseInt(c.points), score: val, note: note });
                }
                return { agentName, callId, score: total, details: JSON.stringify(detailsArr), feedback };
            } else {
                const score = document.getElementById('eval-manual-score').value;
                const details = document.getElementById('eval-details').value;
                return { agentName, callId, score: parseInt(score), details, feedback };
            }
        }
    });
    if (formValues) {
        Swal.fire({ title: 'Güncelleniyor...', didOpen: () => { Swal.showLoading() } });
        fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: "updateEvaluation", username: currentUser, token: getToken(), ...formValues })
        }).then(r => r.json()).then(d => {
            if (d.result === "success") {
                Swal.fire({ icon: 'success', title: 'Güncellendi', timer: 1500, showConfirmButton: false });
                fetchEvaluationsForAgent(agentName);
            } else Swal.fire('Hata', d.message, 'error');
        });
    }
}

// ==========================================================
// --- 6. DİĞER MODALLAR (EKLEME, DÜZENLEME, OYUN, WIZARD) ---
// ==========================================================

async function addNewCardPopup() {
    const catSelectHTML = getCategorySelectHtml('Bilgi', 'swal-new-cat');
    const { value: formValues } = await Swal.fire({
        title: 'Yeni İçerik Ekle',
        html: `
        <div style="margin-bottom:15px; text-align:left;">
            <select id="swal-type-select" class="swal2-input" style="width:100%;" onchange="toggleAddFields()">
                <option value="card">    📌     Bilgi Kartı</option>
                <option value="news">    📢     Duyuru</option>
                <option value="sales">    📞     Telesatış Scripti</option>
                <option value="sport">    🏆     Spor İçeriği</option>
                <option value="quiz">    ❓     Quiz Sorusu</option>
            </select>
        </div>
        <div id="preview-card" class="card Bilgi" style="text-align:left; border:1px solid #e0e0e0; margin-top:10px;">
            <div class="card-header"><input id="swal-new-title" class="swal2-input" placeholder="Başlık"><div id="cat-container">${catSelectHTML}</div></div>
            <div class="card-content"><textarea id="swal-new-text" class="swal2-textarea" placeholder="İçerik..."></textarea></div>
            <div id="script-container" class="script-box"><textarea id="swal-new-script" class="swal2-textarea" placeholder="Script..."></textarea></div>
            <div id="extra-container" class="card-actions"><input id="swal-new-code" class="swal2-input" placeholder="Kod"><input id="swal-new-link" class="swal2-input" placeholder="Link"></div>
            <div id="sport-extra" style="display:none; padding:10px;">
                <input id="swal-sport-tip" class="swal2-input" placeholder="İpucu"><input id="swal-sport-detail" class="swal2-input" placeholder="Detay">
                <input id="swal-sport-pron" class="swal2-input" placeholder="Okunuş"><input id="swal-sport-icon" class="swal2-input" placeholder="İkon">
            </div>
            <div id="news-extra" style="display:none; padding:10px;">
                <select id="swal-news-type" class="swal2-input"><option value="info">Bilgi</option><option value="update">Değişiklik</option><option value="fix">Çözüldü</option></select>
                <select id="swal-news-status" class="swal2-input"><option value="Aktif">Aktif</option><option value="Pasif">Pasif</option></select>
            </div>
            <div id="quiz-extra" style="display:none; padding:10px;">
                <textarea id="swal-quiz-q" class="swal2-textarea" placeholder="Soru"></textarea><input id="swal-quiz-opts" class="swal2-input" placeholder="Seçenekler (virgülle)"><input id="swal-quiz-ans" type="number" class="swal2-input" placeholder="Doğru Cevap İndeksi">
            </div>
        </div>`,
        width: '700px', showCancelButton: true, confirmButtonText: 'Ekle',
        didOpen: () => {
            window.toggleAddFields = function() {
                const type = document.getElementById('swal-type-select').value;
                const els = ['cat-container', 'script-container', 'extra-container', 'sport-extra', 'news-extra', 'quiz-extra'];
                els.forEach(id => document.getElementById(id).style.display = 'none');
                if (type === 'card') { ['cat-container', 'script-container', 'extra-container'].forEach(id => document.getElementById(id).style.display = 'block'); document.getElementById('extra-container').style.display='grid'; }
                else if (type === 'sales') document.getElementById('script-container').style.display = 'block';
                else if (type === 'sport') document.getElementById('sport-extra').style.display = 'block';
                else if (type === 'news') document.getElementById('news-extra').style.display = 'block';
                else if (type === 'quiz') document.getElementById('quiz-extra').style.display = 'block';
            };
        },
        preConfirm: () => {
            const type = document.getElementById('swal-type-select').value;
            const dateStr = new Date().toLocaleDateString('tr-TR');
            const quizOpts = type === 'quiz' ? document.getElementById('swal-quiz-opts').value : '';
            const quizAns = type === 'quiz' ? document.getElementById('swal-quiz-ans').value : '';
            const quizQ = type === 'quiz' ? document.getElementById('swal-quiz-q').value : '';
            if (type === 'quiz' && (!quizQ || !quizOpts || quizAns === '')) return Swal.showValidationMessage('Eksik bilgi');
            return {
                cardType: type, category: type==='card' ? document.getElementById('swal-new-cat').value : (type==='news' ? document.getElementById('swal-news-type').value : ''),
                title: document.getElementById('swal-new-title').value, text: type==='quiz' ? quizQ : document.getElementById('swal-new-text').value,
                script: (type==='card'||type==='sales') ? document.getElementById('swal-new-script').value : '',
                code: type==='card' ? document.getElementById('swal-new-code').value : '', status: type==='news' ? document.getElementById('swal-news-status').value : '',
                link: type==='card' ? document.getElementById('swal-new-link').value : '', tip: type==='sport' ? document.getElementById('swal-sport-tip').value : '',
                detail: type==='sport' ? document.getElementById('swal-sport-detail').value : '', pronunciation: type==='sport' ? document.getElementById('swal-sport-pron').value : '',
                icon: type==='sport' ? document.getElementById('swal-sport-icon').value : '', date: dateStr, quizOptions: quizOpts, quizAnswer: quizAns
            }
        }
    });
    if (formValues) {
        if(!formValues.title) return Swal.fire('Hata', 'Başlık zorunlu!', 'error');
        fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: "addCard", username: currentUser, token: getToken(), ...formValues }) })
        .then(r => r.json()).then(d => { if (d.result === "success") { Swal.fire('Başarılı', 'Eklendi.', 'success'); setTimeout(loadContentData, 1000); } else Swal.fire('Hata', d.message, 'error'); });
    }
}

async function editContent(index) {
    const item = activeCards[index];
    const catSelectHTML = getCategorySelectHtml(item.category, 'swal-cat');
    
    // Görseldeki gibi temiz, alt alta sıralanmış input yapısı
    const htmlContent = `
    <div style="display:flex; flex-direction:column; gap:15px; text-align:left;">
        <input id="swal-title" class="swal2-input custom-swal-input" value="${item.title}" placeholder="Başlık">
        ${catSelectHTML}
        <textarea id="swal-text" class="swal2-textarea custom-swal-textarea" placeholder="İçerik Metni">${(item.text||'').replace(/<br>/g,'\n')}</textarea>
        <textarea id="swal-script" class="swal2-textarea custom-swal-textarea" placeholder="Script Metni">${(item.script||'').replace(/<br>/g,'\n')}</textarea>
        <input id="swal-code" class="swal2-input custom-swal-input" value="${item.code||''}" placeholder="Kod (Opsiyonel)">
        <input id="swal-link" class="swal2-input custom-swal-input" value="${item.link||''}" placeholder="Link (Opsiyonel)">
    </div>
    `;

    const { value: formValues } = await Swal.fire({
        title: 'Düzenle',
        html: htmlContent,
        width: '600px',
        showCancelButton: true,
        confirmButtonText: 'Kaydet',
        cancelButtonText: 'İptal',
        customClass: {
            popup: 'custom-swal-popup'
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
    if (!s) return Swal.fire('Hata', 'Bulunamadı.', 'error');
    const { value: f } = await Swal.fire({
        title: 'Spor Düzenle', html: `<input id="swal-title" class="swal2-input" value="${s.title}"><textarea id="swal-desc" class="swal2-textarea">${s.desc||''}</textarea><input id="swal-tip" class="swal2-input" value="${s.tip||''}"><textarea id="swal-detail" class="swal2-textarea">${s.detail||''}</textarea><input id="swal-pron" class="swal2-input" value="${s.pronunciation||''}"><input id="swal-icon" class="swal2-input" value="${s.icon||''}">`,
        showCancelButton: true, confirmButtonText: 'Kaydet',
        preConfirm: () => [ document.getElementById('swal-title').value, document.getElementById('swal-desc').value, document.getElementById('swal-tip').value, document.getElementById('swal-detail').value, document.getElementById('swal-pron').value, document.getElementById('swal-icon').value ]
    });
    if (f) {
        if(f[1]!==s.desc) sendUpdate(s.title, "Text", f[1], 'sport');
        if(f[2]!==s.tip) setTimeout(()=>sendUpdate(s.title, "Tip", f[2], 'sport'),500);
        if(f[3]!==s.detail) setTimeout(()=>sendUpdate(s.title, "Detail", f[3], 'sport'),1000);
        if(f[4]!==s.pronunciation) setTimeout(()=>sendUpdate(s.title, "Pronunciation", f[4], 'sport'),1500);
        if(f[5]!==s.icon) setTimeout(()=>sendUpdate(s.title, "Icon", f[5], 'sport'),2000);
        if(f[0]!==s.title) setTimeout(()=>sendUpdate(s.title, "Title", f[0], 'sport'),2500);
    }
}

async function editSales(title) {
    event.stopPropagation();
    const s = salesScripts.find(item => item.title === title);
    if (!s) return Swal.fire('Hata', 'Bulunamadı.', 'error');
    const { value: f } = await Swal.fire({
        title: 'Satış Düzenle', html: `<input id="swal-title" class="swal2-input" value="${s.title}"><textarea id="swal-text" class="swal2-textarea">${s.text||''}</textarea>`,
        showCancelButton: true, confirmButtonText: 'Kaydet', preConfirm: () => [ document.getElementById('swal-title').value, document.getElementById('swal-text').value ]
    });
    if (f) {
        if(f[1]!==s.text) sendUpdate(s.title, "Text", f[1], 'sales');
        if(f[0]!==s.title) setTimeout(()=>sendUpdate(s.title, "Title", f[0], 'sales'), 500);
    }
}

async function editNews(index) {
    const i = newsData[index];
    const { value: f } = await Swal.fire({
        title: 'Duyuru Düzenle', html: `<input id="swal-title" class="swal2-input" value="${i.title}"><input id="swal-date" class="swal2-input" value="${i.date}"><select id="swal-type" class="swal2-input"><option value="info">Bilgi</option><option value="update">Update</option><option value="fix">Fix</option></select><textarea id="swal-desc" class="swal2-textarea">${i.desc}</textarea><select id="swal-status" class="swal2-input"><option value="Aktif">Aktif</option><option value="Pasif">Pasif</option></select>`,
        showCancelButton: true, confirmButtonText: 'Kaydet', preConfirm: () => [ document.getElementById('swal-title').value, document.getElementById('swal-date').value, document.getElementById('swal-desc').value, document.getElementById('swal-type').value, document.getElementById('swal-status').value ]
    });
    if (f) {
        if(f[1]!==i.date) sendUpdate(i.title, "Date", f[1], 'news');
        if(f[2]!==i.desc) setTimeout(()=>sendUpdate(i.title, "Text", f[2], 'news'), 500);
        if(f[3]!==i.type) setTimeout(()=>sendUpdate(i.title, "Category", f[3], 'news'), 1000);
        if(f[4]!==i.status) setTimeout(()=>sendUpdate(i.title, "Status", f[4], 'news'), 1500);
        if(f[0]!==i.title) setTimeout(()=>sendUpdate(i.title, "Title", f[0], 'news'), 2000);
    }
}

function openPenaltyGame() { document.getElementById('penalty-modal').style.display = 'flex'; showLobby(); }
function showLobby() { document.getElementById('penalty-lobby').style.display = 'flex'; document.getElementById('penalty-game-area').style.display = 'none'; fetchLeaderboard(); }
function startGameFromLobby() { document.getElementById('penalty-lobby').style.display = 'none'; document.getElementById('penalty-game-area').style.display = 'block'; startPenaltySession(); }

function fetchLeaderboard() {
    const tbody = document.getElementById('leaderboard-body'), loader = document.getElementById('leaderboard-loader'), table = document.getElementById('leaderboard-table');
    tbody.innerHTML = ''; loader.style.display = 'block'; table.style.display = 'none';
    fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: "getLeaderboard" }) }).then(r=>r.json()).then(data => {
        loader.style.display = 'none'; if(data.result === "success") { table.style.display = 'table';
            let html = '';
            if(data.leaderboard.length === 0) html = '<tr><td colspan="4" style="text-align:center;">Maç yok.</td></tr>';
            else data.leaderboard.forEach((u, i) => { html += `<tr style="${u.username===currentUser?'background:rgba(250,187,0,0.1)':''}"><td>${i+1}</td><td>${u.username}</td><td>${u.games}</td><td>${u.average}</td></tr>`; });
            tbody.innerHTML = html;
        } else loader.innerText = "Yüklenemedi.";
    });
}
function startPenaltySession() { pScore = 0; pBalls = 10; jokers = { call: 1, half: 1, double: 1 }; doubleChanceUsed = false; firstAnswerIndex = -1; updateJokerButtons(); document.getElementById('p-score').innerText = pScore; document.getElementById('p-balls').innerText = pBalls; document.getElementById('p-restart-btn').style.display = 'none'; document.getElementById('p-options').style.display = 'grid'; resetField(); loadPenaltyQuestion(); }
function updateJokerButtons() { document.getElementById('joker-call').disabled = jokers.call===0; document.getElementById('joker-half').disabled = jokers.half===0; document.getElementById('joker-double').disabled = jokers.double===0||firstAnswerIndex!==-1; }
function useJoker(type) { if (jokers[type]===0 || (firstAnswerIndex!==-1 && type!=='double')) return; jokers[type] = 0; updateJokerButtons(); if (type === 'call') Swal.fire('Telefon Jokeri', 'Cevap A olabilir.', 'info'); else if (type === 'half') Swal.fire('Yarı Yarıya', '2 şık elendi.', 'success'); else if (type === 'double') { doubleChanceUsed = true; Swal.fire('Çift Cevap', '2 hakkın var.', 'warning'); } }

let pScore=0, pBalls=10, pCurrentQ=null;
function loadPenaltyQuestion() {
    if (pBalls <= 0) { finishPenaltyGame(); return; }
    if (quizQuestions.length === 0) return Swal.fire('Hata', 'Soru yok!', 'warning');
    pCurrentQ = quizQuestions[Math.floor(Math.random() * quizQuestions.length)];
    document.getElementById('p-question-text').innerText = pCurrentQ.q; doubleChanceUsed = false; firstAnswerIndex = -1; updateJokerButtons();
    let html = ''; pCurrentQ.opts.forEach((opt, i) => html += `<button class="penalty-btn" onclick="shootBall(${i})">${String.fromCharCode(65+i)}: ${opt}</button>`);
    document.getElementById('p-options').innerHTML = html;
}
function shootBall(idx) {
    const btns = document.querySelectorAll('.penalty-btn'), isCorrect = (idx === pCurrentQ.a);
    if (!isCorrect && doubleChanceUsed && firstAnswerIndex === -1) { firstAnswerIndex = idx; btns[idx].classList.add('wrong-first-try'); btns[idx].disabled = true; return; }
    btns.forEach(b => b.disabled = true);
    setTimeout(() => {
        if (isCorrect) { pScore++; document.getElementById('p-score').innerText = pScore; document.getElementById('goal-msg').innerText = "GOL!"; document.getElementById('goal-msg').classList.add('show'); }
        else { document.getElementById('goal-msg').innerText = "DIŞARI!"; document.getElementById('goal-msg').classList.add('show'); }
    }, 500);
    pBalls--; document.getElementById('p-balls').innerText = pBalls; setTimeout(() => { resetField(); loadPenaltyQuestion(); }, 2000);
}
function resetField() { document.getElementById('goal-msg').classList.remove('show'); document.querySelectorAll('.penalty-btn').forEach(b => { b.classList.remove('wrong-first-try'); b.disabled = false; }); }
function finishPenaltyGame() { document.getElementById('p-question-text').innerHTML = `MAÇ BİTTİ!<br>Skor: ${pScore}/10`; document.getElementById('p-options').style.display = 'none'; document.getElementById('p-restart-btn').style.display = 'block'; fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: "logQuiz", username: currentUser, token: getToken(), score: pScore * 10, total: 100 }) }); }

const twState = { currentStep: 'start', history: [] };
function openTechWizard() { document.getElementById('tech-wizard-modal').style.display = 'flex'; if(Object.keys(techWizardData).length===0) loadTechWizardData().then(twResetWizard); else twRenderStep(); }
function twRenderStep() {
    const c = document.getElementById('tech-wizard-content'), b = document.getElementById('tw-btn-back'), s = techWizardData[twState.currentStep];
    b.style.display = twState.history.length > 0 ? 'block' : 'none';
    if (!s) return c.innerHTML = '<div style="color:red;">Adım bulunamadı.</div>';
    let h = `<div class="tech-step-title">${s.title||''}</div>${s.text?`<p>${s.text}</p>`:''}`;
    if(s.script) h += `<div class="tech-script-box"><span class="tech-script-label">İletilecek:</span>"${s.script}"<button class="btn btn-copy" onclick="copyScriptContent('${encodeURIComponent(s.script)}')">Kopyala</button></div>`;
    if(s.alert) h += `<div class="tech-alert">${s.alert}</div>`;
    if(s.buttons) { h += `<div class="tech-buttons-area">`; s.buttons.forEach(bt => h += `<button class="tech-btn ${bt.style==='option'?'tech-btn-option':'tech-btn-primary'}" onclick="twChangeStep('${bt.next}')">${bt.text}</button>`); h += `</div>`; }
    c.innerHTML = h;
}
function twChangeStep(n) { twState.history.push(twState.currentStep); twState.currentStep = n; twRenderStep(); }
function twGoBack() { if(twState.history.length>0) { twState.currentStep = twState.history.pop(); twRenderStep(); } }
function twResetWizard() { twState.currentStep = 'start'; twState.history = []; twRenderStep(); }

function openNews() { document.getElementById('news-modal').style.display = 'flex'; const c = document.getElementById('news-container'); c.innerHTML=''; newsData.forEach((i,x)=>{ let eb=(isAdminMode&&isEditingActive)?`<i class="fas fa-pencil-alt edit-icon" onclick="editNews(${x})"></i>`:''; c.innerHTML+=`<div class="news-item">${eb}<span class="news-date">${i.date}</span><span class="news-title">${i.title}</span><div class="news-desc">${i.desc}</div></div>`; }); }
function openGuide() {
    document.getElementById('guide-modal').style.display = 'flex';
    const g = document.getElementById('guide-grid');
    g.innerHTML = '';
    sportsData.forEach((s, x) => {
        let editBtn = (isAdminMode && isEditingActive) 
            ? `<div class="guide-edit-btn" onclick="event.stopPropagation(); editSport('${escapeForJsString(s.title)}')"><i class="fas fa-pencil-alt"></i></div>` 
            : '';
        
        let pronHtml = s.pronunciation ? `<div class="guide-pronunciation">🗣️ ${s.pronunciation}</div>` : '';
        let tipHtml = s.tip ? `<div class="guide-tip-box"><i class="fas fa-lightbulb"></i> ${s.tip}</div>` : '';
        
        // Görseldeki kart yapısına birebir uygun HTML
        g.innerHTML += `
        <div class="guide-card-new" onclick="showSportDetail(${x})">
            ${editBtn}
            <div class="guide-icon-area">
                <i class="fas ${s.icon} guide-icon-large"></i>
            </div>
            <div class="guide-content-area">
                <div class="guide-card-title">${s.title}</div>
                ${pronHtml}
                <div class="guide-card-desc">${s.desc || ''}</div>
                ${tipHtml}
            </div>
            <div class="guide-footer">(Detay için tıkla)</div>
        </div>`;
    });
}

function showSportDetail(x) { 
    const s=sportsData[x]; 
    const detailText = s.detail ? s.detail.replace(/\n/g,'<br>') : "Detay bilgisi yok.";
    const pronDetail = s.pronunciation ? `<div style="color:#e65100; font-weight:bold; margin-bottom:15px; font-style:italic;">🗣️ Okunuşu: ${s.pronunciation}</div>` : '';
    
    Swal.fire({ 
        title: `<i class="fas ${s.icon}" style="color:#0e1b42;"></i> ${s.title}`,
        html: `${pronDetail}<div style="text-align:left; font-size:1rem; line-height:1.6;">${detailText}</div>`, 
        width:'600px',
        background: '#f8f9fa' 
    }); 
}

function openSales() { document.getElementById('sales-modal').style.display='flex'; const c=document.getElementById('sales-grid'); c.innerHTML=''; salesScripts.forEach((s,x)=>{ let eb=(isAdminMode&&isEditingActive)?`<i class="fas fa-pencil-alt edit-icon" onclick="editSales('${escapeForJsString(s.title)}')"></i>`:''; c.innerHTML+=`<div class="sales-item" id="sales-${x}" onclick="toggleSales('${x}')">${eb}<div class="sales-header"><span class="sales-title">${s.title}</span></div><div class="sales-text">${s.text}</div></div>`; }); }
function toggleSales(x) { document.getElementById(`sales-${x}`).classList.toggle('active'); }
function closeModal(id) { document.getElementById(id).style.display='none'; }
function openWizard() { document.getElementById('wizard-modal').style.display='flex'; if(Object.keys(wizardStepsData).length===0) loadWizardData().then(()=>renderStep('start')); else renderStep('start'); }
function renderStep(k) { const s=wizardStepsData[k]; if(!s) return; let h=`<h2>${s.title}</h2><p>${s.text}</p>`; if(s.result) h+=`<div class="result-box ${s.result==='red'?'res-red':'res-green'}"><h3>${s.title}</h3></div><button class="restart-btn" onclick="renderStep('start')">Başa Dön</button>`; else { h+=`<div class="wizard-options">`; s.options.forEach(o=>h+=`<button class="option-btn" onclick="renderStep('${o.next}')">${o.text}</button>`); h+=`</div>`; } document.getElementById('wizard-body').innerHTML=h; }
function startTicker() { const t=document.getElementById('ticker-content'), a=newsData.filter(i=>i.status!=='Pasif'); if(a.length===0){t.innerHTML="Güncel duyuru yok."; return;} let tx=a.map(i=>`[${i.date}] ${i.title}: ${i.desc}`).join(' • '); t.innerHTML=tx+tx+tx; }
