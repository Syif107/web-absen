// ==========================================
// KONFIGURASI DATABASE SUPABASE (V4 - FASE 0)
// ==========================================

const SUPABASE_URL = "https://tyqgudaesaiygpsxzdiv.supabase.co";

// ⚠️ AMBIL DARI DASBOR SUPABASE: Settings > API Keys (anon public)
const SUPABASE_ANON_KEY = "sb_publishable_jwfUHJyloK5J3pnNKoco2w_xCG6reke"; 

// Nama kunci penyimpanan sesi (jangan diubah tanpa menyesuaikan seluruh halaman)
const RELAWAN_TOKEN_KEY = 'relawan_token';

// Token hanya bertahan selama tab/sesi browser aktif. Token lama yang pernah
// tersimpan permanen dipindahkan sekali lalu dihapus dari localStorage.
function bacaTokenRelawan() {
    let token = sessionStorage.getItem(RELAWAN_TOKEN_KEY);
    if (!token) {
        token = localStorage.getItem(RELAWAN_TOKEN_KEY);
        if (token) sessionStorage.setItem(RELAWAN_TOKEN_KEY, token);
        localStorage.removeItem(RELAWAN_TOKEN_KEY);
    }
    return token || null;
}

function simpanTokenRelawan(token) {
    sessionStorage.setItem(RELAWAN_TOKEN_KEY, token);
    localStorage.removeItem(RELAWAN_TOKEN_KEY);
}

function hapusTokenRelawan() {
    sessionStorage.removeItem(RELAWAN_TOKEN_KEY);
    localStorage.removeItem(RELAWAN_TOKEN_KEY);
}

// ==========================================
// AUTH HELPER (Login / Logout / Info User)
// ==========================================

/**
 * Login admin/koordinator ke Supabase Auth (email + password).
 * Mengembalikan objek respons berisi access_token, dst.
 * Melempar Error bila kredensial salah.
 */
async function supabaseLogin(email, password) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password })
    });
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error_description || data.error || "Login Gagal");
    }

    simpanTokenRelawan(data.access_token);
    return data;
}

/** Keluar: hapus token dari penyimpanan lokal. */
function supabaseLogout() {
    hapusTokenRelawan();
}

/** Mengambil info user dari token aktif (payload JWT). Null bila tidak ada/tidak valid. */
function getCurrentSessionUser() {
    const token = bacaTokenRelawan();
    if (!token) return null;
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

/** Cek apakah pengguna masih login dan token belum kedaluwarsa. */
function isSessionAlive() {
    const payload = getCurrentSessionUser();
    if (!payload) return false;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
}

/** Akses token aktif. Null bila belum login. */
function getAccessToken() {
    return bacaTokenRelawan();
} 

/**
 * Fungsi serbaguna (Helper) untuk mengambil, menambah, mengubah, atau menghapus data di Supabase.
 * Tidak perlu lagi membuat fetch berulang-ulang di setiap halaman HTML.
 */
async function supabaseFetch(endpoint, method = 'GET', data = null) {
    // PENTING: pakai token user yang benar-benar login (hasil Auth), bukan anon key.
    // Kalau tidak ada token (belum login), fallback ke anon key -- tapi karena RLS
    // sudah dibatasi ke role 'authenticated', request tanpa token user akan ditolak/kosong.
    const userToken = bacaTokenRelawan();

    const headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${userToken || SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation" // Meminta Supabase mengembalikan data yang baru saja di-insert/update
    };

    const options = {
        method: method,
        headers: headers
    };

    // Jika ada data yang mau dikirim (Insert/Update)
    if (data && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
        options.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, options);

        // Token sudah expired/invalid -> paksa login ulang, jangan biarkan halaman
        // diam-diam menampilkan data kosong seolah semuanya baik-baik saja.
        if (response.status === 401) {
            hapusTokenRelawan();
            if (!window.location.pathname.includes('login.html')) {
                window.location.replace('login.html');
            }
            return { status: "error", message: "Sesi login sudah berakhir, silakan login ulang." };
        }

        // Supabase mengembalikan status 204 (No Content) jika kita menghapus data dengan sukses
        if (response.status === 204) return { status: "success", data: [] };
        
        const result = await response.json();
        
        // Tangkap jika ada error dari database
        if (!response.ok) {
            return {
                status: "error",
                httpStatus: response.status,
                message: result.message || result.error || "Gagal menghubungi database",
                details: result.details || result.hint || null
            };
        }
        
        return { status: "success", data: result };
    } catch (error) {
        console.error("Supabase Error:", error);
        return { status: "error", message: error.toString() };
    }
}

/**
 * Memanggil fungsi RPC (server-side) di Supabase.
 * Contoh: callSupabaseRpc('insert_absensi_batch', { p_logs: [...] })
 */
async function callSupabaseRpc(namaFungsi, params = {}) {
    const result = await supabaseFetch(`rpc/${namaFungsi}`, 'POST', params || {});
    if (result.status === "success") {
        const code = result.data && typeof result.data === 'object'
            ? result.data                // fungsi mengembalikan JSON object
            : { ok: true, result: result.data };
        return Object.assign({ status: 'success', raw: result.data }, code);
    }
    return result;
}

// ==============================================
// FASE 5: INTEGRITAS TRANSAKSI
// ----------------------------------------------
// Tetap false selama db/fase5_integritas_transaksi.sql belum dijalankan.
// Dalam mode false, aplikasi memakai kontrak database lama agar frontend
// tetap dapat dipakai, tetapi simpan relawan baru + absensi dan import CSV
// belum atomik.
// ==============================================
const FASE5_ENABLED = true;

// Fase 14 menyatukan sumber laporan, kalender, ranking, dan seragam ke data
// operasional kanonik tanpa menghapus arsip mentah.
const FASE14_ENABLED = true;

// ==============================================
// FASE 4: MULTI-USER (ADMIN + KOORDINATOR)
// ----------------------------------------------
// DIHIDDEN / NONAKTIF secara default.
// Aktifkan HANYA setelah menjalankan db/fase4_multi_user.sql
// dan mengubah konstanta di bawah menjadi true.
// ==============================================
const FASE4_ENABLED = true;

let _aksesUserCache = null;

/**
 * Peran & lokasi akun yang sedang login.
 * Saat FASE4 nonaktif => selalu admin (perilaku lama, tanpa perubahan).
 * Saat aktif, koordinator hanya menyentuh lokasi_proyek miliknya.
 * Akun tanpa profil atau kegagalan membaca profil selalu diblokir (fail closed).
 */
async function getAksesUser() {
    if (!FASE4_ENABLED) return { role: 'admin', lokasi: null };
    if (_aksesUserCache) return _aksesUserCache;

    const payload = getCurrentSessionUser();
    if (!payload || !payload.sub) {
        _aksesUserCache = { role: 'blocked', lokasi: null };
        return _aksesUserCache;
    }

    try {
        const res = await supabaseFetch(`profil?select=role,lokasi_proyek&id=eq.${payload.sub}&limit=1`, 'GET');
        if (res.status === 'success' && Array.isArray(res.data) && res.data.length) {
            _aksesUserCache = {
                role: ['admin', 'koordinator'].includes(res.data[0].role) ? res.data[0].role : 'blocked',
                lokasi: (res.data[0].lokasi_proyek || '').trim()
            };
        } else {
            _aksesUserCache = { role: 'blocked', lokasi: null };
        }
    } catch (e) {
        _aksesUserCache = { role: 'blocked', lokasi: null };
    }
    return _aksesUserCache;
}

/**
 * Mengambil seluruh hasil PostgREST secara bertahap agar laporan tidak diam-diam
 * terpotong oleh batas maksimum baris Supabase. Gunakan hanya untuk endpoint
 * daftar yang memang membutuhkan keseluruhan data.
 */
async function supabaseFetchAll(endpoint, pageSize = 1000) {
    const allRows = [];
    let offset = 0;
    const separator = endpoint.includes('?') ? '&' : '?';

    for (let page = 0; page < 1000; page++) {
        const pageEndpoint = `${endpoint}${separator}limit=${pageSize}&offset=${offset}`;
        const result = await supabaseFetch(pageEndpoint, 'GET');
        if (result.status !== 'success') return result;
        if (!Array.isArray(result.data)) {
            return { status: 'error', message: 'Format respons daftar dari database tidak valid.' };
        }

        allRows.push(...result.data);
        if (result.data.length < pageSize) {
            return { status: 'success', data: allRows };
        }
        offset += pageSize;
    }

    return { status: 'error', message: 'Pengambilan data dihentikan karena melewati batas keamanan 1.000 halaman.' };
}

/** Pemeriksaan sinkron untuk render tombol sensitif setelah getAksesUser dipanggil. */
function userIsAdmin() {
    return !FASE4_ENABLED || (_aksesUserCache && _aksesUserCache.role === 'admin');
}

/**
 * Menyaring URL fetch log_absensi agar koordinator hanya membaca
 * lokasi proyeknya. Untuk admin (atau FASE4 nonaktif), URL tidak berubah.
 */
async function terapkanFilterLokasi(url) {
    const akses = await getAksesUser();
    if (akses.role !== 'koordinator' || !akses.lokasi) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}lokasi=eq.${encodeURIComponent(akses.lokasi)}`;
}
