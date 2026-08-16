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