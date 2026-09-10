// ==========================================
// LOGIKA UI GLOBAL & SECURITY CHECK (V4 UPGRADED)
// ==========================================

// ==========================================
// 1. DARK MODE
// ==========================================
(function initDarkMode() {
    const saved = localStorage.getItem('relawan_dark_mode');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (saved === 'true' || (saved === null && prefersDark)) {
        document.documentElement.classList.add('dark');
    }
    
    updateDarkModeLabel();
})();

function toggleDarkMode() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('relawan_dark_mode', isDark);
    updateDarkModeLabel();
    
    if (typeof Chart !== 'undefined') {
        Chart.defaults.color = isDark ? '#94a3b8' : '#94a3b8';
        Chart.defaults.scale.grid.color = isDark ? '#1e293b' : '#f1f5f9';
    }
}

function updateDarkModeLabel() {
    const label = document.getElementById('darkModeLabel');
    if (label) {
        label.textContent = document.documentElement.classList.contains('dark') ? 'Mode Terang' : 'Mode Gelap';
    }
}

// ==========================================
// 2. PROTEKSI HALAMAN & VALIDASI TOKEN
// ==========================================
if (!window.location.pathname.includes('login.html')) {
    if (!isSessionAlive()) {
        supabaseLogout();
        window.location.replace('login.html');
    }
}

// ==========================================
// 3. LOGIKA BUKA TUTUP SIDEBAR
// ==========================================
const sidebar = document.getElementById('sidebar');
const btnToggleSidebar = document.getElementById('btnToggleSidebar');
const mobileOverlay = document.getElementById('mobileOverlay');

function toggleSidebar() {
    if (!sidebar) return;
    
    const isClosed = sidebar.classList.contains('-translate-x-full');
    
    if (isClosed) {
        sidebar.classList.remove('-translate-x-full');
        if (mobileOverlay) mobileOverlay.classList.remove('hidden');
    } else {
        sidebar.classList.add('-translate-x-full');
        if (mobileOverlay) mobileOverlay.classList.add('hidden');
    }
}

if (btnToggleSidebar) {
    btnToggleSidebar.onclick = toggleSidebar;
}

// ==========================================
// 4. LOGIKA NOTIFIKASI TOAST
// ==========================================
function showToast(msg, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return; 
    
    const toast = document.createElement('div');
    const config = { 
        success: { b: 'border-green-500', i: '<i class="fa-solid fa-check text-green-500"></i>' }, 
        error: { b: 'border-red-500', i: '<i class="fa-solid fa-xmark text-red-500"></i>' }, 
        loading: { b: 'border-blue-500', i: '<i class="fa-solid fa-spinner fa-spin text-blue-500"></i>' },
        info: { b: 'border-blue-500', i: '<i class="fa-solid fa-circle-info text-blue-500"></i>' }
    };
    
    toast.className = `toast-enter flex items-center gap-4 w-80 p-4 rounded-xl shadow-lg border-l-4 bg-white dark:bg-slate-800 ${config[type].b} text-slate-800 dark:text-slate-100 z-50 pointer-events-auto`;
    toast.innerHTML = `<div>${config[type].i}</div><div class="text-sm font-bold">${msg}</div>`;
    
    container.appendChild(toast);
    
    if (type !== 'loading') {
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300); 
        }, 4000);
    }
    return toast;
}

// ==========================================
// 5. LOGIKA KELUAR (LOGOUT)
// ==========================================
function logoutSystem() {
    supabaseLogout();
    showToast("Mengunci sistem...", "loading");
    
    setTimeout(() => {
        window.location.replace('login.html');
    }, 800);
}

// ==========================================
// 6. PWA SERVICE WORKER REGISTRATION
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('PWA Service Worker Aktif!', reg.scope))
            .catch(err => console.log('PWA Service Worker Gagal:', err));
    });
}

// ==========================================
// 7. BROWSER NOTIFICATION HELPER
// ==========================================
function requestNotifikasi() {
    if (!('Notification' in window)) {
        showToast("Browser Anda tidak mendukung notifikasi.", "error");
        return;
    }
    
    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            showToast("Notifikasi diaktifkan!", "success");
        } else {
            showToast("Izin notifikasi ditolak.", "error");
        }
    });
}

function kirimNotifikasiJudul(judul, pesan, icon) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    
    new Notification(judul, {
        body: pesan,
        icon: icon || 'assets/icon.png',
        badge: 'assets/icon.png',
        tag: 'relawansync-reminder',
        renotify: true
    });
}

// ==========================================
// 8. VARIABEL FILTER GLOBAL
// ==========================================
let activeExcelFilters = {};
let activeSortColumn = null;
let activeSortDirection = 'asc';

document.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById('excelFilterPopup')) {
        const popupDiv = document.createElement('div');
        popupDiv.id = 'excelFilterPopup';
        popupDiv.className = 'absolute hidden bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-600 z-50 p-3 w-64 text-xs';
        document.body.appendChild(popupDiv);
        
        document.addEventListener('click', (e) => {
            const popup = document.getElementById('excelFilterPopup');
            if (popup && !e.target.closest('#excelFilterPopup') && !e.target.closest('button[onclick*="bukaExcelFilter"]')) {
                popup.classList.add('hidden');
            }
        });
    }
});

// ==========================================
// 9. POP-UP EXCEL FILTER (RIWAYAT)
// ==========================================

function bukaExcelFilter(columnKey, event) {
    event.stopPropagation();
    const popup = document.getElementById('excelFilterPopup');
    if (!popup) return;

    const rect = event.currentTarget.getBoundingClientRect();
    popup.style.top = `${rect.bottom + window.scrollY + 5}px`;
    popup.style.left = `${rect.left + window.scrollX - 180}px`;
    popup.style.width = '280px';

    const uniqueValues = [...new Set(riwayatData.map(item => item[columnKey] || '-'))].sort();
    const currentSelected = activeExcelFilters[columnKey] || [];

    let html = `
        <div class="font-bold text-slate-700 dark:text-slate-200 mb-2 pb-1 border-b border-slate-100 dark:border-slate-600 flex justify-between items-center text-xs">
            <span>Filter & Urutkan</span>
            <span class="text-primary cursor-pointer underline hover:text-indigo-700" onclick="resetFilterKolom('${columnKey}')">Reset</span>
        </div>
        
        <div class="space-y-1 mb-2 text-xs">
            <button onclick="sortDataKolom('${columnKey}', 'asc')" class="w-full text-left px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 rounded font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-2"><i class="fa-solid fa-arrow-down-a-z text-primary"></i> Urutkan A ke Z</button>
            <button onclick="sortDataKolom('${columnKey}', 'desc')" class="w-full text-left px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 rounded font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-2"><i class="fa-solid fa-arrow-up-z-a text-primary"></i> Urutkan Z ke A</button>
        </div>

        <div class="mb-2 relative">
            <i class="fa-solid fa-search absolute left-2.5 top-2 text-slate-400 text-[10px]"></i>
            <input type="text" id="searchPopupInput" onkeyup="filterListPopup(this)" placeholder="Cari nama/data..." class="w-full bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg pl-7 pr-3 py-1.5 text-xs outline-none text-slate-800 dark:text-slate-100 focus:border-primary">
        </div>

        <div class="flex justify-between items-center mb-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 px-1">
            <span class="cursor-pointer hover:underline" onclick="toggleAllPopupCheckbox(true, 'riwayat')">Pilih Semua</span>
            <span class="text-slate-300 dark:text-slate-600">|</span>
            <span class="cursor-pointer hover:underline text-red-500" onclick="toggleAllPopupCheckbox(false, 'riwayat')">Hapus Semua</span>
        </div>

        <div class="max-h-44 overflow-y-auto space-y-1 pr-1 custom-scroll border border-slate-100 dark:border-slate-600 p-1 rounded-lg bg-slate-50/50 dark:bg-slate-700/50" id="excelCheckboxList">
    `;

    uniqueValues.forEach(val => {
        const isChecked = currentSelected.length === 0 || currentSelected.includes(val) ? 'checked' : '';
        html += `
            <label class="popup-item-label flex items-center gap-2 p-1 hover:bg-white dark:hover:bg-slate-600 rounded cursor-pointer text-xs">
                <input type="checkbox" value="${val}" data-col="${columnKey}" class="excel-filter-chk w-3.5 h-3.5 accent-primary rounded shrink-0" ${isChecked} onchange="terapkanExcelFilter()">
                <span class="truncate text-slate-700 dark:text-slate-200 font-medium">${val}</span>
            </label>
        `;
    });

    html += `</div>`;
    popup.innerHTML = html;
    popup.classList.remove('hidden');
}

function filterListPopup(input) {
    const keyword = input.value.toLowerCase();
    document.querySelectorAll('.popup-item-label').forEach(lbl => {
        lbl.style.display = lbl.innerText.toLowerCase().includes(keyword) ? "flex" : "none";
    });
}

function toggleAllPopupCheckbox(status) {
    document.querySelectorAll('.excel-filter-chk').forEach(chk => {
        if (chk.closest('label').style.display !== 'none') chk.checked = status;
    });
    terapkanExcelFilter();
}

function terapkanExcelFilter() {
    const checkboxes = document.querySelectorAll('.excel-filter-chk');
    if (checkboxes.length === 0) return;
    const colKey = checkboxes[0].dataset.col;
    let selectedVals = [];
    checkboxes.forEach(chk => { if (chk.checked) selectedVals.push(chk.value); });
    activeExcelFilters[colKey] = selectedVals;
    jalankanFilterDanSortRiwayat();
}

function sortDataKolom(columnKey, direction) {
    activeSortColumn = columnKey;
    activeSortDirection = direction;
    jalankanFilterDanSortRiwayat();
    document.getElementById('excelFilterPopup').classList.add('hidden');
}

function resetFilterKolom(columnKey) {
    delete activeExcelFilters[columnKey];
    jalankanFilterDanSortRiwayat();
    document.getElementById('excelFilterPopup').classList.add('hidden');
}

// ==========================================
// 10. POP-UP EXCEL FILTER (MASTER)
// ==========================================

function bukaExcelFilterMaster(columnKey, event) {
    event.stopPropagation();
    const popup = document.getElementById('excelFilterPopup');
    if (!popup) return;

    const rect = event.currentTarget.getBoundingClientRect();
    popup.style.top = `${rect.bottom + window.scrollY + 5}px`;
    popup.style.left = `${rect.left + window.scrollX - 180}px`;
    popup.style.width = '280px';

    const uniqueValues = [...new Set(masterData.map(item => {
        let val = item[columnKey];
        return (val !== null && val !== undefined && val !== "") ? String(val) : '-';
    }))].sort();

    const currentSelected = activeExcelFilters[columnKey] || [];

    let html = `
        <div class="font-bold text-slate-700 dark:text-slate-200 mb-2 pb-1 border-b border-slate-100 dark:border-slate-600 flex justify-between items-center text-xs">
            <span>Filter & Urutkan</span>
            <span class="text-primary cursor-pointer underline hover:text-indigo-700" onclick="resetFilterKolomMaster('${columnKey}')">Reset</span>
        </div>
        
        <div class="space-y-1 mb-2 text-xs">
            <button onclick="sortDataKolomMaster('${columnKey}', 'asc')" class="w-full text-left px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 rounded font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-2"><i class="fa-solid fa-arrow-down-a-z text-primary"></i> Urutkan A ke Z</button>
            <button onclick="sortDataKolomMaster('${columnKey}', 'desc')" class="w-full text-left px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 rounded font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-2"><i class="fa-solid fa-arrow-up-z-a text-primary"></i> Urutkan Z ke A</button>
        </div>

        <div class="mb-2 relative">
            <i class="fa-solid fa-search absolute left-2.5 top-2 text-slate-400 text-[10px]"></i>
            <input type="text" id="searchPopupInput" onkeyup="filterListPopupMaster(this)" placeholder="Cari data..." class="w-full bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg pl-7 pr-3 py-1.5 text-xs outline-none text-slate-800 dark:text-slate-100 focus:border-primary">
        </div>

        <div class="flex justify-between items-center mb-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 px-1">
            <span class="cursor-pointer hover:underline" onclick="toggleAllPopupCheckboxMaster(true)">Pilih Semua</span>
            <span class="text-slate-300 dark:text-slate-600">|</span>
            <span class="cursor-pointer hover:underline text-red-500" onclick="toggleAllPopupCheckboxMaster(false)">Hapus Semua</span>
        </div>

        <div class="max-h-44 overflow-y-auto space-y-1 pr-1 custom-scroll border border-slate-100 dark:border-slate-600 p-1 rounded-lg bg-slate-50/50 dark:bg-slate-700/50" id="excelCheckboxList">
    `;

    uniqueValues.forEach(val => {
        const isChecked = currentSelected.length === 0 || currentSelected.includes(val) ? 'checked' : '';
        html += `
            <label class="popup-item-label-master flex items-center gap-2 p-1 hover:bg-white dark:hover:bg-slate-600 rounded cursor-pointer text-xs">
                <input type="checkbox" value="${val}" data-col="${columnKey}" class="excel-filter-chk-master w-3.5 h-3.5 accent-primary rounded shrink-0" ${isChecked} onchange="terapkanExcelFilterMaster()">
                <span class="truncate text-slate-700 dark:text-slate-200 font-medium">${val}</span>
            </label>
        `;
    });

    html += `</div>`;
    popup.innerHTML = html;
    popup.classList.remove('hidden');
}

function filterListPopupMaster(input) {
    const keyword = input.value.toLowerCase();
    document.querySelectorAll('.popup-item-label-master').forEach(lbl => {
        lbl.style.display = lbl.innerText.toLowerCase().includes(keyword) ? "flex" : "none";
    });
}

function toggleAllPopupCheckboxMaster(status) {
    document.querySelectorAll('.excel-filter-chk-master').forEach(chk => {
        if (chk.closest('label').style.display !== 'none') chk.checked = status;
    });
    terapkanExcelFilterMaster();
}

function terapkanExcelFilterMaster() {
    const checkboxes = document.querySelectorAll('.excel-filter-chk-master');
    if (checkboxes.length === 0) return;
    const colKey = checkboxes[0].dataset.col;
    let selectedVals = [];
    checkboxes.forEach(chk => { if (chk.checked) selectedVals.push(chk.value); });
    activeExcelFilters[colKey] = selectedVals;
    jalankanFilterDanSortMaster();
}

function sortDataKolomMaster(columnKey, direction) {
    activeSortColumn = columnKey;
    activeSortDirection = direction;
    jalankanFilterDanSortMaster();
    document.getElementById('excelFilterPopup').classList.add('hidden');
}

function resetFilterKolomMaster(columnKey) {
    delete activeExcelFilters[columnKey];
    jalankanFilterDanSortMaster();
    document.getElementById('excelFilterPopup').classList.add('hidden');
}

function jalankanFilterDanSortMaster() {
    if (typeof terapkanFilterDanPaginasi === 'function') {
        terapkanFilterDanPaginasi();
    }
}

// ==========================================
// 11. FITUR 1-KLIK BACKUP DATA (JSON)
// ==========================================
async function backupEverything() {
    let loading = showToast("Menyiapkan file backup, mohon tunggu...", "loading");

    try {
        const [masterRes, logRes] = await Promise.all([
            supabaseFetch('master_relawan?select=*', 'GET'),
            supabaseFetch(await terapkanFilterLokasi('log_absensi?select=*'), 'GET')
        ]);

        if (masterRes.status !== "success" || logRes.status !== "success") {
            throw new Error("Gagal mengambil data dari server.");
        }

        const backupData = {
            app_name: "RelawanSync V2",
            backup_date: new Date().toISOString(),
            total_master: masterRes.data.length,
            total_log: logRes.data.length,
            data: {
                master_relawan: masterRes.data,
                log_absensi: logRes.data
            }
        };

        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `Backup_RelawanSync_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 0);

        loading.remove();
        showToast("Backup berhasil diunduh!", "success");

    } catch (error) {
        if (loading) loading.remove();
        showToast("Gagal melakukan backup data.", "error");
        console.error("Backup Error:", error);
    }
}

// ==========================================
// 12. UTILITAS KEAMANAN (ANTI-XSS)
// ==========================================
function escapeHTML(str) {
    if (str === null || str === undefined || str === '') return '-';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
