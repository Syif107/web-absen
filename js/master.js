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
        rowsPerPage = 50; 
    } else {
        isNewestFilter = false;
        rowsPerPage = parseInt(val);
    }
    currentPage = 1; 
    terapkanFilterDanPaginasi();
}

// 3. Fungsi Saat Mengetik di Kolom Pencarian Global
function filterTabelMaster() {
    currentPage = 1; 
    terapkanFilterDanPaginasi();
}

// 4. Inti Mesin Penyaringan, Excel Filter, & Pengurutan Data
function terapkanFilterDanPaginasi() {
    const keyword = document.getElementById('cariData').value.toLowerCase();
    
    // Filter Pencarian Global
    filteredData = masterData.filter(r => 
        (r.nama && r.nama.toLowerCase().includes(keyword)) || 
        (r.asal_organisasi && r.asal_organisasi.toLowerCase().includes(keyword)) ||
        (r.nip && r.nip.toLowerCase().includes(keyword))
    );

    // Filter berdasarkan pop-up Excel (Checkbox kolom aktif)
    Object.keys(activeExcelFilters).forEach(col => {
        const allowedVals = activeExcelFilters[col];
        if (allowedVals && allowedVals.length > 0) {
            filteredData = filteredData.filter(item => {
                const val = (item[col] !== null && item[col] !== undefined && item[col] !== "") ? String(item[col]) : '-';
                return allowedVals.includes(val);
            });
        }
    });

    // Sorting Kolom (A-Z / Z-A) atau Default Nama
    if (activeSortColumn) {
        filteredData.sort((a, b) => {
            let valA = (a[activeSortColumn] !== null && a[activeSortColumn] !== undefined) ? String(a[activeSortColumn]).toLowerCase() : '';
            let valB = (b[activeSortColumn] !== null && b[activeSortColumn] !== undefined) ? String(b[activeSortColumn]).toLowerCase() : '';
            if (valA < valB) return activeSortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return activeSortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    } else {
        if (isNewestFilter && keyword === "") {
            filteredData = [...masterData].reverse();
        } else {
            filteredData.sort((a, b) => {
                let namaA = a.nama || '';
                let namaB = b.nama || '';
                return namaA.localeCompare(namaB);
            });
        }
    }

    renderTabelMaster(filteredData);
}

// 5. Fungsi Pindah Halaman (Next / Prev)
function ubahHalaman(arah) {
    currentPage += arah;
    renderTabelMaster(filteredData);
}

// 6. Mesin Render HTML & Kalkulasi Baris
function renderTabelMaster(data) {
    const tbody = document.getElementById('tabelMasterBody');
    const info = document.getElementById('infoPaginasi');
    const btnPrev = document.getElementById('btnPrev');
    const btnNext = document.getElementById('btnNext');

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center p-8 text-slate-400 font-medium">Data tidak ditemukan.</td></tr>';
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
        const bidangAman = r.jabatan ? r.jabatan.replace(/'/g, "\\'") : '';
        const orgAman = r.asal_organisasi ? r.asal_organisasi.replace(/'/g, "\\'") : '';
        
        html += `
            <tr class="hover:bg-indigo-50/50 transition-colors">
                <td class="px-4 py-3 text-center bg-slate-50 border-r border-slate-100">
                    <input type="checkbox" class="master-checkbox w-4 h-4 accent-primary cursor-pointer" value="${r.nip}" onchange="toggleMasterBulkAction()">
                </td>
                <td class="px-4 py-3 text-center text-slate-400 font-bold bg-slate-50 border-r border-slate-100">${noUrut}</td>
                <td class="px-5 py-3 font-mono text-xs text-slate-500">${r.nip || '-'}</td>
                <td class="px-5 py-3 font-bold text-slate-800">${r.nama || '-'}</td>
                <td class="px-5 py-3 text-slate-600 font-medium">${r.asal_organisasi || '-'}</td>
                <td class="px-5 py-3 text-slate-600"><span class="bg-slate-100 px-2 py-1 rounded-md text-xs font-bold border border-slate-200">${r.jabatan || 'Helper'}</span></td>
                <td class="px-5 py-3 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <!-- TOMBOL EDIT -->
                        <button onclick="bukaModalEdit('${r.nip}', '${namaAman}', '${bidangAman}', '${orgAman}')" class="bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors border border-blue-200 shadow-sm flex items-center gap-1" title="Edit Data">
                            <i class="fa-solid fa-pen-to-square"></i> Edit
                        </button>
                        <!-- TOMBOL TYPO/MERGE -->
                        <button onclick="bukaModalMerge('${r.nip}', '${namaAman}')" class="bg-amber-100 text-amber-700 hover:bg-amber-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors border border-amber-200 shadow-sm flex items-center gap-1" title="Merge/Typo">
                            <i class="fa-solid fa-code-merge"></i>
                        </button>
                        <!-- TOMBOL HAPUS -->
                        <button onclick="deleteSingleMaster('${r.nip}', '${namaAman}')" class="bg-red-100 text-red-700 hover:bg-red-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors border border-red-200 shadow-sm flex items-center gap-1" title="Hapus">
                            <i class="fa-solid fa-trash"></i>
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

// ==========================================
// FUNGSI KHUSUS POP-UP EXCEL FILTER MASTER (DENGAN SEARCH & SELECT/DESELECT ALL)
// ==========================================

function bukaExcelFilterMaster(columnKey, event) {
    event.stopPropagation();
    const popup = document.getElementById('excelFilterPopup');
    if (!popup) return;
    
    const rect = event.currentTarget.getBoundingClientRect();
    popup.style.top = `${rect.bottom + window.scrollY + 5}px`;
    popup.style.left = `${rect.left + window.scrollX - 180}px`;
    popup.style.width = '280px';

    // Ambil nilai unik dari seluruh masterData berdasarkan key kolom
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

        <!-- KOTAK PENCARIAN DI DALAM FILTER MASTER -->
        <div class="mb-2 relative">
            <i class="fa-solid fa-search absolute left-2.5 top-2 text-slate-400 text-[10px]"></i>
            <input type="text" id="searchPopupInput" onkeyup="filterListPopupMaster(this)" placeholder="Cari data..." class="w-full bg-slate-50 border border-slate-300 rounded-lg pl-7 pr-3 py-1.5 text-xs outline-none focus:border-primary">
        </div>

        <!-- TOMBOL PILIH SEMUA / HAPUS SEMUA MASTER -->
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

// FUNGSI PENDUKUNG PENCARIAN DI POP-UP MASTER
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

// FUNGSI PENDUKUNG PILIH/HAPUS SEMUA DI POP-UP MASTER
function toggleAllPopupCheckboxMaster(status) {
    const checkboxes = document.querySelectorAll('.excel-filter-chk-master');
    checkboxes.forEach(chk => {
        if (chk.closest('label').style.display !== 'none') {
            chk.checked = status;
        }
    });
    terapkanExcelFilterMaster();
}

function terapkanExcelFilterMaster() {
    const checkboxes = document.querySelectorAll('.excel-filter-chk-master');
    if (checkboxes.length === 0) return;
    const colKey = checkboxes[0].dataset.col;

    let selectedVals = [];
    checkboxes.forEach(chk => {
        if (chk.checked) selectedVals.push(chk.value);
    });

    activeExcelFilters[colKey] = selectedVals;
    currentPage = 1;
    terapkanFilterDanPaginasi();
}

function sortDataKolomMaster(columnKey, direction) {
    activeSortColumn = columnKey;
    activeSortDirection = direction;
    currentPage = 1;
    terapkanFilterDanPaginasi();
    const popup = document.getElementById('excelFilterPopup');
    if (popup) popup.classList.add('hidden');
}

function resetFilterKolomMaster(columnKey) {
    delete activeExcelFilters[columnKey];
    currentPage = 1;
    terapkanFilterDanPaginasi();
    const popup = document.getElementById('excelFilterPopup');
    if (popup) popup.classList.add('hidden');
}

// ------------------------------------------
// FUNGSI HAPUS MASSAL & TUNGGAL MASTER DATA
// ------------------------------------------

function toggleAllMaster(source) { 
    document.querySelectorAll('.master-checkbox').forEach(cb => cb.checked = source.checked); 
    toggleMasterBulkAction(); 
}

function toggleMasterBulkAction() {
    const count = document.querySelectorAll('.master-checkbox:checked').length; 
    const banner = document.getElementById('bulkMasterBanner');
    if (count > 0) { 
        banner.classList.remove('hidden'); 
        document.getElementById('selectedMasterCount').innerText = count; 
    } else { 
        banner.classList.add('hidden'); 
        document.getElementById('checkAllMaster').checked = false; 
    }
}

async function deleteBulkMaster() {
    const checked = document.querySelectorAll('.master-checkbox:checked');
    if (checked.length === 0) return;
    
    const konfirmasi = confirm(`⚠️ PERINGATAN HAPUS MASSAL\n\nYakin ingin menghapus ${checked.length} data master terpilih secara permanen?`);
    if (!konfirmasi) return;

    let loading = showToast(`Menghapus ${checked.length} data...`, "loading");
    
    try {
        const nips = Array.from(checked).map(cb => cb.value);
        const deletePromises = nips.map(nip => supabaseFetch(`master_relawan?nip=eq.${nip}`, 'DELETE'));
        await Promise.all(deletePromises);
        
        loading.remove();
        showToast(`${checked.length} data master berhasil dihapus!`, "success");
        
        document.getElementById('checkAllMaster').checked = false;
        toggleMasterBulkAction();
        loadMasterData(); 
    } catch (e) {
        loading.remove();
        showToast("Gagal menghapus beberapa data.", "error");
    }
}

async function deleteSingleMaster(nip, nama) {
    const konfirmasi = confirm(`⚠️ PERINGATAN HAPUS DATA\n\nApakah Anda yakin ingin menghapus personel "${nama}" (NIP: ${nip}) dari Master Data secara permanen?`);
    if (!konfirmasi) return;

    let loading = showToast("Menghapus data master...", "loading");
    try {
        const res = await supabaseFetch(`master_relawan?nip=eq.${nip}`, 'DELETE');
        loading.remove();
        
        if (res.status === "success" || res.status === 204 || res.status === 201) {
            showToast("Data master berhasil dihapus!", "success");
            loadMasterData(); 
        } else {
            throw new Error(res.message || "Gagal menghapus data");
        }
    } catch (err) {
        if (loading) loading.remove();
        showToast("Terjadi kesalahan saat menghapus data.", "error");
    }
}

// ------------------------------------------
// ZONA EDIT MASTER DATA
// ------------------------------------------

let currentEditNip = "";

function bukaModalEdit(nip, nama, bidang, org) {
    currentEditNip = nip;
    
    document.getElementById('editNip').value = nip;
    document.getElementById('editNama').value = nama;
    document.getElementById('editBidang').value = bidang;
    document.getElementById('editOrg').value = org;
    
    document.getElementById('modalEdit').classList.remove('hidden');
}

function tutupModalEdit() {
    document.getElementById('modalEdit').classList.add('hidden');
}

async function simpanEditMaster() {
    const namaBaru = document.getElementById('editNama').value.trim().toUpperCase();
    const bidangBaru = document.getElementById('editBidang').value.trim();
    const orgBaru = document.getElementById('editOrg').value.trim();
    
    if(!namaBaru) {
        showToast("Nama Relawan tidak boleh kosong!", "error");
        return;
    }

    const btn = document.getElementById('btnSimpanEdit');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    btn.disabled = true;

    const payloadUpdate = {
        nama: namaBaru,
        jabatan: bidangBaru,
        asal_organisasi: orgBaru
    };

    try {
        const res = await supabaseFetch(`master_relawan?nip=eq.${currentEditNip}`, 'PATCH', payloadUpdate);
        
        if (res.status === "success" || res.status === 204 || res.status === 201) {
            showToast("Data profil berhasil diperbarui!", "success");
            tutupModalEdit();
            loadMasterData(); 
        } else {
            throw new Error("Gagal mengupdate ke database.");
        }
    } catch (err) {
        showToast("Terjadi kesalahan saat mengupdate data.", "error");
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan';
        btn.disabled = false;
    }
}

// ------------------------------------------
// ZONA MERGE ENGINE (PENGGABUNGAN DATA)
// ------------------------------------------

let currentSourceNip = "";
let currentSourceName = "";

function siapkanDropdownMerge() {
    const list = document.getElementById('dropdownMergeList');
    if (!list) return;
    let html = '';
    
    const sortedMaster = [...masterData].sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
    
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
    if (!list) return;
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
    if (input && list && event.target !== input && !list.contains(event.target)) {
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