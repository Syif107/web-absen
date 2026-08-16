// ==========================================
// LOGIKA SMART PARSER & BULK INPUT ABSENSI
// ==========================================

let masterDataCache = [];

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('inputTanggal').valueAsDate = new Date();
    loadMasterDataUntukStaging();
});

// Tarik Data Master ke Memori untuk Auto-Fill & Suggestion List
async function loadMasterDataUntukStaging() {
    try {
        const res = await supabaseFetch('master_relawan?select=nip,nama,jabatan,asal_organisasi', 'GET');
        if (res.status === "success") {
            masterDataCache = res.data;
            populateDatalists(); // Panggil fungsi pembuat dropdown
        } else {
            showToast("Gagal memuat data master.", "error");
        }
    } catch (err) {
        showToast("Terjadi kesalahan jaringan.", "error");
    }
}

// Mengekstrak daftar unik Bidang & Organisasi untuk disuntik ke elemen <datalist>
function populateDatalists() {
    const orgSet = new Set();
    const bidangSet = new Set();
    
    masterDataCache.forEach(r => {
        if (r.asal_organisasi && r.asal_organisasi !== '-') orgSet.add(r.asal_organisasi);
        if (r.jabatan && r.jabatan !== '-') bidangSet.add(r.jabatan);
    });
    
    let orgHtml = '';
    Array.from(orgSet).sort().forEach(org => orgHtml += `<option value="${org}">`);
    document.getElementById('listOrgData').innerHTML = orgHtml;
    
    let bidangHtml = '';
    Array.from(bidangSet).sort().forEach(b => bidangHtml += `<option value="${b}">`);
    document.getElementById('listBidangData').innerHTML = bidangHtml;
}

// ------------------------------------------
// ZONA SMART PARSER & STAGING REVIEW
// ------------------------------------------

function generateStagingGrid() {
    const globalOrg = document.getElementById('inputOrgDefault').value;
    const rawText = document.getElementById('daftarNama').value;
    const lines = rawText.split('\n').filter(n => n.trim() !== ""); 
    
    if(lines.length === 0) { 
        showToast("Teks data masih kosong!", "error"); 
        return; 
    }
    
    const tbody = document.getElementById('stagingBody'); 
    let htmlBuffer = '';
    
    lines.forEach((line, idx) => {
        let nama = ""; let bidang = ""; let org = globalOrg;
        
        let cleanLine = line.replace(/^(\d+[\.\-\)]\s*|[\-\*]\s*)/, '').trim();
        
        if (cleanLine.includes('\t')) {
            const cols = cleanLine.split('\t').map(c => c.trim()).filter(c=>c);
            nama = cols[0] || ""; bidang = cols[1] || ""; org = cols[2] || globalOrg;
        } 
        else if (/\s{2,}/.test(cleanLine)) {
            const cols = cleanLine.split(/\s{2,}/).map(c => c.trim()).filter(c=>c);
            nama = cols[0] || ""; bidang = cols[1] || ""; org = cols[2] || globalOrg;
        } 
        else if (/[-,\/;\|]/.test(cleanLine)) {
            const cols = cleanLine.split(/[-,\/;\|]/).map(c => c.trim()).filter(c=>c);
            nama = cols[0] || ""; bidang = cols[1] || ""; org = cols[2] || globalOrg;
        } 
        else {
            nama = cleanLine;
        }
        
        nama = nama.toUpperCase();
        
        // Cek nama di Master Data
        const found = masterDataCache.find(r => r.nama === nama);
        // Jika tidak ketemu (orang baru), buatkan NIP sementara dengan 4 angka acak
        const matchedNip = found ? found.nip : `REL-${nama.replace(/\s+/g, '').substring(0,10)}${Math.floor(1000 + Math.random() * 9000)}`;
        
        if (!bidang) bidang = found ? (found.jabatan || 'Helper') : 'Helper';
        if (!org || org === '') org = found ? (found.asal_organisasi || 'Umum') : org;

        htmlBuffer += `
            <tr class="hover:bg-slate-50 transition-colors" data-nip="${matchedNip}" data-isnew="${found ? 'false' : 'true'}">
                <td class="px-4 py-2 text-center font-bold text-slate-400 bg-slate-50 border-r border-slate-100">${idx + 1}</td>
                <td class="px-4 py-2">
                    <input type="text" id="nama-${idx}" value="${nama}" class="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm font-bold text-primary outline-none uppercase focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">
                </td>
                <td class="px-4 py-2">
                    <input list="listBidangData" id="bidang-${idx}" value="${bidang}" placeholder="Ketik/Pilih Bidang..." class="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">
                </td>
                <td class="px-4 py-2">
                    <input list="listOrgData" id="org-${idx}" value="${org}" placeholder="Ketik/Pilih Organisasi..." class="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = htmlBuffer;
    document.getElementById('step-paste').classList.add('hidden'); 
    document.getElementById('step-review').classList.remove('hidden');
}

function cancelStaging() { 
    document.getElementById('step-review').classList.add('hidden'); 
    document.getElementById('step-paste').classList.remove('hidden'); 
}

// ------------------------------------------
// ZONA EKSEKUSI MASSAL & AUTO-INSERT MASTER
// ------------------------------------------

async function submitDataToServer() {
    const inputTanggal = document.getElementById('inputTanggal').value; 
    const globalSesi = document.getElementById('inputSesi').value;
    const globalLokasi = document.getElementById('inputLokasi').value;
    
    if(!inputTanggal) {
        showToast("Tanggal absensi tidak boleh kosong!", "error");
        return;
    }

    const tbody = document.getElementById('stagingBody');
    const rows = tbody.querySelectorAll('tr');
    
    const arrayDataAbsensi = [];
    const arrayDataMasterBaru = []; // Keranjang untuk relawan yang belum pernah terdaftar
    const namaSudahDitambahkan = new Set(); // Mencegah nama ganda tersimpan dua kali di satu formulir

    rows.forEach((tr, i) => {
        const valNama = document.getElementById(`nama-${i}`).value.trim().toUpperCase();
        if (valNama === "") return; 
        
        const nip = tr.getAttribute('data-nip');
        const isNew = tr.getAttribute('data-isnew') === 'true';
        const bidang = document.getElementById(`bidang-${i}`).value || 'Helper';
        const organisasi = document.getElementById(`org-${i}`).value || 'Umum';

        // 1. Jika ini relawan baru, masukkan ke keranjang Master Data
        if (isNew && !namaSudahDitambahkan.has(valNama)) {
            arrayDataMasterBaru.push({
                nip: nip,
                nama: valNama,
                jabatan: bidang,
                asal_organisasi: organisasi
            });
            namaSudahDitambahkan.add(valNama);
        }
        
        // 2. Masukkan ke keranjang Absensi
        arrayDataAbsensi.push({
            tanggal: inputTanggal, 
            sesi: globalSesi,
            lokasi: globalLokasi,
            nip: nip, 
            nama: valNama,
            bidang: bidang,
            organisasi: organisasi
        });
    });

    if(arrayDataAbsensi.length === 0) { 
        showToast("Tidak ada data valid yang bisa dikirim.", "error"); 
        return; 
    }

    const btn = document.getElementById('btnSubmitFinal'); 
    const teksAsli = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyinkronkan...`; 
    btn.disabled = true;

    try {
        // TAHAP 1: Simpan relawan baru ke tabel master_relawan (Jika ada)
        if (arrayDataMasterBaru.length > 0) {
            await supabaseFetch('master_relawan', 'POST', arrayDataMasterBaru);
        }

        // TAHAP 2: Simpan semua riwayat ke tabel log_absensi
        const res = await supabaseFetch('log_absensi', 'POST', arrayDataAbsensi);
        
        if (res.status === "success" || res.status === 204 || res.status === 201) {
            let pesanBerhasil = `${arrayDataAbsensi.length} data absensi berhasil dicatat!`;
            if (arrayDataMasterBaru.length > 0) {
                pesanBerhasil += ` (${arrayDataMasterBaru.length} Relawan baru otomatis ditambahkan ke Master Data).`;
            }
            showToast(pesanBerhasil, "success");
            
            document.getElementById('daftarNama').value = ""; 
            cancelStaging();
            
            // Tarik ulang data master agar nama-nama baru tadi masuk ke autocomplete pencarian berikutnya
            loadMasterDataUntukStaging();
        } else {
            showToast("Gagal menyimpan data absensi.", "error");
        }
    } catch (err) {
        showToast("Terjadi kesalahan jaringan.", "error");
    } finally {
        btn.innerHTML = teksAsli;
        btn.disabled = false;
    }
}