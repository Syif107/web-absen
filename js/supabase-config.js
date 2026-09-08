// ==========================================
// KONFIGURASI DATABASE SUPABASE (V3)
// ==========================================

const SUPABASE_URL = "https://tyqgudaesaiygpsxzdiv.supabase.co";

// ⚠️ AMBIL DARI DASBOR SUPABASE: Settings > API Keys (anon public)
const SUPABASE_ANON_KEY = "sb_publishable_jwfUHJyloK5J3pnNKoco2w_xCG6reke"; 

/**
 * Fungsi serbaguna (Helper) untuk mengambil, menambah, mengubah, atau menghapus data di Supabase.
 * Tidak perlu lagi membuat fetch berulang-ulang di setiap halaman HTML.
 */
async function supabaseFetch(endpoint, method = 'GET', data = null) {
    // PENTING: pakai token user yang benar-benar login (hasil Auth), bukan anon key.
    // Kalau tidak ada token (belum login), fallback ke anon key -- tapi karena RLS
    // sudah dibatasi ke role 'authenticated', request tanpa token user akan ditolak/kosong.
    const userToken = localStorage.getItem('relawan_token');

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
            localStorage.removeItem('relawan_token');
            if (!window.location.pathname.includes('login.html')) {
                window.location.replace('login.html');
            }
            return { status: "error", message: "Sesi login sudah berakhir, silakan login ulang." };
        }

        // Supabase mengembalikan status 204 (No Content) jika kita menghapus data dengan sukses
        if (response.status === 204) return { status: "success", data: [] };
        
        const result = await response.json();
        
        // Tangkap jika ada error dari database
        if (!response.ok) throw new Error(result.message || result.error || "Gagal menghubungi database");
        
        return { status: "success", data: result };
    } catch (error) {
        console.error("Supabase Error:", error);
        return { status: "error", message: error.toString() };
    }
}