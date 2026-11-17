// ==========================================
// LOGIKA UI GLOBAL & SECURITY CHECK (V4 UPGRADED)
// ==========================================

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
    const icon = document.createElement('div');
    icon.innerHTML = config[type].i;
    const message = document.createElement('div');
    message.className = 'text-sm font-bold';
    message.textContent = String(msg || '');
    toast.append(icon, message);
    
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
// 5A. NAVIGASI FITUR PERINGKAT & SERAGAM
//     Disuntikkan terpusat agar seluruh halaman lama mendapat menu baru.
// ==========================================
function injectFeatureNavigation() {
    const current = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const desktopNav = document.querySelector('#sidebar nav');
    const panduanLink = desktopNav?.querySelector('a[href="panduan.html"]');
    const statistikLink = desktopNav?.querySelector('a[href="statistik.html"]');
    const links = [
        { href: 'laporan.html', icon: 'fa-file-lines', label: 'Laporan Periode', mobileLabel: 'Laporan' },
        { href: 'peringkat.html', icon: 'fa-ranking-star', label: 'Peringkat & Reward', mobileLabel: 'Ranking' },
        { href: 'seragam.html', icon: 'fa-shirt', label: 'Kontrol Seragam', mobileLabel: 'Seragam', adminOnly: true }
    ];

    if (desktopNav && panduanLink) {
        links.forEach(item => {
            if (desktopNav.querySelector(`a[href="${item.href}"]`)) return;
            const active = current === item.href;
            const anchor = document.createElement('a');
            anchor.href = item.href;
            anchor.className = `nav-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors text-left ${active ? 'bg-indigo-50 dark:bg-indigo-500/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}${item.adminOnly ? ' admin-only' : ''}`;
            anchor.innerHTML = `<i class="fa-solid ${item.icon} w-6 text-center nav-icon"></i><span class="sidebar-text">${item.label}</span>`;
            desktopNav.insertBefore(anchor, item.href === 'laporan.html' && statistikLink ? statistikLink : panduanLink);
        });
    }

    const mobileNav = document.querySelector('.mobile-bottom-nav');
    const mobilePanduan = mobileNav?.querySelector('a[href="panduan.html"]');
    const mobileStatistik = mobileNav?.querySelector('a[href="statistik.html"]');
    if (mobileNav && mobilePanduan) {
        links.forEach(item => {
            if (mobileNav.querySelector(`a[href="${item.href}"]`)) return;
            const anchor = document.createElement('a');
            anchor.href = item.href;
            anchor.className = `mobile-nav-item${current === item.href ? ' active' : ''}${item.adminOnly ? ' admin-only' : ''}`;
            anchor.innerHTML = `<i class="fa-solid ${item.icon}"></i><span>${item.mobileLabel || item.label}</span>`;
            mobileNav.insertBefore(anchor, item.href === 'laporan.html' && mobileStatistik ? mobileStatistik : mobilePanduan);
        });
    }
}

// ==========================================
// 5B. AKSES UI BERDASARKAN ROLE
// ==========================================
async function applyAccessUi() {
    const akses = await getAksesUser();
    document.documentElement.dataset.userRole = akses.role;

    if (akses.role === 'blocked') {
        supabaseLogout();
        showToast("Akun belum diberi akses. Hubungi admin sistem.", "error");
        setTimeout(() => window.location.replace('login.html'), 900);
        return;
    }

    if (akses.role === 'koordinator') {
        document.querySelectorAll('a[href="master.html"], a[href="seragam.html"], button[onclick*="backupEverything"]')
            .forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));

        const lokasiInput = document.getElementById('inputLokasi');
        if (lokasiInput && akses.lokasi) {
            if (!Array.from(lokasiInput.options).some(option => option.value === akses.lokasi)) {
                const option = document.createElement('option');
                option.value = akses.lokasi;
                option.textContent = akses.lokasi;
                lokasiInput.appendChild(option);
            }
            lokasiInput.value = akses.lokasi;
            lokasiInput.disabled = true;
            const lokasiCustom = document.getElementById('inputLokasiCustom');
            if (lokasiCustom) lokasiCustom.classList.add('hidden');
            if (typeof simpanDraft === 'function') simpanDraft();
        }

        if (window.location.pathname.endsWith('/master.html')) {
            showToast("Master Data hanya dapat dikelola admin.", "error");
            setTimeout(() => window.location.replace('index.html'), 700);
        }
        if (window.location.pathname.endsWith('/seragam.html')) {
            showToast("Kontrol Seragam hanya dapat dikelola admin.", "error");
            setTimeout(() => window.location.replace('peringkat.html'), 700);
        }
    }

    // Transaksi stok yang dijadwalkan harus diproses saat admin membuka menu
    // mana pun, bukan hanya ketika halaman Kontrol Seragam dibuka.
    if (akses.role === 'admin' && typeof callSupabaseRpc === 'function') {
        callSupabaseRpc('proses_mutasi_stok_terjadwal', {}).catch(error => {
            console.warn('Proses stok terjadwal belum dapat dijalankan:', error);
        });
    }
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
    injectFeatureNavigation();
    applyAccessUi();

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
    event?.stopPropagation();
    RelawanTable.openColumnFilter({
        event,
        columnKey,
        rows: riwayatData,
        selected: activeExcelFilters[columnKey] || [],
        placeholder: 'Cari nama/data...',
        onApply: (selected, key) => {
            activeExcelFilters[key] = selected;
            jalankanFilterDanSortRiwayat();
        },
        onSort: (key, direction) => sortDataKolom(key, direction),
        onReset: key => resetFilterKolom(key)
    });
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
// 10. FITUR 1-KLIK BACKUP DATA (JSON)
// ==========================================
async function backupEverything() {
    let loading = showToast("Menyiapkan file backup, mohon tunggu...", "loading");

    try {
        const [masterRes, logRes, seragamRes, stokRes, riwayatSeragamRes, stokItemRes, mutasiStokRes, historisRes, koreksiRes] = await Promise.all([
            supabaseFetchAll('master_relawan?select=*&order=nip.asc'),
            supabaseFetchAll(await terapkanFilterLokasi('log_absensi?select=*&order=id.asc')),
            supabaseFetchAll('seragam_penerima?select=*&order=nip.asc'),
            supabaseFetchAll('stok_seragam?select=*&order=ukuran.asc'),
            supabaseFetchAll('seragam_riwayat?select=*&order=id.asc'),
            supabaseFetchAll('stok_item_seragam?select=*&order=jenis.asc,ukuran.asc'),
            supabaseFetchAll('mutasi_stok_seragam?select=*&order=id.asc'),
            supabaseFetchAll('kehadiran_historis?select=*&order=id.asc'),
            supabaseFetchAll('koreksi_kehadiran_batch?select=*&order=id.asc')
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
                log_absensi: logRes.data,
                seragam_penerima: seragamRes.status === 'success' ? seragamRes.data : [],
                stok_seragam: stokRes.status === 'success' ? stokRes.data : [],
                seragam_riwayat: riwayatSeragamRes.status === 'success' ? riwayatSeragamRes.data : [],
                stok_item_seragam: stokItemRes.status === 'success' ? stokItemRes.data : [],
                mutasi_stok_seragam: mutasiStokRes.status === 'success' ? mutasiStokRes.data : [],
                kehadiran_historis: historisRes.status === 'success' ? historisRes.data : [],
                koreksi_kehadiran_batch: koreksiRes.status === 'success' ? koreksiRes.data : []
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

function escapeAttribute(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ==========================================
// 13. UTILITAS NORMALISASI & KEMIRIPAN NAMA (SHARED)
//     Dipakai bersama halaman Statistik (Export Rekap) dll.
//     Implementasi disalin dari js/input.js agar tidak tergantung
//     pada script input yang hanya dimuat di halaman Input.
// ==========================================

function normalizeNama(s) {
    return String(s || '')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function bersihkanTitel(s) {
    let t = String(s || '').trim();
    const titel = ['BAPAK', 'PAK', 'IBU', 'BU', 'SDR', 'SDRI', 'SAUDARA', 'SAUDARI', 'H.', 'HJ.', 'A.N.'];
    for (const k of titel) {
        if (t.startsWith(k + ' ')) {
            t = t.slice(k.length).trim();
        }
    }
    return t;
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    if (Math.abs(m - n) > 6) return Math.max(m, n);
    const dp = [];
    for (let i = 0; i <= m; i++) dp.push([i]);
    for (let j = 1; j <= n; j++) dp[0].push(j);
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}

function similarityRasio(a, b) {
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
}

// ==========================================
// 13b. PENCOCOKAN NAMA ANTI-SALAH "RELAWAN BARU"
//      Personel yang sudah ada di Master kerap tertulis di lapangan dengan
//      gelar/titel, singkatan berkelip, atau tergabung bersama jabatan/asal
//      (mis. "MATSARI S.Pd", "PAK MATSARI", "MATSARI PJ PUSAT"). Helper ini
//      menyiapkan bentuk kanonik untuk dicocokkan tanpa menyentuh normalizeNama
//      yang dipakai halaman lain.
// ==========================================

// Titel kekerabatan/sapaan yang tidak pernah menjadi bagian identitas.
const TITEL_NON_NAMA = new Set([
    'BAPAK', 'PAK', 'IBU', 'BU', 'SDR', 'SDRI', 'SAUDARA', 'SAUDARI',
    'H', 'HJ', 'NY', 'NYI', 'MAS', 'MBH', 'KH', 'UST', 'USTADZ', 'USTADZAH'
]);

// Gelar/akademik beserta pecahan huruf dari bentuk bertitik (S.Pd.I -> S PD I).
const GELAR_NON_NAMA = new Set([
    'DR', 'DRS', 'DRA', 'IR', 'PROF',
    'SE', 'SH', 'ST', 'SP', 'SS', 'SI', 'PD', 'SPD', 'SPDI', 'SHI', 'SIKOM', 'SKOM',
    'SKED', 'SKEP', 'SIP', 'SFARM', 'SAKT', 'SPI', 'SAG', 'SPSI', 'SSOS', 'SKOM',
    'MM', 'MP', 'MSI', 'MPD', 'MA', 'MT', 'MH', 'MKM', 'MARS', 'MBA', 'MSC',
    'MENG', 'MENG', 'MKOM', 'MSOS', 'MAG', 'MHK', 'MKN', 'MPDI',
    'AK', 'AMD', 'AMK', 'AMd'
]);

/**
 * Bentuk kanonik nama untuk pencocokan: huruf besar, tanpa tanda baca,
 * tanpa titel/gelar maupun inisial satu huruf. Contoh:
 *   "MATSARI, S.Pd.I" -> "MATSARI"
 *   "PAK MATSARI"     -> "MATSARI"
 *   "A. Gunawan"      -> "GUNAWAN"
 */
function normalisasiNamaCocok(s) {
    const dasar = String(s || '')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!dasar) return '';
    const token = dasar.split(' ').filter(t => {
        if (!t) return false;
        if (t.length === 1) return false;              // inisial
        if (TITEL_NON_NAMA.has(t)) return false;
        if (GELAR_NON_NAMA.has(t)) return false;
        return true;
    });
    // Bila seluruh token tersaring (mis. nama hanya inisial), kembalikan dasar.
    return token.length ? token.join(' ') : dasar;
}

/** Token nama kanonik sebagai array. */
function tokenNama(s) {
    const kanon = normalisasiNamaCocok(s);
    return kanon ? kanon.split(' ') : [];
}

/**
 * Skor kemiripan 0..1 antara dua nama mentah.
 * Menggabungkan rasio Levenshtein, kemiripan himpunan token (jaccard),
 * dan deteksi "salah satu nama utuh terkandung di nama lain" supaya variasi
 * urutan kata atau kata jabatan yang ikut terparsing tidak menurunkan status.
 */
function skorKemiripanNama(a, b) {
    const ka = normalisasiNamaCocok(a);
    const kb = normalisasiNamaCocok(b);
    if (!ka || !kb) return 0;
    if (ka === kb) return 1;

    const lev = similarityRasio(ka, kb);

    const ta = ka.split(' ');
    const tb = kb.split(' ');
    const setA = new Set(ta);
    const setB = new Set(tb);
    let irisan = 0;
    setA.forEach(t => { if (setB.has(t)) irisan += 1; });
    const gabungan = new Set([...setA, ...setB]).size;
    const jaccard = gabungan ? irisan / gabungan : 0;

    // Salah satu himpunan token terkandung penuh di himpunan lainnya.
    const aDidalamB = ta.every(t => setB.has(t));
    const bDidalamA = tb.every(t => setA.has(t));
    let terkandung = 0;
    if ((aDidalamB || bDidalamA) && Math.min(setA.size, setB.size) >= 1) {
        terkandung = 0.9;
    }

    return Math.max(lev, jaccard, terkandung);
}
