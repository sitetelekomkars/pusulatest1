const BAKIM_MODU = false;
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycby3kd04k2u9XdVDD1-vdbQQAsHNW6WLIn8bNYxTlVCL3U1a0WqZo6oPp9zfBWIpwJEinQ/exec";

// Oyun Değişkenleri
let jokers = { call: 1, half: 1, double: 1 };
let doubleChanceUsed = false;
let firstAnswerIndex = -1;
let pScore=0, pBalls=10, pCurrentQ=null;

const VALID_CATEGORIES = ['Teknik', 'İkna', 'Kampanya', 'Bilgi'];
const MONTH_NAMES = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

// Global Değişkenler
let database = [], newsData = [], sportsData = [], salesScripts = [], quizQuestions = [];
let currentUser = "";
let isAdminMode = false;
let isEditingActive = false;
let sessionTimeout;
let activeCards = [];
let currentCategory = 'all';
let adminUserList = [];
let allEvaluationsData = [];
let wizardStepsData = {};
let qualityChartInstance = null; // Chart Instance

// --- İLK YÜKLEME ---
document.addEventListener('contextmenu', event => event.preventDefault());
document.onkeydown = function(e) { if(e.keyCode == 123) return false; }
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
});

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
        if (BAKIM_MODU) document.getElementById("maintenance-screen").style.display = "flex";
        else {
            document.getElementById("main-app").style.display = "block";
            loadContentData();
            loadWizardData();
        }
    }
}
function enterBas(e) { if (e.key === "Enter") girisYap(); }
function girisYap() {
    const uName = document.getElementById("usernameInput").value.trim();
    const uPass = document.getElementById("passInput").value.trim();
    if(!uName || !uPass) return;
    document.getElementById("loading-msg").style.display = "block";
    
    const hashedPass = CryptoJS.SHA256(uPass).toString();
    fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "login", username: uName, password: hashedPass })
    }).then(r => r.json()).then(data => {
        document.getElementById("loading-msg").style.display = "none";
        if (data.result === "success") {
            currentUser = data.username;
            localStorage.setItem("sSportUser", currentUser);
            localStorage.setItem("sSportToken", data.token);
            localStorage.setItem("sSportRole", data.role);
            if (data.forceChange) changePasswordPopup(true);
            else {
                document.getElementById("login-screen").style.display = "none";
                document.getElementById("user-display").innerText = currentUser;
                checkAdmin(data.role);
                startSessionTimer();
                document.getElementById("main-app").style.display = "block";
                loadContentData();
                loadWizardData();
            }
        } else {
            document.getElementById("error-msg").style.display = "block";
        }
    });
}
function checkAdmin(role) {
    isAdminMode = (role === "admin");
    const addCardDropdown = document.getElementById('dropdownAddCard');
    const quickEditDropdown = document.getElementById('dropdownQuickEdit');
    if(isAdminMode) {
        if(addCardDropdown) addCardDropdown.style.display = 'flex';
        if(quickEditDropdown) quickEditDropdown.style.display = 'flex';
    } else {
        if(addCardDropdown) addCardDropdown.style.display = 'none';
        if(quickEditDropdown) quickEditDropdown.style.display = 'none';
    }
}
function logout() {
    localStorage.removeItem("sSportUser"); localStorage.removeItem("sSportToken"); localStorage.removeItem("sSportRole");
    location.reload();
}
function startSessionTimer() {
    if (sessionTimeout) clearTimeout(sessionTimeout);
    sessionTimeout = setTimeout(() => { Swal.fire('Oturum süresi doldu.').then(()=>logout()); }, 3600000);
}
function getToken() { return localStorage.getItem("sSportToken"); }

// --- DATA FETCHING ---
function loadContentData() {
    document.getElementById('loading').style.display = 'block';
    fetch(SCRIPT_URL, {
        method: 'POST', headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "fetchData" })
    }).then(r=>r.json()).then(data => {
        document.getElementById('loading').style.display = 'none';
        if (data.result === "success") {
            const raw = data.data;
            database = raw.filter(i => ['card','bilgi','teknik','kampanya','ikna'].includes(i.Type.toLowerCase()));
            newsData = raw.filter(i => i.Type.toLowerCase() === 'news');
            sportsData = raw.filter(i => i.Type.toLowerCase() === 'sport');
            salesScripts = raw.filter(i => i.Type.toLowerCase() === 'sales');
            quizQuestions = raw.filter(i => i.Type.toLowerCase() === 'quiz').map(i => ({
                q: i.Text, opts: i.QuizOptions ? i.QuizOptions.split(',') : [], a: parseInt(i.QuizAnswer)
            }));
            activeCards = database;
            renderCards(database);
            startTicker();
        }
    });
}
function loadWizardData() {
    fetch(SCRIPT_URL, {
        method: 'POST', body: JSON.stringify({ action: "getWizardData" })
    }).then(r=>r.json()).then(d => { if(d.result==="success") wizardStepsData = d.steps; });
}

// --- UI RENDERING ---
function renderCards(data) {
    const c = document.getElementById('cardGrid'); c.innerHTML = '';
    if(data.length === 0) { c.innerHTML = '<div style="color:#777;">Kayıt yok.</div>'; return; }
    data.forEach(item => {
        let isFav = (JSON.parse(localStorage.getItem('sSportFavs')||'[]')).includes(item.Title);
        let favClass = isFav ? 'fas fa-star active' : 'far fa-star';
        c.innerHTML += `<div class="card ${item.Category}">
            <div class="icon-wrapper"><i class="${favClass} fav-icon" onclick="toggleFavorite('${item.Title}')"></i></div>
            <div class="card-header"><h3 class="card-title">${item.Title}</h3><span class="badge">${item.Category}</span></div>
            <div class="card-content" onclick="showCardDetail('${item.Title}', '${(item.Text||'').replace(/'/g,"\\'")}')">
                <div class="card-text-truncate">${item.Text}</div>
            </div>
            <div class="script-box">${item.Script || ''}</div>
            <div class="card-actions">
                ${item.Link ? `<a href="${item.Link}" target="_blank" class="btn-copy">Link</a>` : ''}
                <button class="btn-copy" onclick="copyText('${(item.Script||'').replace(/'/g,"\\'")}')">Kopyala</button>
            </div>
        </div>`;
    });
}
function filterCategory(btn, cat) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = cat;
    filterContent();
}
function filterContent() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    let filtered = database;
    if(currentCategory === 'fav') filtered = filtered.filter(i => (JSON.parse(localStorage.getItem('sSportFavs')||'[]')).includes(i.Title));
    else if(currentCategory !== 'all') filtered = filtered.filter(i => i.Category === currentCategory);
    filtered = filtered.filter(i => i.Title.toLowerCase().includes(search) || i.Text.toLowerCase().includes(search));
    renderCards(filtered);
}
function toggleFavorite(t) {
    let favs = JSON.parse(localStorage.getItem('sSportFavs')||'[]');
    if(favs.includes(t)) favs = favs.filter(i=>i!==t); else favs.push(t);
    localStorage.setItem('sSportFavs', JSON.stringify(favs));
    filterContent();
}
function showCardDetail(t, txt) { Swal.fire({title: t, html: txt.replace(/\n/g,'<br>'), width:'600px'}); }
function copyText(t) { navigator.clipboard.writeText(t); Swal.fire({toast:true, position:'top-end', icon:'success', title:'Kopyalandı', showConfirmButton:false, timer:1500}); }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// --- DASHBOARD & QUALITY (GÜNCELLENEN KISIM) ---
function openQualityArea() {
    document.getElementById('quality-modal').style.display = 'flex';
    document.getElementById('admin-quality-controls').style.display = isAdminMode ? 'flex' : 'none';
    
    // Ay Filtresi
    const selectEl = document.getElementById('month-select-filter');
    selectEl.innerHTML = '';
    const now = new Date();
    for (let i = 0; i < 6; i++) {
        let d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        let val = `${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
        let txt = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
        let opt = document.createElement('option'); opt.value = val; opt.textContent = txt;
        selectEl.appendChild(opt);
    }
    
    if (isAdminMode) {
        fetch(SCRIPT_URL, {
            method: 'POST', body: JSON.stringify({ action: "getUserList", username: currentUser, token: getToken() })
        }).then(r=>r.json()).then(data => {
            if (data.result === "success") {
                const sel = document.getElementById('agent-select-admin');
                sel.innerHTML = `<option value="all">-- Tüm Ekip --</option>` + data.users.map(u => `<option value="${u.name}" data-group="${u.group}">${u.name}</option>`).join('');
                fetchEvaluationsForAgent('all');
            }
        });
    } else {
        fetchEvaluationsForAgent(currentUser);
    }
}

function fetchEvaluationsForAgent(forcedName) {
    const listEl = document.getElementById('evaluations-list-dashboard');
    listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#999;"><i class="fas fa-circle-notch fa-spin"></i> Veriler analiz ediliyor...</div>';
    
    let target = forcedName || (isAdminMode ? document.getElementById('agent-select-admin').value : currentUser);
    
    fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "fetchEvaluations", targetAgent: target, username: currentUser, token: getToken() })
    }).then(r=>r.json()).then(data => {
        if (data.result === "success") {
            allEvaluationsData = data.evaluations;
            updateDashboardUI();
        } else {
            listEl.innerHTML = '<div style="text-align:center; color:red;">Veri alınamadı.</div>';
        }
    });
}

function updateDashboardUI() {
    const monthFilter = document.getElementById('month-select-filter').value;
    const filtered = allEvaluationsData.filter(item => {
        if(!item.date) return false;
        const parts = item.date.split('.'); 
        return (parts.length >= 3 && `${parts[1]}.${parts[2]}` === monthFilter);
    });

    // İstatistikler
    let totalScore = 0, count = filtered.length;
    let scores = filtered.map(i => parseInt(i.score)||0);
    if (count > 0) totalScore = scores.reduce((a,b)=>a+b, 0);
    
    const avg = count > 0 ? (totalScore/count).toFixed(1) : 0;
    const targetRate = count > 0 ? ((scores.filter(s=>s>=90).length/count)*100).toFixed(0) : 0;

    document.getElementById('dash-total-score').innerText = avg;
    document.getElementById('dash-total-score').style.color = avg>=90 ? 'var(--success)' : (avg>=80 ? 'var(--warning)' : 'var(--accent)');
    document.getElementById('dash-total-count').innerText = count;
    document.getElementById('dash-target-rate').innerText = `%${targetRate}`;

    // Liste (Sadece son 10 - Donmayı önler)
    const listEl = document.getElementById('evaluations-list-dashboard');
    listEl.innerHTML = '';
    if(count === 0) listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#ccc;">Bu dönem kayıt yok.</div>';
    else {
        // Son 10 kaydı al
        filtered.slice().reverse().slice(0, 10).forEach(item => {
            let badge = item.score >= 90 ? 'score-green' : (item.score >= 70 ? 'score-yellow' : 'score-red');
            listEl.innerHTML += `<div class="dash-list-item">
                <div>
                    <div style="font-weight:bold; color:#333;">${item.callId || 'ID Yok'}</div>
                    <div style="font-size:0.75rem; color:#999;">${item.date}</div>
                </div>
                <span class="dash-score-badge ${badge}">${item.score}</span>
            </div>`;
        });
    }

    // Grafik
    const ctx = document.getElementById('qualityChart').getContext('2d');
    if (qualityChartInstance) qualityChartInstance.destroy();
    
    // Grafiği soldan sağa (eskiden yeniye) çizmek için reverse yapmamız lazım, çünkü filtered listesi karışık olabilir
    // Ancak genelde loglar sırayla gelir. Tarihe göre sıralayalım:
    const sortedForChart = filtered.slice().sort((a,b) => {
        // Tarih formatı dd.mm.yyyy varsayılıyor
        let da = a.date.split('.').reverse().join('');
        let db = b.date.split('.').reverse().join('');
        return da.localeCompare(db);
    });

    qualityChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sortedForChart.map(d => d.date.split('.').slice(0,2).join('/')),
            datasets: [{
                label: 'Kalite Puanı',
                data: sortedForChart.map(d => d.score),
                borderColor: '#3B82F6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.3, fill: true
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: {display:false} },
            scales: { y: { min:0, max:100 } }
        }
    });
}

// --- DİĞER MODÜLLER (Aynen Korundu) ---
function startTicker() {
    const t = document.getElementById('ticker-content');
    const a = newsData.filter(i => i.Status !== 'Pasif');
    if(a.length===0) { t.innerHTML="Duyuru yok."; return; }
    let txt = a.map(i => `<span style="color:#fabb00;">[${i.Date}]</span> ${i.Title}: ${i.Text}`).join(' &nbsp; • &nbsp; ');
    t.innerHTML = txt + ' &nbsp; • &nbsp; ' + txt;
}
function openNews() {
    document.getElementById('news-modal').style.display='flex';
    document.getElementById('news-container').innerHTML = newsData.map(i => 
        `<div class="news-item"><strong>${i.Title}</strong><br>${i.Text}</div>`
    ).join('');
}
function openGuide() {
    document.getElementById('guide-modal').style.display='flex';
    document.getElementById('guide-grid').innerHTML = sportsData.map(s => 
        `<div class="guide-item"><i class="fas ${s.Icon} guide-icon"></i><div class="guide-title">${s.Title}</div><div class="guide-desc">${s.Text}</div></div>`
    ).join('');
}
function openSales() {
    document.getElementById('sales-modal').style.display='flex';
    document.getElementById('sales-grid').innerHTML = salesScripts.map((s,i) => 
        `<div class="sales-item" onclick="this.classList.toggle('active')"><div class="sales-header"><strong>${s.Title}</strong><i class="fas fa-chevron-down"></i></div><div class="sales-text">${s.Text}</div></div>`
    ).join('');
}
function openWizard() {
    document.getElementById('wizard-modal').style.display='flex';
    if(wizardStepsData['start']) renderStep('start');
}
function renderStep(k) {
    const s = wizardStepsData[k];
    if(!s) return;
    let h = `<h2>${s.title||''}</h2><p>${s.text}</p>`;
    if(s.result) h += `<div class="result-box ${s.result==='green'?'res-green':'res-red'}">${s.title}</div><button class="restart-btn" onclick="renderStep('start')">Başa Dön</button>`;
    else { h += `<div class="wizard-options">` + s.options.map(o=>`<button class="option-btn" onclick="renderStep('${o.next}')">${o.text}</button>`).join('') + `</div>`; if(k!=='start') h+=`<button class="restart-btn" onclick="renderStep('start')">Başa Dön</button>`; }
    document.getElementById('wizard-body').innerHTML = h;
}

// --- OYUN FONKSİYONLARI ---
function openPenaltyGame() { document.getElementById('penalty-modal').style.display='flex'; showLobby(); }
function showLobby() { document.getElementById('penalty-lobby').style.display='flex'; document.getElementById('penalty-game-area').style.display='none'; }
function startGameFromLobby() { document.getElementById('penalty-lobby').style.display='none'; document.getElementById('penalty-game-area').style.display='block'; startPenaltySession(); }
function startPenaltySession() { pScore=0; pBalls=10; resetField(); loadPenaltyQuestion(); }
function loadPenaltyQuestion() {
    if(pBalls<=0) { document.getElementById('p-question-text').innerHTML="MAÇ BİTTİ! Skor: "+pScore; document.getElementById('p-options').innerHTML=''; document.getElementById('p-restart-btn').style.display='block'; return; }
    pCurrentQ = quizQuestions[Math.floor(Math.random()*quizQuestions.length)];
    document.getElementById('p-question-text').innerText = pCurrentQ.q;
    document.getElementById('p-options').innerHTML = pCurrentQ.opts.map((o,i)=>`<button class="penalty-btn" onclick="shootBall(${i})">${o}</button>`).join('');
    document.getElementById('p-balls').innerText = pBalls;
}
function shootBall(i) {
    let isCorrect = (i === pCurrentQ.a);
    if(isCorrect) { pScore++; Swal.fire({toast:true, position:'top', icon:'success', title:'GOL!', showConfirmButton:false, timer:1000}); }
    else { Swal.fire({toast:true, position:'top', icon:'error', title:'KAÇIRDIN!', showConfirmButton:false, timer:1000}); }
    document.getElementById('p-score').innerText = pScore;
    pBalls--;
    setTimeout(loadPenaltyQuestion, 1000);
}
function resetField() { document.getElementById('p-restart-btn').style.display='none'; }
function useJoker(type) { if(jokers[type]>0) { jokers[type]--; Swal.fire('Joker kullanıldı'); } }

// --- BOŞ YER TUTUCULAR (Hata önlemek için) ---
function changePasswordPopup(force) { Swal.fire('Şifre değiştirme popup'); }
function addNewCardPopup() { Swal.fire('Ekleme popup'); }
function toggleEditMode() { Swal.fire('Edit modu'); }
function logEvaluationPopup() { Swal.fire('Değerlendirme ekle popup'); }
function exportEvaluations() { Swal.fire('Rapor indiriliyor...'); }
