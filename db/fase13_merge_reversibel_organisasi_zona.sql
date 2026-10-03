-- FASE 13: merge reversibel, pengelolaan organisasi, dan zona asal.
-- Jalankan setelah Fase 12. Migrasi ini hanya menambah struktur dan fungsi;
-- merge seluruh kandidat dijalankan terpisah melalui gabungkan_semua_kandidat_mirip().

BEGIN;

CREATE OR REPLACE FUNCTION public.fase13_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role text;
BEGIN
    -- SQL Editor dijalankan langsung oleh pemilik database dan tidak membawa
    -- JWT Supabase. Izinkan sesi tersebut; panggilan API tetap diperiksa lewat
    -- auth.uid() dan akun_role().
    IF session_user IN ('postgres', 'supabase_admin') THEN RETURN true; END IF;
    IF auth.uid() IS NULL THEN RETURN false; END IF;
    IF to_regprocedure('public.akun_role()') IS NULL THEN RETURN true; END IF;
    EXECUTE 'SELECT public.akun_role()' INTO v_role;
    RETURN coalesce(v_role, '') = 'admin';
END;
$$;

-- -----------------------------------------------------------------
-- A. ZONA ASAL (terpisah dari kategori_wilayah operasional)
-- -----------------------------------------------------------------
ALTER TABLE public.master_relawan
    ADD COLUMN IF NOT EXISTS zona_asal text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'master_relawan_zona_asal_check'
          AND conrelid = 'public.master_relawan'::regclass
    ) THEN
        ALTER TABLE public.master_relawan
            ADD CONSTRAINT master_relawan_zona_asal_check
            CHECK (zona_asal IS NULL OR zona_asal IN ('zona_1','zona_2','zona_3','zona_4'));
    END IF;
END $$;

-- Fase 13 tetap dapat dipasang bila tabel pemetaan Fase 10 belum pernah dibuat
-- di lingkungan produksi. Data organisasi aktif akan diisi dari master_relawan
-- pada langkah berikutnya.
CREATE TABLE IF NOT EXISTS public.organisasi_kabupaten_map (
    organisasi_key  text PRIMARY KEY,
    organisasi_asli text NOT NULL,
    kabupaten       text NOT NULL,
    catatan         text,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organisasi_kabupaten_map
    ADD COLUMN IF NOT EXISTS provinsi text,
    ADD COLUMN IF NOT EXISTS zona_asal text,
    ADD COLUMN IF NOT EXISTS aktif boolean NOT NULL DEFAULT true;

ALTER TABLE public.organisasi_kabupaten_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fase13_authenticated_read_org_map" ON public.organisasi_kabupaten_map;
CREATE POLICY "fase13_authenticated_read_org_map" ON public.organisasi_kabupaten_map
FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.organisasi_kabupaten_map FROM anon;
GRANT SELECT ON public.organisasi_kabupaten_map TO authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'organisasi_map_zona_asal_check'
          AND conrelid = 'public.organisasi_kabupaten_map'::regclass
    ) THEN
        ALTER TABLE public.organisasi_kabupaten_map
            ADD CONSTRAINT organisasi_map_zona_asal_check
            CHECK (zona_asal IS NULL OR zona_asal IN ('zona_1','zona_2','zona_3','zona_4'));
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.zona_dari_provinsi(p_provinsi text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE public.normalisasi_label(p_provinsi)
        WHEN 'JAWA TIMUR' THEN 'zona_1'
        WHEN 'BALI' THEN 'zona_1'
        WHEN 'JAWA TENGAH' THEN 'zona_2'
        WHEN 'DI YOGYAKARTA' THEN 'zona_2'
        WHEN 'DAERAH ISTIMEWA YOGYAKARTA' THEN 'zona_2'
        WHEN 'DIY' THEN 'zona_2'
        WHEN 'YOGYAKARTA' THEN 'zona_2'
        WHEN 'JAWA BARAT' THEN 'zona_3'
        WHEN 'DKI JAKARTA' THEN 'zona_3'
        WHEN 'JAKARTA' THEN 'zona_3'
        WHEN 'BANTEN' THEN 'zona_3'
        WHEN 'ACEH' THEN 'zona_4'
        WHEN 'SUMATERA UTARA' THEN 'zona_4'
        WHEN 'SUMATERA BARAT' THEN 'zona_4'
        WHEN 'RIAU' THEN 'zona_4'
        WHEN 'KEPULAUAN RIAU' THEN 'zona_4'
        WHEN 'JAMBI' THEN 'zona_4'
        WHEN 'SUMATERA SELATAN' THEN 'zona_4'
        WHEN 'KEPULAUAN BANGKA BELITUNG' THEN 'zona_4'
        WHEN 'BENGKULU' THEN 'zona_4'
        WHEN 'LAMPUNG' THEN 'zona_4'
        WHEN 'KALIMANTAN BARAT' THEN 'zona_4'
        WHEN 'KALIMANTAN TENGAH' THEN 'zona_4'
        WHEN 'KALIMANTAN SELATAN' THEN 'zona_4'
        WHEN 'KALIMANTAN TIMUR' THEN 'zona_4'
        WHEN 'KALIMANTAN UTARA' THEN 'zona_4'
        ELSE NULL
    END;
$$;

-- Pastikan seluruh label organisasi yang sedang dipakai dapat dikelola admin.
INSERT INTO public.organisasi_kabupaten_map
    (organisasi_key, organisasi_asli, kabupaten, catatan)
SELECT DISTINCT
    public.normalisasi_label(m.asal_organisasi),
    public.normalisasi_label(m.asal_organisasi),
    coalesce(nullif(public.normalisasi_label(m.kabupaten_normalisasi), ''), 'BELUM DIISI'),
    'Ditambahkan otomatis dari Master Data Fase 13'
FROM public.master_relawan m
WHERE nullif(public.normalisasi_label(m.asal_organisasi), '') IS NOT NULL
ON CONFLICT (organisasi_key) DO NOTHING;

UPDATE public.organisasi_kabupaten_map
SET zona_asal = public.zona_dari_provinsi(provinsi)
WHERE zona_asal IS NULL AND public.zona_dari_provinsi(provinsi) IS NOT NULL;

-- Kabupaten Jombang sudah pasti berada di Jawa Timur (Zona 1). PUSAT tetap
-- organisasi tersendiri; DPD/DPC Jombang tidak diubah menjadi PUSAT.
UPDATE public.organisasi_kabupaten_map
SET provinsi = coalesce(nullif(provinsi, ''), 'JAWA TIMUR'),
    zona_asal = 'zona_1',
    updated_at = now()
WHERE public.normalisasi_label(kabupaten) = 'JOMBANG';

UPDATE public.master_relawan m
SET zona_asal = o.zona_asal
FROM public.organisasi_kabupaten_map o
WHERE o.organisasi_key = public.normalisasi_label(m.asal_organisasi)
  AND o.zona_asal IS NOT NULL
  AND m.zona_asal IS DISTINCT FROM o.zona_asal;

-- -----------------------------------------------------------------
-- B. JURNAL MERGE LENGKAP UNTUK FITUR PISAHKAN
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.riwayat_merge_personel (
    id                         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    target_nip                 text NOT NULL,
    target_nama                text NOT NULL,
    anggota_nip                text[] NOT NULL,
    jumlah_profil              integer NOT NULL CHECK (jumlah_profil >= 2),
    alasan                     text,
    snapshot_master            jsonb NOT NULL,
    snapshot_log               jsonb NOT NULL DEFAULT '[]'::jsonb,
    snapshot_historis          jsonb NOT NULL DEFAULT '[]'::jsonb,
    snapshot_koreksi           jsonb NOT NULL DEFAULT '[]'::jsonb,
    snapshot_mutasi            jsonb NOT NULL DEFAULT '[]'::jsonb,
    snapshot_seragam           jsonb NOT NULL DEFAULT '[]'::jsonb,
    snapshot_seragam_riwayat   jsonb NOT NULL DEFAULT '[]'::jsonb,
    hasil_master               jsonb,
    hasil_seragam              jsonb NOT NULL DEFAULT '[]'::jsonb,
    hasil_historis_ids         jsonb NOT NULL DEFAULT '[]'::jsonb,
    hasil_merge                jsonb,
    status                     text NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','dipisahkan')),
    dibuat_pada                timestamptz NOT NULL DEFAULT now(),
    dibuat_oleh                uuid DEFAULT auth.uid(),
    dipisahkan_pada            timestamptz,
    dipisahkan_oleh            uuid
);

CREATE INDEX IF NOT EXISTS idx_riwayat_merge_target_status
    ON public.riwayat_merge_personel (target_nip, status, id DESC);
CREATE INDEX IF NOT EXISTS idx_riwayat_merge_anggota
    ON public.riwayat_merge_personel USING gin (anggota_nip);

ALTER TABLE public.riwayat_merge_personel ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fase13_admin_read_merge" ON public.riwayat_merge_personel;
CREATE POLICY "fase13_admin_read_merge" ON public.riwayat_merge_personel
FOR SELECT TO authenticated
USING (public.fase13_admin());

REVOKE ALL ON public.riwayat_merge_personel FROM anon, authenticated;
GRANT SELECT ON public.riwayat_merge_personel TO authenticated;

CREATE OR REPLACE VIEW public.v_riwayat_merge_personel
WITH (security_invoker = true)
AS
SELECT
    r.id,
    r.target_nip,
    r.target_nama,
    r.jumlah_profil,
    r.alasan,
    r.status,
    r.dibuat_pada,
    r.dipisahkan_pada,
    (
        SELECT string_agg(coalesce(item->>'nama', item->>'nip'), ', ' ORDER BY coalesce(item->>'nama', item->>'nip'))
        FROM jsonb_array_elements(r.snapshot_master) item
        WHERE item->>'nip' <> r.target_nip
    ) AS profil_digabung,
    NOT EXISTS (
        SELECT 1
        FROM public.riwayat_merge_personel newer
        WHERE newer.id > r.id
          AND newer.status = 'aktif'
          AND newer.anggota_nip && r.anggota_nip
    ) AS dapat_dipisahkan
FROM public.riwayat_merge_personel r;

GRANT SELECT ON public.v_riwayat_merge_personel TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_relawan_tercatat(
    p_nips text[],
    p_target_nip text,
    p_profile jsonb,
    p_alasan text DEFAULT 'Merge dari Master Data'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_nips text[];
    v_batch_id bigint;
    v_result jsonb;
    v_target_nama text;
    v_zona text;
BEGIN
    IF NOT public.fase13_admin() THEN
        RAISE EXCEPTION 'Hanya admin yang boleh melakukan merge personel';
    END IF;

    SELECT array_agg(nip ORDER BY nip) INTO v_nips
    FROM (
        SELECT DISTINCT trim(value) AS nip
        FROM unnest(coalesce(p_nips, ARRAY[]::text[])) AS item(value)
        WHERE value IS NOT NULL AND trim(value) <> ''
    ) pilihan;

    IF coalesce(array_length(v_nips, 1), 0) < 2 THEN
        RAISE EXCEPTION 'Pilih sedikitnya dua profil untuk digabung';
    END IF;
    IF p_target_nip IS NULL OR NOT (p_target_nip = ANY(v_nips)) THEN
        RAISE EXCEPTION 'ID utama harus termasuk dalam profil yang dipilih';
    END IF;

    SELECT nama INTO v_target_nama
    FROM public.master_relawan
    WHERE nip = p_target_nip;
    IF NOT FOUND THEN RAISE EXCEPTION 'Profil utama tidak ditemukan'; END IF;

    INSERT INTO public.riwayat_merge_personel (
        target_nip, target_nama, anggota_nip, jumlah_profil, alasan,
        snapshot_master, snapshot_log, snapshot_historis, snapshot_koreksi,
        snapshot_mutasi, snapshot_seragam, snapshot_seragam_riwayat
    )
    SELECT
        p_target_nip,
        v_target_nama,
        v_nips,
        array_length(v_nips, 1),
        nullif(trim(p_alasan), ''),
        coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.nip) FROM public.master_relawan m WHERE m.nip = ANY(v_nips)), '[]'::jsonb),
        coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.log_absensi l WHERE l.nip = ANY(v_nips)), '[]'::jsonb),
        coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM public.kehadiran_historis h WHERE h.nip = ANY(v_nips)), '[]'::jsonb),
        coalesce((SELECT jsonb_agg(to_jsonb(k) ORDER BY k.id) FROM public.koreksi_kehadiran_batch k WHERE k.nip = ANY(v_nips)), '[]'::jsonb),
        coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.mutasi_stok_seragam s WHERE s.nip = ANY(v_nips)), '[]'::jsonb),
        coalesce((SELECT jsonb_agg(to_jsonb(sp) ORDER BY sp.nip) FROM public.seragam_penerima sp WHERE sp.nip = ANY(v_nips)), '[]'::jsonb),
        coalesce((SELECT jsonb_agg(to_jsonb(sr) ORDER BY sr.id) FROM public.seragam_riwayat sr WHERE sr.nip = ANY(v_nips)), '[]'::jsonb)
    RETURNING id INTO v_batch_id;

    v_result := public.merge_relawan_manual(v_nips, p_target_nip, p_profile);

    v_zona := nullif(trim(coalesce(p_profile->>'zona_asal', '')), '');
    IF v_zona IS NOT NULL AND v_zona NOT IN ('zona_1','zona_2','zona_3','zona_4') THEN
        RAISE EXCEPTION 'Zona asal tidak valid';
    END IF;
    UPDATE public.master_relawan
    SET zona_asal = v_zona,
        kategori_wilayah = CASE
            WHEN v_zona = 'zona_4' THEN 'zona_4'
            WHEN kategori_wilayah = 'zona_4' THEN 'luar_jombang'
            ELSE kategori_wilayah
        END
    WHERE nip = p_target_nip;

    UPDATE public.riwayat_merge_personel r
    SET hasil_master = (SELECT to_jsonb(m) FROM public.master_relawan m WHERE m.nip = p_target_nip),
        hasil_seragam = coalesce((SELECT jsonb_agg(to_jsonb(sp) ORDER BY sp.nip) FROM public.seragam_penerima sp WHERE sp.nip = p_target_nip), '[]'::jsonb),
        hasil_historis_ids = coalesce((SELECT jsonb_agg(h.id ORDER BY h.id) FROM public.kehadiran_historis h WHERE h.nip = p_target_nip), '[]'::jsonb),
        hasil_merge = v_result
    WHERE r.id = v_batch_id;

    RETURN v_result || jsonb_build_object('batch_id', v_batch_id, 'dapat_dipisahkan', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.pisahkan_merge_personel(p_batch_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch public.riwayat_merge_personel%ROWTYPE;
    v_current_master jsonb;
    v_current_seragam jsonb;
BEGIN
    IF NOT public.fase13_admin() THEN
        RAISE EXCEPTION 'Hanya admin yang boleh memisahkan hasil merge';
    END IF;

    SELECT * INTO v_batch
    FROM public.riwayat_merge_personel
    WHERE id = p_batch_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Riwayat merge tidak ditemukan'; END IF;
    IF v_batch.status <> 'aktif' THEN RAISE EXCEPTION 'Batch ini sudah pernah dipisahkan'; END IF;

    IF EXISTS (
        SELECT 1 FROM public.riwayat_merge_personel newer
        WHERE newer.id > v_batch.id
          AND newer.status = 'aktif'
          AND newer.anggota_nip && v_batch.anggota_nip
    ) THEN
        RAISE EXCEPTION 'Pisahkan merge terbaru yang terkait dengan profil ini terlebih dahulu';
    END IF;

    SELECT to_jsonb(m) INTO v_current_master
    FROM public.master_relawan m WHERE m.nip = v_batch.target_nip;
    IF v_current_master IS DISTINCT FROM v_batch.hasil_master THEN
        RAISE EXCEPTION 'Profil utama telah diedit setelah merge. Samakan atau tinjau perubahan profil sebelum memisahkan';
    END IF;

    SELECT coalesce(jsonb_agg(to_jsonb(sp) ORDER BY sp.nip), '[]'::jsonb)
    INTO v_current_seragam
    FROM public.seragam_penerima sp
    WHERE sp.nip = v_batch.target_nip;
    IF v_current_seragam IS DISTINCT FROM v_batch.hasil_seragam THEN
        RAISE EXCEPTION 'Data seragam berubah setelah merge. Tinjau data seragam sebelum memisahkan';
    END IF;

    -- Hanya baris yang sudah ada saat merge yang dipulihkan. Absensi baru setelah
    -- merge tetap berada pada profil utama dan tidak ikut terhapus.
    DELETE FROM public.log_absensi
    WHERE id IN (
        SELECT id FROM jsonb_populate_recordset(NULL::public.log_absensi, v_batch.snapshot_log)
    );
    INSERT INTO public.log_absensi
    SELECT * FROM jsonb_populate_recordset(NULL::public.log_absensi, v_batch.snapshot_log);

    DELETE FROM public.kehadiran_historis
    WHERE id IN (
        SELECT value::text::bigint FROM jsonb_array_elements(v_batch.hasil_historis_ids)
    ) OR id IN (
        SELECT id FROM jsonb_populate_recordset(NULL::public.kehadiran_historis, v_batch.snapshot_historis)
    );
    INSERT INTO public.kehadiran_historis
    SELECT * FROM jsonb_populate_recordset(NULL::public.kehadiran_historis, v_batch.snapshot_historis);

    DELETE FROM public.koreksi_kehadiran_batch
    WHERE id IN (
        SELECT id FROM jsonb_populate_recordset(NULL::public.koreksi_kehadiran_batch, v_batch.snapshot_koreksi)
    );
    INSERT INTO public.koreksi_kehadiran_batch
    SELECT * FROM jsonb_populate_recordset(NULL::public.koreksi_kehadiran_batch, v_batch.snapshot_koreksi);

    DELETE FROM public.mutasi_stok_seragam
    WHERE id IN (
        SELECT id FROM jsonb_populate_recordset(NULL::public.mutasi_stok_seragam, v_batch.snapshot_mutasi)
    );
    INSERT INTO public.mutasi_stok_seragam
    SELECT * FROM jsonb_populate_recordset(NULL::public.mutasi_stok_seragam, v_batch.snapshot_mutasi);

    DELETE FROM public.seragam_riwayat
    WHERE id IN (
        SELECT id FROM jsonb_populate_recordset(NULL::public.seragam_riwayat, v_batch.snapshot_seragam_riwayat)
    );
    INSERT INTO public.seragam_riwayat
    SELECT * FROM jsonb_populate_recordset(NULL::public.seragam_riwayat, v_batch.snapshot_seragam_riwayat);

    DELETE FROM public.seragam_penerima WHERE nip = ANY(v_batch.anggota_nip);
    INSERT INTO public.seragam_penerima
    SELECT * FROM jsonb_populate_recordset(NULL::public.seragam_penerima, v_batch.snapshot_seragam);

    DELETE FROM public.master_relawan WHERE nip = ANY(v_batch.anggota_nip);
    INSERT INTO public.master_relawan
    SELECT * FROM jsonb_populate_recordset(NULL::public.master_relawan, v_batch.snapshot_master);

    UPDATE public.riwayat_merge_personel
    SET status = 'dipisahkan', dipisahkan_pada = now(), dipisahkan_oleh = auth.uid()
    WHERE id = v_batch.id;

    RETURN jsonb_build_object(
        'batch_id', v_batch.id,
        'profil_dipulihkan', v_batch.jumlah_profil,
        'target_nip', v_batch.target_nip
    );
END;
$$;

-- -----------------------------------------------------------------
-- C. KELOLA ORGANISASI: tambah, edit, hapus aman, dan merge
-- -----------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_organisasi_admin
WITH (security_invoker = true)
AS
SELECT
    o.organisasi_key,
    o.organisasi_asli,
    o.kabupaten,
    o.provinsi,
    o.zona_asal,
    o.catatan,
    o.aktif,
    o.updated_at,
    count(m.nip)::integer AS jumlah_personel
FROM public.organisasi_kabupaten_map o
LEFT JOIN public.master_relawan m
  ON public.normalisasi_label(m.asal_organisasi) = o.organisasi_key
GROUP BY o.organisasi_key, o.organisasi_asli, o.kabupaten, o.provinsi,
         o.zona_asal, o.catatan, o.aktif, o.updated_at;

GRANT SELECT ON public.v_organisasi_admin TO authenticated;

CREATE OR REPLACE FUNCTION public.simpan_organisasi(
    p_key_lama text,
    p_nama text,
    p_kabupaten text,
    p_provinsi text,
    p_zona_asal text,
    p_catatan text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_key_lama text := nullif(public.normalisasi_label(p_key_lama), '');
    v_key_baru text := nullif(public.normalisasi_label(p_nama), '');
    v_nama text := nullif(public.normalisasi_label(p_nama), '');
    v_kabupaten text := nullif(public.normalisasi_label(p_kabupaten), '');
    v_provinsi text := nullif(public.normalisasi_label(p_provinsi), '');
    v_zona text := coalesce(nullif(trim(p_zona_asal), ''), public.zona_dari_provinsi(p_provinsi));
BEGIN
    IF NOT public.fase13_admin() THEN
        RAISE EXCEPTION 'Hanya admin yang boleh mengubah organisasi';
    END IF;
    IF v_key_baru IS NULL OR v_kabupaten IS NULL THEN
        RAISE EXCEPTION 'Nama organisasi dan kabupaten/kota wajib diisi';
    END IF;
    IF v_zona IS NOT NULL AND v_zona NOT IN ('zona_1','zona_2','zona_3','zona_4') THEN
        RAISE EXCEPTION 'Zona asal tidak valid';
    END IF;
    IF v_key_lama IS NOT NULL AND v_key_lama <> v_key_baru
       AND EXISTS (SELECT 1 FROM public.organisasi_kabupaten_map WHERE organisasi_key = v_key_baru) THEN
        RAISE EXCEPTION 'Nama organisasi tujuan sudah ada. Gunakan fitur Merge Organisasi';
    END IF;

    INSERT INTO public.organisasi_kabupaten_map
        (organisasi_key, organisasi_asli, kabupaten, provinsi, zona_asal, catatan, aktif, updated_at)
    VALUES (v_key_baru, v_nama, v_kabupaten, v_provinsi, v_zona, nullif(trim(p_catatan), ''), true, now())
    ON CONFLICT (organisasi_key) DO UPDATE SET
        organisasi_asli = EXCLUDED.organisasi_asli,
        kabupaten = EXCLUDED.kabupaten,
        provinsi = EXCLUDED.provinsi,
        zona_asal = EXCLUDED.zona_asal,
        catatan = EXCLUDED.catatan,
        aktif = true,
        updated_at = now();

    IF v_key_lama IS NOT NULL THEN
        UPDATE public.master_relawan
        SET asal_organisasi = v_nama,
            kabupaten_normalisasi = v_kabupaten,
            zona_asal = v_zona,
            kategori_wilayah = CASE
                WHEN v_zona = 'zona_4' THEN 'zona_4'
                WHEN kategori_wilayah = 'zona_4' THEN 'luar_jombang'
                ELSE kategori_wilayah
            END
        WHERE public.normalisasi_label(asal_organisasi) = v_key_lama;

        UPDATE public.log_absensi
        SET organisasi = v_nama
        WHERE public.normalisasi_label(organisasi) = v_key_lama;

        IF v_key_lama <> v_key_baru THEN
            DELETE FROM public.organisasi_kabupaten_map WHERE organisasi_key = v_key_lama;
        END IF;
    END IF;

    RETURN jsonb_build_object('organisasi_key', v_key_baru, 'nama', v_nama, 'zona_asal', v_zona);
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_organisasi(
    p_source_keys text[],
    p_target_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sources text[];
    v_target public.organisasi_kabupaten_map%ROWTYPE;
    v_personel integer;
BEGIN
    IF NOT public.fase13_admin() THEN
        RAISE EXCEPTION 'Hanya admin yang boleh melakukan merge organisasi';
    END IF;

    SELECT array_agg(DISTINCT public.normalisasi_label(value)) INTO v_sources
    FROM unnest(coalesce(p_source_keys, ARRAY[]::text[])) item(value)
    WHERE nullif(public.normalisasi_label(value), '') IS NOT NULL;
    SELECT * INTO v_target FROM public.organisasi_kabupaten_map
    WHERE organisasi_key = public.normalisasi_label(p_target_key);
    IF NOT FOUND THEN RAISE EXCEPTION 'Organisasi tujuan tidak ditemukan'; END IF;
    IF coalesce(array_length(v_sources, 1), 0) < 2 OR NOT (v_target.organisasi_key = ANY(v_sources)) THEN
        RAISE EXCEPTION 'Pilih sedikitnya dua organisasi dan tentukan salah satunya sebagai tujuan';
    END IF;

    UPDATE public.master_relawan
    SET asal_organisasi = v_target.organisasi_asli,
        kabupaten_normalisasi = v_target.kabupaten,
        zona_asal = v_target.zona_asal,
        kategori_wilayah = CASE
            WHEN v_target.zona_asal = 'zona_4' THEN 'zona_4'
            WHEN kategori_wilayah = 'zona_4' THEN 'luar_jombang'
            ELSE kategori_wilayah
        END
    WHERE public.normalisasi_label(asal_organisasi) = ANY(v_sources);
    GET DIAGNOSTICS v_personel = ROW_COUNT;

    UPDATE public.log_absensi
    SET organisasi = v_target.organisasi_asli
    WHERE public.normalisasi_label(organisasi) = ANY(v_sources);

    DELETE FROM public.organisasi_kabupaten_map
    WHERE organisasi_key = ANY(v_sources)
      AND organisasi_key <> v_target.organisasi_key;

    RETURN jsonb_build_object('target', v_target.organisasi_asli, 'personel_diperbarui', v_personel);
END;
$$;

CREATE OR REPLACE FUNCTION public.hapus_organisasi(p_organisasi_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_key text := public.normalisasi_label(p_organisasi_key);
    v_count integer;
BEGIN
    IF NOT public.fase13_admin() THEN
        RAISE EXCEPTION 'Hanya admin yang boleh menghapus organisasi';
    END IF;
    SELECT count(*) INTO v_count FROM public.master_relawan
    WHERE public.normalisasi_label(asal_organisasi) = v_key;
    IF v_count > 0 THEN
        RAISE EXCEPTION 'Organisasi masih dipakai oleh % personel. Merge atau pindahkan personelnya terlebih dahulu', v_count;
    END IF;
    DELETE FROM public.organisasi_kabupaten_map WHERE organisasi_key = v_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'Organisasi tidak ditemukan'; END IF;
    RETURN jsonb_build_object('dihapus', v_key);
END;
$$;

-- -----------------------------------------------------------------
-- D. MERGE SELURUH JARINGAN NAMA MIRIP YANG TERSISA
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nama_mirip_satu(p_kiri text, p_kanan text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    a text := public.normalisasi_identitas(p_kiri);
    b text := public.normalisasi_identitas(p_kanan);
    i integer := 1;
    j integer := 1;
    beda integer := 0;
BEGIN
    IF a = '' OR b = '' OR a = b OR abs(length(a) - length(b)) > 1 THEN RETURN false; END IF;
    WHILE i <= length(a) AND j <= length(b) LOOP
        IF substr(a, i, 1) = substr(b, j, 1) THEN i := i + 1; j := j + 1;
        ELSE
            beda := beda + 1;
            IF beda > 1 THEN RETURN false; END IF;
            IF length(a) > length(b) THEN i := i + 1;
            ELSIF length(b) > length(a) THEN j := j + 1;
            ELSE i := i + 1; j := j + 1;
            END IF;
        END IF;
    END LOOP;
    IF i <= length(a) OR j <= length(b) THEN beda := beda + 1; END IF;
    RETURN beda = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.gabungkan_semua_kandidat_mirip()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_component record;
    v_target public.master_relawan%ROWTYPE;
    v_result jsonb;
    v_batches integer := 0;
    v_sources integer := 0;
    v_uniform integer;
BEGIN
    IF NOT public.fase13_admin() THEN
        RAISE EXCEPTION 'Hanya admin yang boleh melakukan merge massal';
    END IF;

    CREATE TEMP TABLE fase13_edges ON COMMIT DROP AS
    WITH base AS (
        SELECT m.nip,
               coalesce(nullif(public.normalisasi_label(m.kabupaten_normalisasi), ''),
                        public.kabupaten_dari_organisasi(m.asal_organisasi),
                        nullif(public.normalisasi_label(m.asal_daerah), '')) AS kabupaten
        FROM public.master_relawan m
    )
    SELECT a.nip AS src, b.nip AS dst
    FROM base a JOIN base b ON a.nip < b.nip AND a.kabupaten = b.kabupaten
    JOIN public.master_relawan ma ON ma.nip = a.nip
    JOIN public.master_relawan mb ON mb.nip = b.nip
    WHERE a.kabupaten IS NOT NULL
      AND public.nama_mirip_satu(ma.nama, mb.nama);

    CREATE TEMP TABLE fase13_components ON COMMIT DROP AS
    WITH RECURSIVE edges AS (
        SELECT src, dst FROM fase13_edges
        UNION ALL SELECT dst, src FROM fase13_edges
    ), reach(root, node) AS (
        SELECT src, src FROM edges
        UNION
        SELECT r.root, e.dst FROM reach r JOIN edges e ON e.src = r.node
    ), membership AS (
        SELECT node, min(root) AS component FROM reach GROUP BY node
    )
    SELECT component, array_agg(node ORDER BY node) AS nips
    FROM membership GROUP BY component;

    FOR v_component IN SELECT * FROM fase13_components ORDER BY component LOOP
        SELECT count(*) INTO v_uniform FROM public.seragam_penerima
        WHERE nip = ANY(v_component.nips);
        IF v_uniform > 1 THEN
            RAISE EXCEPTION 'Merge seluruh kandidat dihentikan: jaringan % memiliki % data seragam. Rapikan data seragam terlebih dahulu', v_component.component, v_uniform;
        END IF;

        SELECT m.* INTO v_target
        FROM public.master_relawan m
        LEFT JOIN public.v_ringkasan_personel r ON r.nip = m.nip
        WHERE m.nip = ANY(v_component.nips)
        ORDER BY coalesce(r.persentase_hari, 0) DESC,
                 coalesce(r.total_hari, 0) DESC,
                 coalesce(r.total_sesi, 0) DESC,
                 ((nullif(trim(m.asal_daerah), '') IS NOT NULL)::integer
                  + (nullif(trim(m.kabupaten_normalisasi), '') IS NOT NULL)::integer
                  + (m.zona_asal IS NOT NULL)::integer) DESC,
                 m.created_at NULLS LAST,
                 m.nip
        LIMIT 1;

        v_result := public.merge_relawan_tercatat(
            v_component.nips,
            v_target.nip,
            jsonb_build_object(
                'nama', v_target.nama,
                'asal_organisasi', v_target.asal_organisasi,
                'jabatan', v_target.jabatan,
                'asal_daerah', v_target.asal_daerah,
                'kabupaten_normalisasi', v_target.kabupaten_normalisasi,
                'kategori_wilayah', v_target.kategori_wilayah,
                'zona_asal', v_target.zona_asal,
                'ukuran_seragam', v_target.ukuran_seragam,
                'catatan_seragam', v_target.catatan_seragam
            ),
            'Merge seluruh kandidat nama mirip dalam kabupaten yang sama'
        );
        v_batches := v_batches + 1;
        v_sources := v_sources + array_length(v_component.nips, 1) - 1;
    END LOOP;

    RETURN jsonb_build_object(
        'jaringan_digabung', v_batches,
        'profil_sumber_digabung', v_sources,
        'pasangan_kandidat_awal', (SELECT count(*) FROM fase13_edges)
    );
END;
$$;

-- Ringkasan Master ditambah zona_asal agar UI tidak perlu query kedua.
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
       m.zona_asal
FROM public.master_relawan m
CROSS JOIN program pr
LEFT JOIN per_person p ON p.nip = m.nip
LEFT JOIN historis h ON h.nip = m.nip;

REVOKE ALL ON FUNCTION public.merge_relawan_tercatat(text[],text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fase13_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pisahkan_merge_personel(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.simpan_organisasi(text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_organisasi(text[],text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hapus_organisasi(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gabungkan_semua_kandidat_mirip() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_relawan_tercatat(text[],text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fase13_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pisahkan_merge_personel(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.simpan_organisasi(text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_organisasi(text[],text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hapus_organisasi(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gabungkan_semua_kandidat_mirip() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT
    (SELECT count(*) FROM public.v_organisasi_admin) AS organisasi,
    (SELECT count(*) FROM public.master_relawan WHERE zona_asal IS NOT NULL) AS personel_berzona,
    (SELECT count(*) FROM public.riwayat_merge_personel WHERE status = 'aktif') AS merge_dapat_dipisahkan;
