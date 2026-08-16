// ==========================================
// LOGIKA MASTER DATA & MERGE ENGINE
// ==========================================

let masterData = [];

document.addEventListener("DOMContentLoaded", () => {
    loadMasterData();
});

// 1. Tarik Data Master
async function loadMasterData() {
    try {
        const res = await supabaseFetch('master_relawan?select=*&order=nama.asc', 'GET');
        if (res.status === "success") {
            masterData = res.data;
            document.getElementById('totalMasterInfo').innerText = `Total: ${masterData.length} Relawan`;
            renderTabelMaster(masterData);
            siapkanDropdownMerge(); // Siapkan pilihan untuk dropdown modal
        } else {
            showToast("Gagal mengambil data master.", "error");
        }
    } catch (err) {
        showToast("Terjadi kesalahan jaringan.", "error");
    }
}

// 2. Render Tabel Data
function renderTabelMaster(data) {
    const tbody = document.getElementById('tabelMasterBody');
    let html = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center p-8 text-slate-400 font-medium">Data tidak ditemukan.</td></tr>';
        return;
    }

    data.forEach(r => {
        html += `
            <tr class="hover:bg-indigo-50/50 transition-colors">
                <td class="px-5 py-3 font-mono text-xs text-slate-500">${r.nip}</td>
                <td class="px-5 py-3 font-bold text-slate-800">${r.nama}</td>
                <td class="px-5 py-3 text-slate-600">${r.jabatan}</td>
                <td class="px-5 py-3 text-slate-600">${r.asal_organisasi}</td>
                <td class="px-5 py-3 text-center">
                    <button onclick="bukaModalMerge('${r.nip}', '${r.nama}')" class="bg-amber-100 text-amber-700 hover:bg-amber-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors border border-amber-200">
                        <i class="fa-solid fa-code-merge mr-1"></i> Gabung Typo
                    </button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

// 3. Fitur Pencarian Real-Time
function filterTabelMaster() {
    const keyword = document.getElementById('cariData').value.toLowerCase();
    const dataTerfilter = masterData.filter(r => 
        r.nama.toLowerCase().includes(keyword) || 
        r.asal_organisasi.toLowerCase().includes(keyword) ||
        r.nip.toLowerCase().includes(keyword)
    );
    renderTabelMaster(dataTerfilter);
}

// ------------------------------------------
// ZONA MERGE ENGINE (PENGGABUNGAN DATA) - SEARCHABLE
// ------------------------------------------

let currentSourceNip = "";
let currentSourceName = "";

// A. Siapkan isi daftar dropdown
function siapkanDropdownMerge() {
    const list = document.getElementById('dropdownMergeList');
    let html = '';
    
    masterData.forEach(r => {
        // Hilangkan tanda kutip tunggal dari nama agar tidak merusak fungsi onclick JS
        const namaAman = r.nama.replace(/'/g, "\\'"); 
        const orgAman = r.asal_organisasi.replace(/'/g, "\\'");
        
        html += `
            <li onclick="pilihTargetMerge('${r.nip}', '${namaAman}', '${orgAman}')" class="merge-option px-4 py-3 hover:bg-amber-50 cursor-pointer border-b border-slate-100 last:border-0 transition-colors">
                <p class="font-bold text-sm text-slate-800">${r.nama}</p>
                <p class="text-[10px] text-slate-500 font-mono mt-0.5"><i class="fa-solid fa-sitemap mr-1"></i> ${r.asal_organisasi} | ${r.nip}</p>
            </li>
        `;
    });
    list.innerHTML = html;
}

// B. Logika Menyaring (Filter) saat Mengetik
function filterDropdownMerge() {
    const input = document.getElementById('searchInputMerge');
    const filter = input.value.toLowerCase();
    const nodes = document.querySelectorAll('.merge-option');
    const btnClear = document.getElementById('clearSearchMerge');
    
    // Tampilkan tombol silang jika ada ketikan
    if (filter.length > 0) btnClear.classList.remove('hidden');
    else btnClear.classList.add('hidden');

    nodes.forEach(node => {
        if (node.innerText.toLowerCase().includes(filter)) {
            node.style.display = "block";
        } else {
            node.style.display = "none";
        }
    });
    toggleDropdownMerge(true);
}

// C. Buka/Tutup Daftar Melayang
function toggleDropdownMerge(show) {
    const list = document.getElementById('dropdownMergeList');
    if (show) list.classList.remove('hidden');
    else list.classList.add('hidden');
}

// D. Saat Admin Memilih Salah Satu Nama dari Daftar
function pilihTargetMerge(nip, nama, org) {
    document.getElementById('targetMergeNip').value = nip; // Simpan NIP di input tersembunyi
    document.getElementById('searchInputMerge').value = `${nama} — [${org}]`; // Tampilkan nama cantik di input
    document.getElementById('clearSearchMerge').classList.remove('hidden');
    toggleDropdownMerge(false);
}

function resetInputMerge() {
    document.getElementById('targetMergeNip').value = "";
    const input = document.getElementById('searchInputMerge');
    input.value = "";
    input.focus();
    filterDropdownMerge(); // Reset filter
}

// E. Kontrol Jendela Modal
function bukaModalMerge(nip, nama) {
    currentSourceNip = nip;
    currentSourceName = nama;
    
    document.getElementById('sumberNama').innerText = nama;
    document.getElementById('sumberNip').innerText = nip;
    
    resetInputMerge(); // Bersihkan input pencarian
    toggleDropdownMerge(false); // Sembunyikan daftar
    
    document.getElementById('modalMerge').classList.remove('hidden');
}

function tutupModalMerge() {
    document.getElementById('modalMerge').classList.add('hidden');
}

// Tutup dropdown jika klik di luar area
document.addEventListener('click', function(event) {
    const input = document.getElementById('searchInputMerge');
    const list = document.getElementById('dropdownMergeList');
    if (event.target !== input && !list.contains(event.target)) {
        toggleDropdownMerge(false);
    }
});

// F. Tombol Eksekusi Gabung
async function eksekusiMerge() {
    const targetNip = document.getElementById('targetMergeNip').value; // Ambil NIP dari input tersembunyi
    const btn = document.getElementById('btnEksekusiMerge');

    if (!targetNip) {
        showToast("Pilih profil tujuan terlebih dahulu!", "error");
        return;
    }
    
    if (targetNip === currentSourceNip) {
        showToast("Profil sumber dan tujuan tidak boleh sama!", "error");
        resetInputMerge();
        return;
    }

    const targetProfile = masterData.find(r => r.nip === targetNip);
    
    const konfirmasi = confirm(`🚨 PERINGATAN BENTURAN DATA 🚨\n\nApakah Anda yakin ingin memindahkan seluruh absen:\n[X] ${currentSourceName}\n\nKe profil yang benar:\n[✓] ${targetProfile.nama}\n\nProfil lama akan dihapus permanen!`);
    if (!konfirmasi) return;

    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
    btn.disabled = true;

    try {
        const updatePayload = {
            nip: targetProfile.nip,
            nama: targetProfile.nama,
            bidang: targetProfile.jabatan,
            organisasi: targetProfile.asal_organisasi
        };
        
        await supabaseFetch(`log_absensi?nip=eq.${currentSourceNip}`, 'PATCH', updatePayload);
        await supabaseFetch(`master_relawan?nip=eq.${currentSourceNip}`, 'DELETE');

        showToast("Merge Data Berhasil! Riwayat disatukan.", "success");
        tutupModalMerge();
        
        document.getElementById('cariData').value = "";
        loadMasterData(); 
        
    } catch (err) {
        showToast("Gagal melakukan Merge Data.", "error");
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Eksekusi Gabung';
        btn.disabled = false;
    }
}