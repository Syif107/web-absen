// ==========================================
// LOGIKA INPUT ABSENSI & SMART PARSER (AUTO-REGISTER)
// ==========================================

let stagingData = []; // Variabel untuk menyimpan data sementara sebelum dikirim

document.addEventListener("DOMContentLoaded", () => {
    // 1. Set tanggal default ke hari ini
    document.getElementById('tanggal').valueAsDate = new Date();
    
    // 2. Ambil data untuk Auto-Suggest (Dropdown Jabatan & Organisasi)
    fetchSuggestionData();
});

// Mengambil data unik dari Supabase untuk Datalist
async function fetchSuggestionData() {
    try {
        const res = await supabaseFetch('master_relawan?select=jabatan,asal_organisasi', 'GET');
        if (res.status === 'success') {
            const listJabatan = [...new Set(res.data.map(item => item.jabatan).filter(Boolean))];
            const listOrg = [...new Set(res.data.map(item => item.asal_organisasi).filter(Boolean))];
            
            document.getElementById('listBidangData').innerHTML = listJabatan.map(j => `<option value="${j}">`).join('');
            document.getElementById('listOrgData').innerHTML = listOrg.map(o => `<option value="${o}">`).join('');
        }
    } catch (error) {
        console.error("Gagal memuat auto-suggest", error);
    }
}

// ------------------------------------------
// TAHAP 1: SMART PARSER (Memecah Teks WA/Excel)
// ------------------------------------------
function generateStagingGrid() {
    const rawText = document.getElementById('daftarNama').value.trim();
    if (!rawText) {
        showToast("Teks paste tidak boleh kosong!", "error");
        return;
    }

    const defaultOrg = document.getElementById('organisasi').value.trim();
    const lines = rawText.split('\n');
    stagingData = [];

    lines.forEach(line => {
        if (!line.trim()) return; // Abaikan baris kosong

        // Hapus penomoran di awal otomatis (contoh: "1. Budi", "1) Budi", atau "- Budi")
        let cleanLine = line.replace(/^\d+[\.\)]\s*/, '').replace(/^-\s*/, '').trim();

        // Pisahkan berdasarkan Tab (dari Excel), koma, strip, atau garis miring
        let parts = [];
        if (cleanLine.includes('\t')) {
            parts = cleanLine.split('\t');
        } else if (cleanLine.includes(',')) {
            parts = cleanLine.split(',');
        } else if (cleanLine.includes('-')) {
            parts = cleanLine.split('-');
        } else if (cleanLine.includes('/')) {
            parts = cleanLine.split('/');
        } else {
            parts = [cleanLine]; // Jika hanya nama saja
        }

// Ambil bagian-bagiannya dan ubah otomatis jadi Huruf Kapital (Uppercase)
        const nama = parts[0] ? parts[0].trim().toUpperCase() : '';
        const keahlian = parts[1] ? parts[1].trim().toUpperCase() : 'RELAWAN UMUM';
        const organisasi = parts[2] ? parts[2].trim().toUpperCase() : (defaultOrg ? defaultOrg.toUpperCase() : '-');
        
        if (nama) {
            stagingData.push({ nama, keahlian, organisasi });
        }
    });

    renderStagingTable();
    
    // Sembunyikan area Paste, tampilkan area Review Tabel
    document.getElementById('step-paste').classList.add('hidden');
    document.getElementById('step-review').classList.remove('hidden');
}

// ------------------------------------------
// TAHAP 2: RENDER TABEL PREVIEW
// ------------------------------------------
function renderStagingTable() {
    const tbody = document.getElementById('stagingBody');
    let html = '';

    stagingData.forEach((row, index) => {
        html += `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="px-3 py-2 text-center text-slate-500 font-semibold border-b border-slate-100">${index + 1}</td>
                <td class="px-3 py-2 border-b border-slate-100"><input type="text" id="stage_nama_${index}" value="${row.nama}" class="w-full bg-transparent focus:bg-white border-b border-transparent focus:border-primary outline-none px-1 py-1 rounded"></td>
                <td class="px-3 py-2 border-b border-slate-100"><input type="text" id="stage_ahli_${index}" list="listBidangData" value="${row.keahlian}" class="w-full bg-transparent focus:bg-white border-b border-transparent focus:border-primary outline-none px-1 py-1 rounded"></td>
                <td class="px-3 py-2 border-b border-slate-100"><input type="text" id="stage_org_${index}" list="listOrgData" value="${row.organisasi}" class="w-full bg-transparent focus:bg-white border-b border-transparent focus:border-primary outline-none px-1 py-1 rounded"></td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

function cancelStaging() {
    document.getElementById('step-review').classList.add('hidden');
    document.getElementById('step-paste').classList.remove('hidden');
}

// ------------------------------------------
// TAHAP 3: BULK INSERT KE SUPABASE (DENGAN AUTO-REGISTER)
// ------------------------------------------
async function submitDataToServer() {
    const tanggal = document.getElementById('tanggal').value;
    const sesi = document.getElementById('sesi').value;
    const lokasi = document.getElementById('lokasi').value;

    if (!tanggal) {
        showToast("Tanggal wajib diisi!", "error");
        return;
    }

    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    overlay.classList.remove('hidden');
    loadingText.innerText = "Menganalisis Data Relawan...";

    const finalLogData = [];
    const candidatesMaster = [];

    // 1. Ekstrak data dari tabel preview
    stagingData.forEach((_, index) => {
        const nama = document.getElementById(`stage_nama_${index}`).value.trim().toUpperCase();
        const jabatan = document.getElementById(`stage_ahli_${index}`).value.trim().toUpperCase();
        const organisasi = document.getElementById(`stage_org_${index}`).value.trim().toUpperCase();
        
        if (nama) {
            // NIP Cerdas: Gabungan Nama dan Organisasi (Hanya huruf dan angka)
            const nipRaw = (nama + organisasi).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            const nip = "REL-" + nipRaw;

            
            finalLogData.push({
                tanggal: tanggal,
                sesi: sesi,
                lokasi: lokasi,
                nip: nip,
                nama: nama,
                bidang: jabatan,
                organisasi: organisasi
            });

            candidatesMaster.push({
                nip: nip,
                nama: nama,
                jabatan: jabatan,
                asal_organisasi: organisasi
            });
        }
    });

    if (finalLogData.length === 0) {
        showToast("Tidak ada data valid untuk dikirim.", "error");
        overlay.classList.add('hidden');
        return;
    }

    try {
        // 2. Bersihkan duplikat di dalam satu kali paste (jika ada nama ganda diinput bersamaan)
        const uniqueMaster = [];
        const seenNip = new Set();
        for (const item of candidatesMaster) {
            if (!seenNip.has(item.nip)) {
                seenNip.add(item.nip);
                uniqueMaster.push(item);
            }
        }

        // 3. Tarik daftar NIP yang sudah ada di Master Database
        loadingText.innerText = "Mengecek Database Master...";
        const resExisting = await supabaseFetch('master_relawan?select=nip', 'GET');
        let newMasterData = uniqueMaster; 
        
        if (resExisting.status === 'success') {
            const existingNips = new Set(resExisting.data.map(r => r.nip));
            // Saring: Hanya ambil relawan yang NIP-nya belum terdaftar sama sekali
            newMasterData = uniqueMaster.filter(m => !existingNips.has(m.nip));
        }

        // 4. Daftarkan Relawan Baru ke Master (Jika ada yang baru)
        if (newMasterData.length > 0) {
            loadingText.innerText = `Mendaftarkan ${newMasterData.length} Relawan Baru...`;
            await supabaseFetch('master_relawan', 'POST', newMasterData);
        }

        // 5. Simpan semua riwayat absen ke tabel log_absensi
        loadingText.innerText = "Menyimpan Riwayat Absen...";
        const resLog = await supabaseFetch('log_absensi', 'POST', finalLogData);
        
        if (resLog.status === 'error') throw new Error("Gagal menyimpan data log.");

        // Jika semua sukses
        showToast(`${finalLogData.length} data absen berhasil disimpan!`, "success");
        
        // Reset form
        document.getElementById('daftarNama').value = '';
        cancelStaging();
        fetchSuggestionData(); // Segarkan dropdown (barangkali ada jabatan/organisasi baru)

    } catch (error) {
        console.error(error);
        showToast("Gagal memproses data ke server!", "error");
    } finally {
        overlay.classList.add('hidden');
    }
}