// ==========================================
// LOGIKA UI GLOBAL & SECURITY CHECK
// ==========================================

// 1. PROTEKSI HALAMAN (SECURITY GUARD)
// Jika tidak ada token login di memori, dan sedang tidak berada di halaman login, lemparkan keluar!
if (!window.location.pathname.includes('login.html')) {
    if (!localStorage.getItem('relawan_token')) {
        window.location.replace('login.html');
    }
}

// ==========================================
// 2. LOGIKA BUKA TUTUP SIDEBAR
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

// Gunakan onclick agar event listener lama tertimpa
if (btnToggleSidebar) {
    btnToggleSidebar.onclick = toggleSidebar;
}

// 3. Logika Notifikasi Toast
function showToast(msg, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return; 
    
    const toast = document.createElement('div');
    const config = { 
        success: { b: 'border-green-500', i: '<i class="fa-solid fa-check text-green-500"></i>' }, 
        error: { b: 'border-red-500', i: '<i class="fa-solid fa-xmark text-red-500"></i>' }, 
        loading: { b: 'border-blue-500', i: '<i class="fa-solid fa-spinner fa-spin text-blue-500"></i>' } 
    };
    
    toast.className = `toast-enter flex items-center gap-4 w-80 p-4 rounded-xl shadow-lg border-l-4 bg-white ${config[type].b} text-slate-800 z-50 pointer-events-auto`;
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

// 4. Logika Keluar (Logout) Terverifikasi
function logoutSystem() {
    // Hapus tiket masuk dari memori
    localStorage.removeItem('relawan_token');
    showToast("Mengunci sistem...", "loading");
    
    setTimeout(() => {
        window.location.replace('login.html');
    }, 800);
}

// ==========================================
// 5. PWA SERVICE WORKER REGISTRATION
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('✅ PWA Service Worker Aktif!', reg.scope))
            .catch(err => console.log('❌ PWA Service Worker Gagal:', err));
    });
}

// VARIABEL PENYIMPAN FILTER AKTIF
let activeExcelFilters = {}; // Menyimpan nilai filter per kolom
let activeSortColumn = null;
let activeSortDirection = 'asc'; // 'asc' (A-Z) atau 'desc' (Z-A)

// ELEMEN CONTAINER POP-UP FILTER (Dibuat otomatis jika belum ada)
document.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById('excelFilterPopup')) {
        const popupDiv = document.createElement('div');
        popupDiv.id = 'excelFilterPopup';
        popupDiv.className = 'absolute hidden bg-white rounded-xl shadow-2xl border border-slate-200 z-50 p-3 w-64 text-xs';
        document.body.appendChild(popupDiv);
        
        // Tutup popup jika klik di luar
        document.addEventListener('click', (e) => {
            const popup = document.getElementById('excelFilterPopup');
            if (!e.target.closest('#excelFilterPopup') && !e.target.closest('button[onclick*="bukaExcelFilter"]')) {
                popup.classList.add('hidden');
            }
        });
    }
});

// ==========================================
// UPGRADE POP-UP EXCEL FILTER (DENGAN SEARCH & SELECT ALL / DESELECT ALL)
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
        <div class="font-bold text-slate-700 mb-2 pb-1 border-b border-slate-100 flex justify-between items-center text-xs">
            <span>Filter & Urutkan</span>
            <span class="text-primary cursor-pointer underline hover:text-indigo-700" onclick="resetFilterKolom('${columnKey}')">Reset</span>
        </div>
        
        <div class="space-y-1 mb-2 text-xs">
            <button onclick="sortDataKolom('${columnKey}', 'asc')" class="w-full text-left px-2 py-1.5 hover:bg-slate-50 rounded font-semibold text-slate-600 flex items-center gap-2"><i class="fa-solid fa-arrow-down-a-z text-primary"></i> Urutkan A ke Z</button>
            <button onclick="sortDataKolom('${columnKey}', 'desc')" class="w-full text-left px-2 py-1.5 hover:bg-slate-50 rounded font-semibold text-slate-600 flex items-center gap-2"><i class="fa-solid fa-arrow-up-z-a text-primary"></i> Urutkan Z ke A</button>
        </div>

        <div class="mb-2 relative">
            <i class="fa-solid fa-search absolute left-2.5 top-2 text-slate-400 text-[10px]"></i>
            <input type="text" id="searchPopupInput" onkeyup="filterListPopup(this)" placeholder="Cari nama/data..." class="w-full bg-slate-50 border border-slate-300 rounded-lg pl-7 pr-3 py-1.5 text-xs outline-none focus:border-primary">
        </div>

        <div class="flex justify-between items-center mb-1 text-[11px] font-bold text-indigo-600 px-1">
            <span class="cursor-pointer hover:underline" onclick="toggleAllPopupCheckbox(true, 'riwayat')">Pilih Semua</span>
            <span class="text-slate-300">|</span>
            <span class="cursor-pointer hover:underline text-red-500" onclick="toggleAllPopupCheckbox(false, 'riwayat')">Hapus Semua</span>
        </div>

        <div class="max-h-44 overflow-y-auto space-y-1 pr-1 custom-scroll border border-slate-100 p-1 rounded-lg bg-slate-50/50" id="excelCheckboxList">
    `;

    uniqueValues.forEach(val => {
        const isChecked = currentSelected.length === 0 || currentSelected.includes(val) ? 'checked' : '';
        html += `
            <label class="popup-item-label flex items-center gap-2 p-1 hover:bg-white rounded cursor-pointer text-xs">
                <input type="checkbox" value="${val}" data-col="${columnKey}" class="excel-filter-chk w-3.5 h-3.5 accent-primary rounded shrink-0" ${isChecked} onchange="terapkanExcelFilter()">
                <span class="truncate text-slate-700 font-medium">${val}</span>
            </label>
        `;
    });

    html += `</div>`;
    popup.innerHTML = html;
    popup.classList.remove('hidden');
}

// ==========================================
// UPGRADE POP-UP EXCEL FILTER (MASTER)
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
        <div class="font-bold text-slate-700 mb-2 pb-1 border-b border-slate-100 flex justify-between items-center text-xs">
            <span>Filter & Urutkan</span>
            <span class="text-primary cursor-pointer underline hover:text-indigo-700" onclick="resetFilterKolomMaster('${columnKey}')">Reset</span>
        </div>
        
        <div class="space-y-1 mb-2 text-xs">
            <button onclick="sortDataKolomMaster('${columnKey}', 'asc')" class="w-full text-left px-2 py-1.5 hover:bg-slate-50 rounded font-semibold text-slate-600 flex items-center gap-2"><i class="fa-solid fa-arrow-down-a-z text-primary"></i> Urutkan A ke Z</button>
            <button onclick="sortDataKolomMaster('${columnKey}', 'desc')" class="w-full text-left px-2 py-1.5 hover:bg-slate-50 rounded font-semibold text-slate-600 flex items-center gap-2"><i class="fa-solid fa-arrow-up-z-a text-primary"></i> Urutkan Z ke A</button>
        </div>

        <div class="mb-2 relative">
            <i class="fa-solid fa-search absolute left-2.5 top-2 text-slate-400 text-[10px]"></i>
            <input type="text" id="searchPopupInput" onkeyup="filterListPopupMaster(this)" placeholder="Cari data..." class="w-full bg-slate-50 border border-slate-300 rounded-lg pl-7 pr-3 py-1.5 text-xs outline-none focus:border-primary">
        </div>

        <div class="flex justify-between items-center mb-1 text-[11px] font-bold text-indigo-600 px-1">
            <span class="cursor-pointer hover:underline" onclick="toggleAllPopupCheckboxMaster(true)">Pilih Semua</span>
            <span class="text-slate-300">|</span>
            <span class="cursor-pointer hover:underline text-red-500" onclick="toggleAllPopupCheckboxMaster(false)">Hapus Semua</span>
        </div>

        <div class="max-h-44 overflow-y-auto space-y-1 pr-1 custom-scroll border border-slate-100 p-1 rounded-lg bg-slate-50/50" id="excelCheckboxList">
    `;

    uniqueValues.forEach(val => {
        const isChecked = currentSelected.length === 0 || currentSelected.includes(val) ? 'checked' : '';
        html += `
            <label class="popup-item-label-master flex items-center gap-2 p-1 hover:bg-white rounded cursor-pointer text-xs">
                <input type="checkbox" value="${val}" data-col="${columnKey}" class="excel-filter-chk-master w-3.5 h-3.5 accent-primary rounded shrink-0" ${isChecked} onchange="terapkanExcelFilterMaster()">
                <span class="truncate text-slate-700 font-medium">${val}</span>
            </label>
        `;
    });

    html += `</div>`;
    popup.innerHTML = html;
    popup.classList.remove('hidden');
}

function filterListPopupMaster(input) {
    const keyword = input.value.toLowerCase();
    const labels = document.querySelectorAll('.popup-item-label-master');
    
    labels.forEach(lbl => {
        const text = lbl.innerText.toLowerCase();
        if (text.includes(keyword)) {
            lbl.style.display = "flex";
        } else {
            lbl.style.display = "none";
        }
    });
}

function toggleAllPopupCheckboxMaster(status) {
    const checkboxes = document.querySelectorAll('.excel-filter-chk-master');
    checkboxes.forEach(chk => {
        if (chk.closest('label').style.display !== 'none') {
            chk.checked = status;
        }
    });
    terapkanExcelFilterMaster();
}

// EKSEKUSI FILTER MASTER
function terapkanExcelFilterMaster() {
    const checkboxes = document.querySelectorAll('.excel-filter-chk-master');
    if (checkboxes.length === 0) return;
    const colKey = checkboxes[0].dataset.col;

    let selectedVals = [];
    checkboxes.forEach(chk => {
        if (chk.checked) selectedVals.push(chk.value);
    });

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
    // Menghubungkan ke fungsi filter paginasi master yang sudah ada di master.js
    if (typeof terapkanFilterDanPaginasi === 'function') {
        terapkanFilterDanPaginasi();
    }
}

// EKSEKUSI FILTER MASTER
function terapkanExcelFilterMaster() {
    const checkboxes = document.querySelectorAll('.excel-filter-chk-master');
    const colKey = checkboxes[0]?.dataset.col;
    if (!colKey) return;

    let selectedVals = [];
    checkboxes.forEach(chk => {
        if (chk.checked) selectedVals.push(chk.value);
    });

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
    let filtered = [...masterDataList];

    Object.keys(activeExcelFilters).forEach(col => {
        const allowedVals = activeExcelFilters[col];
        filtered = filtered.filter(item => allowedVals.includes(item[col] || '-'));
    });

    if (activeSortColumn) {
        filtered.sort((a, b) => {
            let valA = (a[activeSortColumn] || '').toString().toLowerCase();
            let valB = (b[activeSortColumn] || '').toString().toLowerCase();
            if (valA < valB) return activeSortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return activeSortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }

    renderTabelMaster(filtered);
}