-- FASE 17: personel khusus, stok massal bertanggal, detail personel,
-- ekspor, dan hapus permanen berpengaman.
-- Jalankan setelah Fase 16.

BEGIN;

-- -----------------------------------------------------------------
-- A. PERSONEL KHUSUS
-- -----------------------------------------------------------------
ALTER TABLE public.master_relawan
    ADD COLUMN IF NOT EXISTS kategori_personel text NOT NULL DEFAULT 'reguler',
    ADD COLUMN IF NOT EXISTS jabatan_khusus text,
    ADD COLUMN IF NOT EXISTS alasan_khusus text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'master_relawan_kategori_personel_check'
          AND conrelid = 'public.master_relawan'::regclass
    ) THEN
        ALTER TABLE public.master_relawan
            ADD CONSTRAINT master_relawan_kategori_personel_check
            CHECK (kategori_personel IN ('reguler', 'khusus'));
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fase17_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role text;
BEGIN
    IF auth.uid() IS NULL THEN RETURN false; END IF;
    IF to_regprocedure('public.akun_role()') IS NULL THEN RETURN false; END IF;
    EXECUTE 'SELECT public.akun_role()' INTO v_role;
    RETURN coalesce(v_role, '') = 'admin';
END;
$$;

CREATE OR REPLACE FUNCTION public.simpan_personel_manual_v2(
    p_nip text DEFAULT NULL,
    p_nama text DEFAULT NULL,
    p_jabatan text DEFAULT NULL,
    p_asal_organisasi text DEFAULT NULL,
    p_asal_daerah text DEFAULT NULL,
    p_kabupaten text DEFAULT NULL,
    p_kategori_wilayah text DEFAULT 'belum_dilengkapi',
    p_zona_asal text DEFAULT NULL,
    p_ukuran_seragam text DEFAULT NULL,
    p_catatan_seragam text DEFAULT NULL,
    p_kategori_personel text DEFAULT 'reguler',
    p_jabatan_khusus text DEFAULT NULL,
    p_alasan_khusus text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_nip text;
BEGIN
    IF NOT public.fase17_admin() THEN RAISE EXCEPTION 'Hanya admin yang boleh menambah personel'; END IF;
    IF nullif(trim(p_nama), '') IS NULL THEN RAISE EXCEPTION 'Nama wajib diisi'; END IF;
    IF coalesce(p_kategori_personel, 'reguler') NOT IN ('reguler','khusus') THEN
        RAISE EXCEPTION 'Kategori personel tidak valid';
    END IF;

    v_nip := nullif(trim(p_nip), '');
    IF v_nip IS NULL THEN
        v_nip := 'REL-MANUAL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    END IF;
    IF EXISTS (SELECT 1 FROM public.master_relawan WHERE nip = v_nip) THEN
        RAISE EXCEPTION 'NIP / ID sudah digunakan';
    END IF;

    INSERT INTO public.master_relawan (
        nip, nama, jabatan, asal_organisasi, asal_daerah, kabupaten_normalisasi,
        kategori_wilayah, zona_asal, ukuran_seragam, catatan_seragam,
        kategori_personel, jabatan_khusus, alasan_khusus
    ) VALUES (
        v_nip, upper(trim(p_nama)), coalesce(nullif(trim(p_jabatan), ''), 'BELUM DIISI'),
        upper(trim(coalesce(p_asal_organisasi, 'BELUM DIISI'))),
        nullif(trim(p_asal_daerah), ''), nullif(upper(trim(p_kabupaten)), ''),
        coalesce(nullif(trim(p_kategori_wilayah), ''), 'belum_dilengkapi'),
        nullif(trim(p_zona_asal), ''), nullif(trim(p_ukuran_seragam), ''),
        nullif(trim(p_catatan_seragam), ''), coalesce(p_kategori_personel, 'reguler'),
        nullif(trim(p_jabatan_khusus), ''), nullif(trim(p_alasan_khusus), '')
    );

    RETURN jsonb_build_object('ok', true, 'nip', v_nip);
END;
$$;

-- Ringkasan Master mempertahankan semua kolom lama dan menambah identitas khusus.
CREATE OR REPLACE VIEW public.v_ringkasan_personel
WITH (security_invoker = true)
AS
WITH log_norm AS (
    SELECT l.nip, l.tanggal::date AS tanggal,
           CASE WHEN l.sesi = 'Siang' THEN 'Pagi' ELSE l.sesi END AS sesi,
           l.lokasi
    FROM public.log_absensi l
    WHERE l.nip IS NOT NULL AND trim(l.nip) <> '' AND l.tanggal IS NOT NULL
), program AS (
    SELECT count(DISTINCT tanggal)::integer AS total_hari_program,
           count(DISTINCT (tanggal, sesi))::integer AS total_sesi_program
    FROM log_norm
), per_person AS (
    SELECT nip,
           count(DISTINCT tanggal)::integer AS total_hari,
           count(DISTINCT (tanggal, sesi))::integer AS total_sesi,
           count(DISTINCT NULLIF(trim(lokasi), ''))::integer AS jumlah_proyek,
           min(tanggal) AS hadir_pertama,
           max(tanggal) AS hadir_terakhir
    FROM log_norm GROUP BY nip
), historis AS (
    SELECT nip, sum(jumlah_hari)::integer AS hari_historis
    FROM public.kehadiran_historis WHERE disetujui GROUP BY nip
)
SELECT m.nip, m.nama, m.jabatan, m.asal_organisasi, m.asal_daerah,
       m.kategori_wilayah, m.ukuran_seragam, m.catatan_seragam,
       (coalesce(p.total_hari, 0) + coalesce(h.hari_historis, 0))::integer AS total_hari,
       coalesce(p.total_sesi, 0) AS total_sesi,
       coalesce(p.jumlah_proyek, 0) AS jumlah_proyek,
       p.hadir_pertama, p.hadir_terakhir,
       CASE WHEN pr.total_hari_program = 0 THEN 0 ELSE round(100.0 * coalesce(p.total_hari, 0) / pr.total_hari_program, 1) END AS persentase_hari,
       CASE WHEN pr.total_sesi_program = 0 THEN 0 ELSE round(100.0 * coalesce(p.total_sesi, 0) / pr.total_sesi_program, 1) END AS persentase_sesi,
       m.kabupaten_normalisasi,
       coalesce(h.hari_historis, 0)::integer AS hari_historis,
       m.zona_asal,
       m.kategori_personel,
       m.jabatan_khusus,
       m.alasan_khusus
FROM public.master_relawan m
CROSS JOIN program pr
LEFT JOIN per_person p ON p.nip = m.nip
LEFT JOIN historis h ON h.nip = m.nip;

-- -----------------------------------------------------------------
-- B. MUTASI STOK BERTANGGAL DAN MASSAL
-- -----------------------------------------------------------------
ALTER TABLE public.mutasi_stok_seragam
    ADD COLUMN IF NOT EXISTS batch_id uuid,
    ADD COLUMN IF NOT EXISTS tanggal_efektif timestamptz,
    ADD COLUMN IF NOT EXISTS diterapkan_pada timestamptz,
    ADD COLUMN IF NOT EXISTS status_transaksi text;

UPDATE public.mutasi_stok_seragam
SET tanggal_efektif = coalesce(tanggal_efektif, dibuat_pada),
    diterapkan_pada = coalesce(diterapkan_pada, dibuat_pada),
    status_transaksi = coalesce(status_transaksi, 'diterapkan')
WHERE tanggal_efektif IS NULL OR diterapkan_pada IS NULL OR status_transaksi IS NULL;

ALTER TABLE public.mutasi_stok_seragam
    ALTER COLUMN tanggal_efektif SET DEFAULT now(),
    ALTER COLUMN tanggal_efektif SET NOT NULL,
    ALTER COLUMN status_transaksi SET DEFAULT 'diterapkan',
    ALTER COLUMN status_transaksi SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'mutasi_stok_status_transaksi_check'
          AND conrelid = 'public.mutasi_stok_seragam'::regclass
    ) THEN
        ALTER TABLE public.mutasi_stok_seragam
            ADD CONSTRAINT mutasi_stok_status_transaksi_check
            CHECK (status_transaksi IN ('terjadwal','diterapkan','gagal'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mutasi_stok_jadwal
    ON public.mutasi_stok_seragam (status_transaksi, tanggal_efektif, id);
CREATE INDEX IF NOT EXISTS idx_mutasi_stok_batch
    ON public.mutasi_stok_seragam (batch_id, id);

CREATE TABLE IF NOT EXISTS public.audit_operasional_fase17 (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    aksi text NOT NULL,
    referensi_hash text,
    ringkasan jsonb NOT NULL DEFAULT '{}'::jsonb,
    alasan text,
    dibuat_pada timestamptz NOT NULL DEFAULT now(),
    dibuat_oleh uuid DEFAULT auth.uid()
);

ALTER TABLE public.audit_operasional_fase17 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fase17_admin_read_audit" ON public.audit_operasional_fase17;
CREATE POLICY "fase17_admin_read_audit" ON public.audit_operasional_fase17
FOR SELECT TO authenticated USING (public.fase17_admin());

CREATE OR REPLACE FUNCTION public.catat_mutasi_stok_batch_v2(
    p_items jsonb,
    p_tanggal_efektif timestamptz DEFAULT now(),
    p_catatan text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item jsonb;
    v_batch uuid := gen_random_uuid();
    v_jenis text;
    v_ukuran text;
    v_tipe text;
    v_jumlah integer;
    v_perubahan integer;
    v_saldo integer;
    v_status text;
    v_count integer := 0;
    v_effective timestamptz := coalesce(p_tanggal_efektif, now());
BEGIN
    IF NOT public.fase17_admin() THEN RAISE EXCEPTION 'Hanya admin yang boleh mengubah stok'; END IF;
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Tambahkan sedikitnya satu item stok';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        v_jenis := lower(trim(coalesce(v_item->>'jenis', '')));
        v_ukuran := trim(coalesce(v_item->>'ukuran', ''));
        v_tipe := lower(trim(coalesce(v_item->>'tipe', '')));
        v_jumlah := nullif(v_item->>'jumlah', '')::integer;
        IF v_jenis NOT IN ('atasan','bawahan') THEN RAISE EXCEPTION 'Jenis seragam tidak valid'; END IF;
        IF v_ukuran = '' THEN RAISE EXCEPTION 'Ukuran wajib diisi'; END IF;
        IF v_tipe NOT IN ('masuk','koreksi_tambah','koreksi_kurang','retur_permanen','rusak_hilang') THEN
            RAISE EXCEPTION 'Jenis transaksi stok tidak valid';
        END IF;
        IF v_jumlah IS NULL OR v_jumlah <= 0 THEN RAISE EXCEPTION 'Jumlah harus lebih dari nol'; END IF;
        v_perubahan := CASE WHEN v_tipe IN ('masuk','koreksi_tambah','retur_permanen') THEN v_jumlah ELSE -v_jumlah END;

        INSERT INTO public.stok_item_seragam (jenis, ukuran, jumlah_tersedia)
        VALUES (v_jenis, v_ukuran, 0)
        ON CONFLICT (jenis, ukuran) DO NOTHING;

        SELECT jumlah_tersedia INTO v_saldo
        FROM public.stok_item_seragam
        WHERE jenis = v_jenis AND ukuran = v_ukuran
        FOR UPDATE;

        IF v_effective <= now() THEN
            IF v_saldo + v_perubahan < 0 THEN
                RAISE EXCEPTION 'Stok % ukuran % tidak mencukupi', v_jenis, v_ukuran;
            END IF;
            v_saldo := v_saldo + v_perubahan;
            UPDATE public.stok_item_seragam
            SET jumlah_tersedia = v_saldo, updated_at = now()
            WHERE jenis = v_jenis AND ukuran = v_ukuran;
            v_status := 'diterapkan';
        ELSE
            v_status := 'terjadwal';
        END IF;

        INSERT INTO public.mutasi_stok_seragam (
            batch_id, jenis, ukuran, tipe, jumlah, perubahan, saldo_setelah,
            catatan, tanggal_efektif, diterapkan_pada, status_transaksi
        ) VALUES (
            v_batch, v_jenis, v_ukuran, v_tipe, v_jumlah, v_perubahan, v_saldo,
            coalesce(nullif(trim(v_item->>'catatan'), ''), nullif(trim(p_catatan), '')),
            v_effective, CASE WHEN v_status = 'diterapkan' THEN now() END, v_status
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'batch_id', v_batch, 'jumlah_item', v_count,
                              'status_transaksi', CASE WHEN v_effective <= now() THEN 'diterapkan' ELSE 'terjadwal' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.proses_mutasi_stok_terjadwal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.mutasi_stok_seragam%ROWTYPE; v_saldo integer; v_ok integer := 0; v_gagal integer := 0;
BEGIN
    IF NOT public.fase17_admin() THEN RAISE EXCEPTION 'Hanya admin yang boleh memproses transaksi terjadwal'; END IF;
    FOR v_row IN
        SELECT * FROM public.mutasi_stok_seragam
        WHERE status_transaksi = 'terjadwal' AND tanggal_efektif <= now()
        ORDER BY tanggal_efektif, id FOR UPDATE
    LOOP
        SELECT jumlah_tersedia INTO v_saldo FROM public.stok_item_seragam
        WHERE jenis = v_row.jenis AND ukuran = v_row.ukuran FOR UPDATE;
        IF coalesce(v_saldo, 0) + v_row.perubahan < 0 THEN
            UPDATE public.mutasi_stok_seragam SET status_transaksi = 'gagal'
            WHERE id = v_row.id;
            v_gagal := v_gagal + 1;
        ELSE
            v_saldo := coalesce(v_saldo, 0) + v_row.perubahan;
            UPDATE public.stok_item_seragam SET jumlah_tersedia = v_saldo, updated_at = now()
            WHERE jenis = v_row.jenis AND ukuran = v_row.ukuran;
            UPDATE public.mutasi_stok_seragam
            SET status_transaksi = 'diterapkan', diterapkan_pada = now(), saldo_setelah = v_saldo
            WHERE id = v_row.id;
            v_ok := v_ok + 1;
        END IF;
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'diterapkan', v_ok, 'gagal', v_gagal);
END;
$$;

CREATE OR REPLACE FUNCTION public.ubah_tanggal_mutasi_stok(
    p_id bigint,
    p_tanggal_efektif timestamptz,
    p_alasan text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.mutasi_stok_seragam%ROWTYPE; v_saldo integer; v_old timestamptz;
BEGIN
    IF NOT public.fase17_admin() THEN RAISE EXCEPTION 'Hanya admin yang boleh mengedit tanggal transaksi'; END IF;
    IF p_tanggal_efektif IS NULL THEN RAISE EXCEPTION 'Tanggal efektif wajib diisi'; END IF;
    IF nullif(trim(p_alasan), '') IS NULL THEN RAISE EXCEPTION 'Alasan perubahan wajib diisi'; END IF;
    SELECT * INTO v_row FROM public.mutasi_stok_seragam WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transaksi tidak ditemukan'; END IF;
    v_old := v_row.tanggal_efektif;
    SELECT jumlah_tersedia INTO v_saldo FROM public.stok_item_seragam
    WHERE jenis = v_row.jenis AND ukuran = v_row.ukuran FOR UPDATE;

    IF v_row.status_transaksi = 'diterapkan' AND p_tanggal_efektif > now() THEN
        IF v_saldo - v_row.perubahan < 0 THEN RAISE EXCEPTION 'Tanggal tidak dapat dipindah: stok sudah terpakai'; END IF;
        v_saldo := v_saldo - v_row.perubahan;
        UPDATE public.stok_item_seragam SET jumlah_tersedia = v_saldo, updated_at = now()
        WHERE jenis = v_row.jenis AND ukuran = v_row.ukuran;
        UPDATE public.mutasi_stok_seragam
        SET tanggal_efektif = p_tanggal_efektif, status_transaksi = 'terjadwal',
            diterapkan_pada = NULL, saldo_setelah = v_saldo
        WHERE id = p_id;
    ELSIF v_row.status_transaksi IN ('terjadwal','gagal') AND p_tanggal_efektif <= now() THEN
        IF v_saldo + v_row.perubahan < 0 THEN RAISE EXCEPTION 'Stok tidak mencukupi untuk menerapkan transaksi'; END IF;
        v_saldo := v_saldo + v_row.perubahan;
        UPDATE public.stok_item_seragam SET jumlah_tersedia = v_saldo, updated_at = now()
        WHERE jenis = v_row.jenis AND ukuran = v_row.ukuran;
        UPDATE public.mutasi_stok_seragam
        SET tanggal_efektif = p_tanggal_efektif, status_transaksi = 'diterapkan',
            diterapkan_pada = now(), saldo_setelah = v_saldo
        WHERE id = p_id;
    ELSE
        UPDATE public.mutasi_stok_seragam SET tanggal_efektif = p_tanggal_efektif WHERE id = p_id;
    END IF;

    INSERT INTO public.audit_operasional_fase17 (aksi, referensi_hash, ringkasan, alasan)
    VALUES ('ubah_tanggal_mutasi_stok', md5(p_id::text),
            jsonb_build_object('tanggal_lama', v_old, 'tanggal_baru', p_tanggal_efektif), trim(p_alasan));
    RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.hapus_mutasi_stok_permanen(
    p_id bigint,
    p_frasa text,
    p_alasan text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.mutasi_stok_seragam%ROWTYPE; v_saldo integer;
BEGIN
    IF NOT public.fase17_admin() THEN RAISE EXCEPTION 'Hanya admin yang boleh menghapus transaksi'; END IF;
    IF p_frasa <> 'HAPUS PERMANEN' THEN RAISE EXCEPTION 'Ketik HAPUS PERMANEN untuk melanjutkan'; END IF;
    IF nullif(trim(p_alasan), '') IS NULL THEN RAISE EXCEPTION 'Alasan penghapusan wajib diisi'; END IF;
    SELECT * INTO v_row FROM public.mutasi_stok_seragam WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transaksi tidak ditemukan'; END IF;
    SELECT jumlah_tersedia INTO v_saldo FROM public.stok_item_seragam
    WHERE jenis = v_row.jenis AND ukuran = v_row.ukuran FOR UPDATE;
    IF v_row.status_transaksi = 'diterapkan' THEN
        IF v_saldo - v_row.perubahan < 0 THEN
            RAISE EXCEPTION 'Tidak dapat dihapus: stok hasil transaksi ini sudah terpakai. Gunakan koreksi stok.';
        END IF;
        v_saldo := v_saldo - v_row.perubahan;
        UPDATE public.stok_item_seragam SET jumlah_tersedia = v_saldo, updated_at = now()
        WHERE jenis = v_row.jenis AND ukuran = v_row.ukuran;
    END IF;
    DELETE FROM public.mutasi_stok_seragam WHERE id = p_id;
    INSERT INTO public.audit_operasional_fase17 (aksi, referensi_hash, ringkasan, alasan)
    VALUES ('hapus_mutasi_stok', md5(p_id::text),
            jsonb_build_object('jenis', v_row.jenis, 'ukuran', v_row.ukuran, 'perubahan', v_row.perubahan), trim(p_alasan));
    RETURN jsonb_build_object('ok', true, 'saldo', v_saldo);
END;
$$;

-- -----------------------------------------------------------------
-- C. STATUS SERAGAM UNTUK PERSONEL KHUSUS DAN TANGGAL EFEKTIF
-- -----------------------------------------------------------------
ALTER TABLE public.seragam_penerima
    ADD COLUMN IF NOT EXISTS tanggal_efektif_status timestamptz;
ALTER TABLE public.seragam_riwayat
    ADD COLUMN IF NOT EXISTS tanggal_efektif_status timestamptz;

CREATE OR REPLACE FUNCTION public.catat_riwayat_seragam()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.seragam_riwayat (
        nip, status_proses, status_penguasaan, ukuran, kode_seragam, catatan,
        ukuran_atasan, ukuran_bawahan, kode_atasan, kode_bawahan, tanggal_efektif_status
    ) VALUES (
        NEW.nip, NEW.status_proses, NEW.status_penguasaan,
        NEW.ukuran_dibutuhkan, NEW.kode_seragam, NEW.catatan,
        NEW.ukuran_atasan, NEW.ukuran_bawahan, NEW.kode_atasan, NEW.kode_bawahan,
        coalesce(NEW.tanggal_efektif_status, now())
    );
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.simpan_status_seragam_set_v2(
    p_nip text,
    p_status_proses text,
    p_ukuran_atasan text,
    p_ukuran_bawahan text,
    p_status_penguasaan text,
    p_tanggal_rencana date DEFAULT NULL,
    p_tanggal_diserahkan date DEFAULT NULL,
    p_kode_atasan text DEFAULT NULL,
    p_kode_bawahan text DEFAULT NULL,
    p_catatan text DEFAULT NULL,
    p_aturan_disetujui boolean DEFAULT false,
    p_data_lama boolean DEFAULT false,
    p_kurangi_stok boolean DEFAULT false,
    p_tanggal_efektif timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_memenuhi boolean := false;
    v_tanggal_memenuhi date;
    v_jalur text;
    v_khusus boolean := false;
    v_lama public.seragam_penerima%ROWTYPE;
    v_mutasi jsonb;
BEGIN
    IF NOT public.fase17_admin() THEN RAISE EXCEPTION 'Hanya admin yang boleh mengelola seragam'; END IF;
    SELECT kategori_personel = 'khusus' INTO v_khusus FROM public.master_relawan WHERE nip = p_nip;
    IF NOT FOUND THEN RAISE EXCEPTION 'Personel tidak ditemukan'; END IF;

    SELECT r.memenuhi_syarat, r.tanggal_memenuhi,
           CASE WHEN r.zona_asal = 'zona_4' THEN 'zona_4' ELSE r.kategori END
    INTO v_memenuhi, v_tanggal_memenuhi, v_jalur
    FROM public.v_peringkat_personel_operasional_v2 r
    WHERE r.nip = p_nip AND r.memenuhi_syarat
    ORDER BY CASE WHEN r.zona_asal = 'zona_4' THEN 0 ELSE 1 END,
             r.tanggal_memenuhi NULLS LAST LIMIT 1;

    IF p_status_proses = 'sudah_diserahkan' THEN
        IF nullif(trim(p_ukuran_atasan), '') IS NULL THEN RAISE EXCEPTION 'Ukuran atasan wajib diisi'; END IF;
        IF NOT p_data_lama AND nullif(trim(p_ukuran_bawahan), '') IS NULL THEN RAISE EXCEPTION 'Ukuran bawahan wajib diisi'; END IF;
        IF p_tanggal_diserahkan IS NULL THEN RAISE EXCEPTION 'Tanggal penyerahan wajib diisi'; END IF;
        IF p_status_penguasaan = 'belum_memiliki' THEN RAISE EXCEPTION 'Keberadaan seragam wajib dipilih'; END IF;
        IF NOT p_data_lama AND NOT p_aturan_disetujui THEN RAISE EXCEPTION 'Ketentuan seragam wajib disetujui'; END IF;
        IF NOT p_data_lama AND NOT v_khusus AND NOT coalesce(v_memenuhi, false) THEN RAISE EXCEPTION 'Personel belum memenuhi syarat'; END IF;
    END IF;

    SELECT * INTO v_lama FROM public.seragam_penerima WHERE nip = p_nip FOR UPDATE;
    IF p_status_proses = 'sudah_diserahkan' AND p_kurangi_stok
       AND (v_lama.nip IS NULL OR v_lama.status_proses <> 'sudah_diserahkan') THEN
        v_mutasi := public.catat_mutasi_stok_batch_v2(
            jsonb_build_array(
                jsonb_build_object('jenis','atasan','ukuran',trim(p_ukuran_atasan),'tipe','koreksi_kurang','jumlah',1,'catatan','Penyerahan seragam'),
                jsonb_build_object('jenis','bawahan','ukuran',trim(p_ukuran_bawahan),'tipe','koreksi_kurang','jumlah',1,'catatan','Penyerahan seragam')
            ), coalesce(p_tanggal_efektif, now()), 'Penyerahan set seragam'
        );
        UPDATE public.mutasi_stok_seragam SET nip = p_nip, tipe = 'keluar_penyerahan'
        WHERE batch_id = (v_mutasi->>'batch_id')::uuid;
    END IF;

    INSERT INTO public.seragam_penerima (
        nip, jalur_kelayakan, status_proses, ukuran_dibutuhkan, kode_seragam,
        ukuran_atasan, ukuran_bawahan, kode_atasan, kode_bawahan,
        status_penguasaan, tanggal_memenuhi, tanggal_rencana,
        tanggal_diserahkan, tanggal_status, aturan_disetujui, data_lama, catatan,
        tanggal_efektif_status
    ) VALUES (
        p_nip, CASE WHEN v_khusus THEN NULL ELSE v_jalur END, p_status_proses,
        nullif(trim(p_ukuran_atasan), ''), nullif(trim(p_kode_atasan), ''),
        nullif(trim(p_ukuran_atasan), ''), nullif(trim(p_ukuran_bawahan), ''),
        nullif(trim(p_kode_atasan), ''), nullif(trim(p_kode_bawahan), ''),
        p_status_penguasaan, CASE WHEN v_khusus THEN NULL ELSE v_tanggal_memenuhi END,
        p_tanggal_rencana, p_tanggal_diserahkan, now(), p_aturan_disetujui,
        p_data_lama, nullif(trim(p_catatan), ''), coalesce(p_tanggal_efektif, now())
    )
    ON CONFLICT (nip) DO UPDATE SET
        jalur_kelayakan = EXCLUDED.jalur_kelayakan,
        status_proses = EXCLUDED.status_proses,
        ukuran_dibutuhkan = EXCLUDED.ukuran_dibutuhkan,
        kode_seragam = EXCLUDED.kode_seragam,
        ukuran_atasan = EXCLUDED.ukuran_atasan,
        ukuran_bawahan = EXCLUDED.ukuran_bawahan,
        kode_atasan = EXCLUDED.kode_atasan,
        kode_bawahan = EXCLUDED.kode_bawahan,
        status_penguasaan = EXCLUDED.status_penguasaan,
        tanggal_memenuhi = coalesce(EXCLUDED.tanggal_memenuhi, public.seragam_penerima.tanggal_memenuhi),
        tanggal_rencana = EXCLUDED.tanggal_rencana,
        tanggal_diserahkan = EXCLUDED.tanggal_diserahkan,
        tanggal_status = now(), aturan_disetujui = EXCLUDED.aturan_disetujui,
        data_lama = EXCLUDED.data_lama, catatan = EXCLUDED.catatan,
        tanggal_efektif_status = EXCLUDED.tanggal_efektif_status;

    UPDATE public.master_relawan SET ukuran_seragam = nullif(trim(p_ukuran_atasan), '')
    WHERE nip = p_nip AND nullif(trim(p_ukuran_atasan), '') IS NOT NULL;
    RETURN jsonb_build_object('ok', true, 'nip', p_nip, 'personel_khusus', v_khusus, 'mutasi', v_mutasi);
END;
$$;

-- Tambahkan metadata khusus ke view seragam tanpa mengubah urutan kolom lama.
CREATE OR REPLACE VIEW public.v_status_seragam_set_v2
WITH (security_invoker = true)
AS
WITH eligible AS (
    SELECT * FROM (
        SELECT r.*, row_number() OVER (
            PARTITION BY r.nip
            ORDER BY CASE WHEN r.zona_asal = 'zona_4' THEN 0 ELSE 1 END,
                     r.tanggal_memenuhi ASC NULLS LAST, r.indeks_keaktifan DESC
        ) AS pilihan
        FROM public.v_peringkat_personel_operasional_v2 r WHERE r.memenuhi_syarat
    ) x WHERE pilihan = 1
), last_attendance AS (
    SELECT nip, max(tanggal) AS tanggal_terakhir
    FROM public.v_log_absensi_operasional WHERE terhubung GROUP BY nip
), base AS (
    SELECT m.*,
        ((NULLIF(upper(trim(m.kabupaten_normalisasi)), '') IS NOT NULL AND upper(trim(m.kabupaten_normalisasi)) <> 'JOMBANG')
          OR m.kategori_wilayah IN ('luar_jombang', 'zona_4')) AS luar_jombang
    FROM public.master_relawan m
)
SELECT
    m.nip, m.nama, m.asal_organisasi, m.asal_daerah,
    m.kabupaten_normalisasi AS kabupaten,
    m.kategori_wilayah, m.zona_asal, m.ukuran_seragam, m.luar_jombang,
    coalesce(e.memenuhi_syarat, false) AS memenuhi_syarat,
    e.tanggal_memenuhi,
    CASE WHEN m.zona_asal = 'zona_4' THEN 'zona_4' ELSE e.kategori END AS jalur_kelayakan,
    e.indeks_keaktifan, e.peringkat,
    coalesce(sp.status_proses, CASE WHEN e.memenuhi_syarat THEN 'memenuhi_syarat' ELSE 'belum_memenuhi' END) AS status_proses,
    coalesce(sp.ukuran_atasan, sp.ukuran_dibutuhkan, m.ukuran_seragam) AS ukuran_dibutuhkan,
    coalesce(sp.kode_atasan, sp.kode_seragam) AS kode_seragam,
    CASE WHEN sp.status_penguasaan = 'dititipkan_kantor' AND m.luar_jombang
              AND la.tanggal_terakhir > sp.tanggal_status::date
         THEN 'perlu_diserahkan_kembali'
         ELSE coalesce(sp.status_penguasaan, 'belum_memiliki') END AS status_penguasaan,
    (sp.status_penguasaan = 'dititipkan_kantor' AND m.luar_jombang
      AND la.tanggal_terakhir > sp.tanggal_status::date) AS notifikasi_pengembalian,
    sp.tanggal_rencana, sp.tanggal_diserahkan, sp.tanggal_status,
    sp.aturan_disetujui, sp.data_lama, sp.catatan,
    (sp.nip IS NOT NULL) AS record_tersimpan,
    la.tanggal_terakhir AS tanggal_hadir_terakhir,
    (sp.status_proses = 'sudah_diserahkan'
      AND coalesce(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date) IS NOT NULL
      AND coalesce(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date) <= current_date - 30) AS tidak_hadir_30_hari,
    CASE WHEN sp.status_proses = 'sudah_diserahkan'
              AND coalesce(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date) IS NOT NULL
         THEN greatest(0, current_date - coalesce(la.tanggal_terakhir, sp.tanggal_diserahkan, sp.tanggal_status::date))
         ELSE 0 END::integer AS hari_tidak_hadir,
    sp.ukuran_atasan, sp.ukuran_bawahan, sp.kode_atasan, sp.kode_bawahan,
    m.kategori_personel,
    m.jabatan_khusus,
    (m.kategori_personel = 'khusus') AS pengecualian_aturan,
    sp.tanggal_efektif_status,
    (sp.tanggal_efektif_status > now()) AS status_terjadwal
FROM base m
LEFT JOIN eligible e ON e.nip = m.nip
LEFT JOIN public.seragam_penerima sp ON sp.nip = m.nip
LEFT JOIN last_attendance la ON la.nip = m.nip;

-- Peringkat hanya memuat personel reguler tanpa mengubah view analitik lama.
CREATE OR REPLACE FUNCTION public.daftar_peringkat_v2(
    p_proyek text DEFAULT 'semua', p_status text DEFAULT 'semua', p_cari text DEFAULT '',
    p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_rows jsonb; v_total integer;
    v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
    v_offset integer := greatest(0, coalesce(p_offset, 0));
    v_project text := coalesce(nullif(trim(p_proyek), ''), 'semua');
    v_search text := trim(coalesce(p_cari, ''));
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi pengguna tidak valid'; END IF;
    IF v_project = 'semua' THEN
        WITH filtered AS (
            SELECT r.* FROM public.v_peringkat_personel_umum_v2 r
            JOIN public.master_relawan m ON m.nip = r.nip AND m.kategori_personel = 'reguler'
            WHERE (v_search = '' OR r.nama ILIKE '%' || v_search || '%' OR r.nip ILIKE '%' || v_search || '%'
                   OR r.asal_organisasi ILIKE '%' || v_search || '%' OR coalesce(r.asal_daerah, '') ILIKE '%' || v_search || '%')
              AND (p_status = 'semua' OR (p_status = 'memenuhi' AND r.memenuhi_syarat)
                   OR (p_status = 'belum' AND NOT r.memenuhi_syarat)
                   OR (p_status = 'mendekati' AND NOT r.memenuhi_syarat AND r.target_hari = 40 AND r.hari_menuju_syarat BETWEEN 30 AND 39))
        ), paged AS (
            SELECT * FROM filtered ORDER BY memenuhi_syarat DESC, peringkat ASC NULLS LAST,
              hari_menuju_syarat DESC, indeks_keaktifan DESC, nama ASC LIMIT v_limit OFFSET v_offset
        )
        SELECT (SELECT count(*)::integer FROM filtered), coalesce((SELECT jsonb_agg(to_jsonb(paged)) FROM paged), '[]'::jsonb)
        INTO v_total, v_rows;
    ELSE
        WITH filtered AS (
            SELECT r.* FROM public.v_peringkat_personel_operasional_v2 r
            JOIN public.master_relawan m ON m.nip = r.nip AND m.kategori_personel = 'reguler'
            WHERE ((v_project IN ('khususul_khusus','lainnya') AND r.kategori = v_project)
                OR (v_project LIKE 'proyek:%' AND EXISTS (
                    SELECT 1 FROM public.v_kehadiran_proyek_personel kp
                    WHERE kp.nip = r.nip AND kp.kategori = r.kategori AND kp.nama_proyek = substring(v_project FROM 8))))
              AND (v_search = '' OR r.nama ILIKE '%' || v_search || '%' OR r.nip ILIKE '%' || v_search || '%'
                   OR r.asal_organisasi ILIKE '%' || v_search || '%' OR coalesce(r.asal_daerah, '') ILIKE '%' || v_search || '%')
              AND (p_status = 'semua' OR (p_status = 'memenuhi' AND r.memenuhi_syarat)
                   OR (p_status = 'belum' AND NOT r.memenuhi_syarat)
                   OR (p_status = 'mendekati' AND NOT r.memenuhi_syarat AND r.target_hari = 40 AND r.total_hari BETWEEN 30 AND 39))
        ), paged AS (
            SELECT * FROM filtered ORDER BY memenuhi_syarat DESC, peringkat ASC NULLS LAST,
              total_hari DESC, indeks_keaktifan DESC, nama ASC LIMIT v_limit OFFSET v_offset
        )
        SELECT (SELECT count(*)::integer FROM filtered), coalesce((SELECT jsonb_agg(to_jsonb(paged)) FROM paged), '[]'::jsonb)
        INTO v_total, v_rows;
    END IF;
    RETURN jsonb_build_object('rows', v_rows, 'total', v_total, 'kpi', (
        SELECT jsonb_build_object(
            'personel', count(*), 'memenuhi', count(*) FILTER (WHERE r.memenuhi_syarat),
            'zona4', count(*) FILTER (WHERE r.zona_asal = 'zona_4'),
            'mendekati', count(*) FILTER (WHERE NOT r.memenuhi_syarat AND r.target_hari = 40 AND r.hari_menuju_syarat BETWEEN 30 AND 39),
            'zona_kosong', count(*) FILTER (WHERE r.zona_asal IS NULL))
        FROM public.v_peringkat_personel_umum_v2 r
        JOIN public.master_relawan m ON m.nip = r.nip AND m.kategori_personel = 'reguler'
    ));
END;
$$;

-- -----------------------------------------------------------------
-- D. DETAIL PERSONEL DAN HAPUS PERMANEN
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detail_personel_v2(p_nip text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_profile jsonb; v_projects jsonb; v_attendance jsonb; v_uniform jsonb;
BEGIN
    IF NOT public.fase17_admin() THEN RAISE EXCEPTION 'Hanya admin yang boleh melihat detail lengkap'; END IF;
    SELECT to_jsonb(r) INTO v_profile FROM public.v_ringkasan_personel r WHERE r.nip = p_nip;
    IF v_profile IS NULL THEN RAISE EXCEPTION 'Personel tidak ditemukan'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY k.hadir_pertama_proyek, k.nama_proyek), '[]'::jsonb)
    INTO v_projects FROM public.v_kehadiran_proyek_personel k WHERE k.nip = p_nip;
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.tanggal DESC, x.sesi), '[]'::jsonb)
    INTO v_attendance FROM (
        SELECT tanggal, sesi, lokasi FROM public.v_log_absensi_operasional
        WHERE nip = p_nip AND terhubung ORDER BY tanggal DESC, sesi LIMIT 250
    ) x;
    SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.dibuat_pada DESC), '[]'::jsonb)
    INTO v_uniform FROM (SELECT * FROM public.seragam_riwayat WHERE nip = p_nip ORDER BY dibuat_pada DESC LIMIT 100) s;
    RETURN jsonb_build_object('profile', v_profile, 'projects', v_projects,
                              'attendance', v_attendance, 'uniform_history', v_uniform);
END;
$$;

CREATE OR REPLACE FUNCTION public.pratinjau_hapus_personel(p_nips text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_nips text[];
BEGIN
    IF NOT public.fase17_admin() THEN RAISE EXCEPTION 'Hanya admin yang boleh melihat dampak penghapusan'; END IF;
    SELECT array_agg(DISTINCT trim(x)) INTO v_nips FROM unnest(coalesce(p_nips, ARRAY[]::text[])) x WHERE trim(x) <> '';
    RETURN jsonb_build_object(
        'profil', (SELECT count(*) FROM public.master_relawan WHERE nip = ANY(v_nips)),
        'absensi', (SELECT count(*) FROM public.log_absensi WHERE nip = ANY(v_nips)),
        'historis', (SELECT count(*) FROM public.kehadiran_historis WHERE nip = ANY(v_nips)),
        'status_seragam', (SELECT count(*) FROM public.seragam_penerima WHERE nip = ANY(v_nips)),
        'riwayat_seragam', (SELECT count(*) FROM public.seragam_riwayat WHERE nip = ANY(v_nips)),
        'mutasi_stok', (SELECT count(*) FROM public.mutasi_stok_seragam WHERE nip = ANY(v_nips)),
        'seragam_belum_selesai', (SELECT count(*) FROM public.seragam_penerima
            WHERE nip = ANY(v_nips) AND status_penguasaan IN ('dipegang_personel','perlu_diserahkan_kembali','menunggu_penggantian'))
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.hapus_personel_permanen(
    p_nips text[], p_frasa text, p_alasan text, p_selesaikan_seragam boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_nips text[]; v_dampak jsonb; v_hash text; v_deleted integer;
BEGIN
    IF NOT public.fase17_admin() THEN RAISE EXCEPTION 'Hanya admin yang boleh menghapus personel'; END IF;
    IF p_frasa <> 'HAPUS PERMANEN' THEN RAISE EXCEPTION 'Ketik HAPUS PERMANEN untuk melanjutkan'; END IF;
    IF nullif(trim(p_alasan), '') IS NULL THEN RAISE EXCEPTION 'Alasan penghapusan wajib diisi'; END IF;
    SELECT array_agg(DISTINCT trim(x) ORDER BY trim(x)) INTO v_nips
    FROM unnest(coalesce(p_nips, ARRAY[]::text[])) x WHERE trim(x) <> '';
    IF coalesce(array_length(v_nips, 1), 0) = 0 THEN RAISE EXCEPTION 'Tidak ada personel yang dipilih'; END IF;
    v_dampak := public.pratinjau_hapus_personel(v_nips);
    IF coalesce((v_dampak->>'seragam_belum_selesai')::integer, 0) > 0 AND NOT p_selesaikan_seragam THEN
        RAISE EXCEPTION 'Masih ada seragam yang dipegang/belum selesai. Selesaikan status fisiknya terlebih dahulu.';
    END IF;
    v_hash := md5(array_to_string(v_nips, '|'));

    DELETE FROM public.riwayat_merge_personel WHERE target_nip = ANY(v_nips) OR anggota_nip && v_nips;
    DELETE FROM public.seragam_riwayat WHERE nip = ANY(v_nips);
    DELETE FROM public.seragam_penerima WHERE nip = ANY(v_nips);
    UPDATE public.mutasi_stok_seragam SET nip = NULL WHERE nip = ANY(v_nips);
    DELETE FROM public.koreksi_kehadiran_batch WHERE nip = ANY(v_nips);
    DELETE FROM public.kehadiran_historis WHERE nip = ANY(v_nips);
    DELETE FROM public.log_absensi WHERE nip = ANY(v_nips);
    DELETE FROM public.master_relawan WHERE nip = ANY(v_nips);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    INSERT INTO public.audit_operasional_fase17 (aksi, referensi_hash, ringkasan, alasan)
    VALUES ('hapus_personel_permanen', v_hash, v_dampak || jsonb_build_object('profil_dihapus', v_deleted), trim(p_alasan));
    RETURN jsonb_build_object('ok', true, 'profil_dihapus', v_deleted, 'dampak', v_dampak);
END;
$$;

-- -----------------------------------------------------------------
-- E. HAK AKSES
-- -----------------------------------------------------------------
REVOKE ALL ON public.audit_operasional_fase17 FROM anon, authenticated;
GRANT SELECT ON public.audit_operasional_fase17 TO authenticated;
REVOKE ALL ON FUNCTION public.fase17_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.simpan_personel_manual_v2(text,text,text,text,text,text,text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.catat_mutasi_stok_batch_v2(jsonb,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.proses_mutasi_stok_terjadwal() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ubah_tanggal_mutasi_stok(bigint,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hapus_mutasi_stok_permanen(bigint,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.simpan_status_seragam_set_v2(text,text,text,text,text,date,date,text,text,text,boolean,boolean,boolean,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.detail_personel_v2(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pratinjau_hapus_personel(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hapus_personel_permanen(text[],text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fase17_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.simpan_personel_manual_v2(text,text,text,text,text,text,text,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catat_mutasi_stok_batch_v2(jsonb,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.proses_mutasi_stok_terjadwal() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ubah_tanggal_mutasi_stok(bigint,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hapus_mutasi_stok_permanen(bigint,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.simpan_status_seragam_set_v2(text,text,text,text,text,date,date,text,text,text,boolean,boolean,boolean,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detail_personel_v2(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pratinjau_hapus_personel(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hapus_personel_permanen(text[],text,text,boolean) TO authenticated;
REVOKE ALL ON public.v_ringkasan_personel, public.v_status_seragam_set_v2 FROM anon;
GRANT SELECT ON public.v_ringkasan_personel, public.v_status_seragam_set_v2 TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';

SELECT
    (SELECT count(*) FROM public.master_relawan WHERE kategori_personel = 'khusus') AS personel_khusus,
    (SELECT count(*) FROM public.mutasi_stok_seragam WHERE status_transaksi = 'terjadwal') AS transaksi_terjadwal,
    (SELECT count(*) FROM public.audit_operasional_fase17) AS audit_fase17;
