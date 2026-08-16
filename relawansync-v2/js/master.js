// ==========================================
// LOGIKA MASTER DATA, PAGINATION, & MERGE ENGINE
// ==========================================

let masterData = [];
let filteredData = []; // Menyimpan data setelah difilter/search
let currentPage = 1;
let rowsPerPage = 50;
let isNewestFilter = false;

document.addEventListener("DOMContentLoaded", () => {
    loadMasterData();
});

// 1. Tarik Data Master Sekali di Awal
async function loadMasterData() {
    try {
        // Kita tidak memakai order=nama.asc dari database lagi,
        // karena kita ingin menyortirnya secara dinamis di Client-Side (JS)
        const res = await supabaseFetch('master_relawan?select=*', 'GET');
        if (res.status === "success") {
            masterData = res.data;
            document.getElementById('totalMasterInfo').innerText = `Total: ${masterData.length} Relawan`;
            
            terapkanFilterDanPaginasi();
            siapkanDropdownMerge(); 
        } else {
            showToast("Gagal mengambil data master.", "error");
        }
    } catch (err) {
        showToast("Terjadi kesalahan jaringan.", "error");
    }
}

// 2. Fungsi Saat Pilihan Dropdown Diubah
function gantiBatasData() {
    const val = document.getElementById('limitData').value;
    if(val === 'newest') {
        isNewestFilter = true;
        rowsPerPage = 50; // Khusus Terbaru, pangkas 50 data teratas
    } else {
        isNewestFilter = false;
        rowsPerPage = parseInt(val);
    }
    currentPage = 1; // Reset halaman ke 1 setiap kali filter ganti
    terapkanFilterDanPaginasi();
}

// 3. Fungsi Saat Mengetik di Kolom Pencarian
function filterTabelMaster() {
    currentPage = 1; // Kembali ke halaman 1 saat sedang mencari
    terapkanFilterDanPaginasi();
}

// 4. Inti Mesin Penyaringan & Pengurutan Data
function terapkanFilterDanPaginasi() {
    const keyword = document.getElementById('cariData').value.toLowerCase();
    
    // A. Saring berdasarkan kata kunci pencarian
    filteredData = masterData.filter(r => 
        (r.nama && r.nama.toLowerCase().includes(keyword)) || 
        (r.asal_organisasi && r.asal_organisasi.toLowerCase().includes(keyword)) ||
        (r.nip && r.nip.toLowerCase().includes(keyword))
    );

    // B. Logika Pengurutan (Sorting)
    if (isNewestFilter && keyword === "") {
        // Mode "Terbaru": Balik urutan array asli (data terakhir di-insert menjadi di atas)
        filteredData = [...masterData].reverse();
    } else {
        // Mode Normal: Urutkan berdasarkan Abjad Nama (A-Z)
        filteredData.sort((a, b) => a.nama.localeCompare(b.nama));
    }

    renderTabelMaster(filteredData);
}

// 5. Fungsi Pindah Halaman (Next / Prev)
function ubahHalaman(arah) {
    currentPage += arah;
    renderTabelMaster(filteredData);
}

// 6. Mesin Render HTML & Kalkulasi Baris (Dilengkapi Tombol Hapus)
function renderTabelMaster(data) {
    const tbody = document.getElementById('tabelMasterBody');
    const info = document.getElementById('infoPaginasi');
    const btnPrev = document.getElementById('btnPrev');
    const btnNext = document.getElementById('btnNext');

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center p-8 text-slate-400 font-medium">Data tidak ditemukan.</td></tr>';
        info.innerText = "Menampilkan 0 data";
        btnPrev.disabled = true;
        btnNext.disabled = true;
        return;
    }

    const totalPages = Math.ceil(data.length / rowsPerPage);
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages) currentPage = totalPages;

    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, data.length);
    const dataPaginated = data.slice(startIndex, endIndex);

    let html = '';
    dataPaginated.forEach((r, idx) => {
        const noUrut = startIndex + idx + 1;
        const namaAman = r.nama ? r.nama.replace(/'/g, "\\'") : '';
        
        html += `
            <tr class="hover:bg-indigo-50/50 transition-colors">
                <td class="px-5 py-3 text-center text-slate-400 font-bold bg-slate-50 border-r border-slate-100">${noUrut}</td>
                <td class="px-5 py-3 font-mono text-xs text-slate-500">${r.nip}</td>
                <td class="px-5 py-3 font-bold text-slate-800">${r.nama}</td>
                <td class="px-5 py-3 text-slate-600"><span class="bg-slate-100 px-2 py-1 rounded-md text-xs font-bold border border-slate-200">${r.jabatan || 'Helper'}</span></td>
                <td class="px-5 py-3 text-slate-600 font-medium">${r.asal_organisasi || '-'}</td>
                <td class="px-5 py-3 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button onclick="bukaModalMerge('${r.nip}', '${namaAman}')" class="bg-amber-100 text-amber-700 hover:bg-amber-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors border border-amber-200 shadow-sm flex items-center gap-1">
                            <i class="fa-solid fa-code-merge"></i> Typo
                        </button>
                        <button onclick="deleteSingleMaster('${r.nip}', '${namaAman}')" class="bg-red-100 text-red-700 hover:bg-red-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors border border-red-200 shadow-sm flex items-center gap-1">
                            <i class="fa-solid fa-trash"></i> Hapus
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;

    info.innerText = `Baris ${startIndex + 1}-${endIndex} dari ${data.length.toLocaleString('id-ID')} Data (Hal ${currentPage}/${totalPages})`;
    btnPrev.disabled = currentPage === 1;
    btnNext.disabled = currentPage === totalPages;
}

// 7. Fungsi Eksekusi Hapus Data Master
async function deleteSingleMaster(nip, nama) {
    const konfirmasi = confirm(`⚠️ PERINGATAN HAPUS DATA\n\nApakah Anda yakin ingin menghapus personel "${nama}" (NIP: ${nip}) dari Master Data secara permanen?`);
    if (!konfirmasi) return;

    let loading = showToast("Menghapus data master...", "loading");
    try {
        const res = await supabaseFetch(`master_relawan?nip=eq.${nip}`, 'DELETE');
        loading.remove();
        
        if (res.status === "success" || res.status === 204 || res.status === 201) {
            showToast("Data master berhasil dihapus!", "success");
            loadMasterData(); // Muat ulang tabel secara otomatis
        } else {
            throw new Error(res.message || "Gagal menghapus data");
        }
    } catch (err) {
        if (loading) loading.remove();
        showToast("Terjadi kesalahan saat menghapus data.", "error");
    }
}

// ------------------------------------------
// ZONA MERGE ENGINE (PENGGABUNGAN DATA) - SEARCHABLE
// ------------------------------------------

let currentSourceNip = "";
let currentSourceName = "";

function siapkanDropdownMerge() {
    const list = document.getElementById('dropdownMergeList');
    let html = '';
    
    // Urutkan dropdown A-Z
    const sortedMaster = [...masterData].sort((a, b) => a.nama.localeCompare(b.nama));
    
    sortedMaster.forEach(r => {
        const namaAman = r.nama ? r.nama.replace(/'/g, "\\'") : ''; 
        const orgAman = r.asal_organisasi ? r.asal_organisasi.replace(/'/g, "\\'") : 'Umum';
        
        html += `
            <li onclick="pilihTargetMerge('${r.nip}', '${namaAman}', '${orgAman}')" class="merge-option px-4 py-3 hover:bg-amber-50 cursor-pointer border-b border-slate-100 last:border-0 transition-colors">
                <p class="font-bold text-sm text-slate-800">${r.nama}</p>
                <p class="text-[10px] text-slate-500 font-mono mt-0.5"><i class="fa-solid fa-sitemap mr-1"></i> ${r.asal_organisasi || '-'} | ${r.nip}</p>
            </li>
        `;
    });
    list.innerHTML = html;
}

function filterDropdownMerge() {
    const input = document.getElementById('searchInputMerge');
    const filter = input.value.toLowerCase();
    const nodes = document.querySelectorAll('.merge-option');
    const btnClear = document.getElementById('clearSearchMerge');
    
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

function toggleDropdownMerge(show) {
    const list = document.getElementById('dropdownMergeList');
    if (show) list.classList.remove('hidden');
    else list.classList.add('hidden');
}

function pilihTargetMerge(nip, nama, org) {
    document.getElementById('targetMergeNip').value = nip; 
    document.getElementById('searchInputMerge').value = `${nama} — [${org}]`; 
    document.getElementById('clearSearchMerge').classList.remove('hidden');
    toggleDropdownMerge(false);
}

function resetInputMerge() {
    document.getElementById('targetMergeNip').value = "";
    const input = document.getElementById('searchInputMerge');
    input.value = "";
    input.focus();
    filterDropdownMerge(); 
}

function bukaModalMerge(nip, nama) {
    currentSourceNip = nip;
    currentSourceName = nama;
    
    document.getElementById('sumberNama').innerText = nama;
    document.getElementById('sumberNip').innerText = nip;
    
    resetInputMerge(); 
    toggleDropdownMerge(false); 
    
    document.getElementById('modalMerge').classList.remove('hidden');
}

function tutupModalMerge() {
    document.getElementById('modalMerge').classList.add('hidden');
}

document.addEventListener('click', function(event) {
    const input = document.getElementById('searchInputMerge');
    const list = document.getElementById('dropdownMergeList');
    if (event.target !== input && !list.contains(event.target)) {
        toggleDropdownMerge(false);
    }
});

async function eksekusiMerge() {
    const targetNip = document.getElementById('targetMergeNip').value; 
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