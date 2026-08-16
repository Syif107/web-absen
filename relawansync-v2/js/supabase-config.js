// ==========================================
// KONFIGURASI DATABASE SUPABASE (V2)
// ==========================================

const SUPABASE_URL = "https://tyqgudaesaiygpsxzdiv.supabase.co";

// ⚠️ AMBIL DARI DASBOR SUPABASE: Settings > API Keys (anon public)
const SUPABASE_ANON_KEY = "sb_publishable_jwfUHJyloK5J3pnNKoco2w_xCG6reke"; 

/**
 * Fungsi serbaguna (Helper) untuk mengambil, menambah, mengubah, atau menghapus data di Supabase.
 * Tidak perlu lagi membuat fetch berulang-ulang di setiap halaman HTML.
 */
async function supabaseFetch(endpoint, method = 'GET', data = null) {
    const headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
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