-- =====================================================================
-- RELAWANSYNC V2 - FASE 18: PENERAPAN ZONA OTOMATIS
-- =====================================================================
-- Zona 1: Jawa Timur dan Bali
-- Zona 2: Jawa Tengah dan DI Yogyakarta
-- Zona 3: Jawa Barat, DKI Jakarta, dan Banten
-- Zona 4: Sumatera dan Kalimantan
--
-- Migrasi ini hanya mengisi zona yang masih kosong. Zona yang telah dipilih
-- admin tidak ditimpa. Organisasi yang tidak memiliki petunjuk geografis
-- (misalnya IKHWAN 4 atau MQ 13) tetap dibiarkan untuk dilengkapi manual.
-- Jalankan setelah Fase 17.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.provinsi_dari_daerah(p_nilai text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v text := public.normalisasi_label(coalesce(p_nilai, ''));
BEGIN
    IF v = '' OR v = 'BELUM DIISI' THEN RETURN NULL; END IF;

    -- Jawa Timur dan Madura.
    IF v ~ '(^| )(MALANG|BOJONEGORO|SURABAYA|KEDIRI|TUBAN|BLITAR|MAGETAN|NGANJUK|SIDOARJO|LAMONGAN|MADIUN|PROBOLINGGO|GRESIK|PASURUAN|JEMBER|TULUNGAGUNG|LUMAJANG|PACITAN|PONOROGO|BANYUWANGI|NGAWI|BATU|MOJOKERTO|JOMBANG|MADURA|BANGKALAN|SAMPANG|PAMEKASAN|SUMENEP)( |$)' THEN
        RETURN 'JAWA TIMUR';
    END IF;
    IF v ~ '(^| )(DENPASAR|BADUNG|GIANYAR|TABANAN|BULELENG|JEMBRANA|KLUNGKUNG|BANGLI|KARANGASEM|BALI)( |$)' THEN
        RETURN 'BALI';
    END IF;

    -- DI Yogyakarta harus diperiksa sebelum Jawa Tengah.
    IF v ~ '(^| )(YOGYAKARTA|JOGJA|GUNUNGKIDUL|KULON PROGO|SLEMAN|BANTUL|DIY)( |$)' THEN
        RETURN 'DI YOGYAKARTA';
    END IF;
    IF v ~ '(^| )(SALATIGA|PEKALONGAN|SEMARANG|GROBOGAN|PURWODADI|KLATEN|PEMALANG|DEMAK|JEPARA|BLORA|KENDAL|PATI|WONOGIRI|BOYOLALI|KUDUS|PURWOKERTO|BANYUMAS|REMBANG|SOLO|SURAKARTA|SRAGEN|SUKOHARJO|KARANGANYAR|TEMANGGUNG|MAGELANG|WONOSOBO|PURBALINGGA|CILACAP|BANJARNEGARA|BATANG|BREBES|TEGAL|KEBUMEN)( |$)' THEN
        RETURN 'JAWA TENGAH';
    END IF;

    IF v ~ '(^| )(JAKARTA)( |$)' THEN RETURN 'DKI JAKARTA'; END IF;
    IF v ~ '(^| )(BANTEN|TANGERANG|SERANG|CILEGON|LEBAK|PANDEGLANG)( |$)' THEN RETURN 'BANTEN'; END IF;
    IF v ~ '(^| )(KARAWANG|BEKASI|DEPOK|BOGOR|BANDUNG|PURWAKARTA|CIREBON|SUKABUMI|CIANJUR|GARUT|TASIKMALAYA|CIAMIS|PANGANDARAN|SUBANG|INDRAMAYU|SUMEDANG|KUNINGAN|MAJALENGKA|CIMAHI|BANJAR)( |$)' THEN
        RETURN 'JAWA BARAT';
    END IF;

    -- Sumatera.
    IF v ~ '(^| )(ACEH|BANDA ACEH|LHOKSEUMAWE|LANGSA|SABANG)( |$)' THEN RETURN 'ACEH'; END IF;
    IF v ~ '(^| )(SUMATERA UTARA|MEDAN|BINJAI|PEMATANGSIANTAR|DELI SERDANG)( |$)' THEN RETURN 'SUMATERA UTARA'; END IF;
    IF v ~ '(^| )(SUMATERA BARAT|PADANG|BUKITTINGGI|PAYAKUMBUH)( |$)' THEN RETURN 'SUMATERA BARAT'; END IF;
    IF v ~ '(^| )(KEPULAUAN RIAU|BATAM|TANJUNGPINANG)( |$)' THEN RETURN 'KEPULAUAN RIAU'; END IF;
    IF v ~ '(^| )(RIAU|PEKANBARU|DUMAI|KUANSING|KUANTAN SINGINGI)( |$)' THEN RETURN 'RIAU'; END IF;
    IF v ~ '(^| )(JAMBI)( |$)' THEN RETURN 'JAMBI'; END IF;
    IF v ~ '(^| )(SUMATERA SELATAN|PALEMBANG|BANYUASIN|OGAN KOMERING|OKU|PRABUMULIH|LUBUKLINGGAU)( |$)' THEN RETURN 'SUMATERA SELATAN'; END IF;
    IF v ~ '(^| )(BANGKA BELITUNG|PANGKALPINANG|BELITUNG)( |$)' THEN RETURN 'KEPULAUAN BANGKA BELITUNG'; END IF;
    IF v ~ '(^| )(BENGKULU)( |$)' THEN RETURN 'BENGKULU'; END IF;
    IF v ~ '(^| )(LAMPUNG|BANDAR LAMPUNG|METRO|TANGGAMUS)( |$)' THEN RETURN 'LAMPUNG'; END IF;

    -- Kalimantan.
    IF v ~ '(^| )(KALIMANTAN BARAT|PONTIANAK|SINGKAWANG)( |$)' THEN RETURN 'KALIMANTAN BARAT'; END IF;
    IF v ~ '(^| )(KALIMANTAN TENGAH|PALANGKARAYA|PALANGKA RAYA)( |$)' THEN RETURN 'KALIMANTAN TENGAH'; END IF;
    IF v ~ '(^| )(KALIMANTAN SELATAN|BANJARMASIN|BANJARBARU)( |$)' THEN RETURN 'KALIMANTAN SELATAN'; END IF;
    IF v ~ '(^| )(KALIMANTAN TIMUR|BALIKPAPAN|SAMARINDA|BONTANG)( |$)' THEN RETURN 'KALIMANTAN TIMUR'; END IF;
    IF v ~ '(^| )(KALIMANTAN UTARA|TARAKAN)( |$)' THEN RETURN 'KALIMANTAN UTARA'; END IF;

    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.zona_otomatis_dari_daerah(
    p_kabupaten text,
    p_organisasi text DEFAULT NULL,
    p_provinsi text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_gabungan text := public.normalisasi_label(concat_ws(' ', p_kabupaten, p_organisasi));
    v_provinsi text := coalesce(
        nullif(public.normalisasi_label(p_provinsi), ''),
        public.provinsi_dari_daerah(p_kabupaten),
        public.provinsi_dari_daerah(p_organisasi)
    );
    v_zona text;
BEGIN
    v_zona := public.zona_dari_provinsi(v_provinsi);
    IF v_zona IS NOT NULL THEN RETURN v_zona; END IF;
    IF v_gabungan ~ '(^| )ZONA 1( |$)' THEN RETURN 'zona_1'; END IF;
    IF v_gabungan ~ '(^| )ZONA 2( |$)' THEN RETURN 'zona_2'; END IF;
    IF v_gabungan ~ '(^| )ZONA 3( |$)' THEN RETURN 'zona_3'; END IF;
    IF v_gabungan ~ '(^| )ZONA 4( |$)' THEN RETURN 'zona_4'; END IF;
    IF v_gabungan ~ '(^| )(SUMATERA|KALIMANTAN)( |$)' THEN RETURN 'zona_4'; END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.terapkan_zona_organisasi_otomatis()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF nullif(trim(coalesce(NEW.provinsi, '')), '') IS NULL THEN
        NEW.provinsi := coalesce(
            public.provinsi_dari_daerah(NEW.kabupaten),
            public.provinsi_dari_daerah(NEW.organisasi_asli)
        );
    END IF;
    IF NEW.zona_asal IS NULL THEN
        NEW.zona_asal := public.zona_otomatis_dari_daerah(NEW.kabupaten, NEW.organisasi_asli, NEW.provinsi);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organisasi_zona_otomatis ON public.organisasi_kabupaten_map;
CREATE TRIGGER trg_organisasi_zona_otomatis
BEFORE INSERT OR UPDATE OF organisasi_asli, kabupaten, provinsi, zona_asal
ON public.organisasi_kabupaten_map
FOR EACH ROW EXECUTE FUNCTION public.terapkan_zona_organisasi_otomatis();

CREATE OR REPLACE FUNCTION public.terapkan_zona_personel_otomatis()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_zona_map text;
    v_zona text;
BEGIN
    SELECT o.zona_asal INTO v_zona_map
    FROM public.organisasi_kabupaten_map o
    WHERE o.organisasi_key = public.normalisasi_label(NEW.asal_organisasi)
      AND o.aktif
    LIMIT 1;

    v_zona := coalesce(
        NEW.zona_asal,
        v_zona_map,
        public.zona_otomatis_dari_daerah(
            coalesce(NEW.kabupaten_normalisasi, NEW.asal_daerah),
            NEW.asal_organisasi,
            NULL
        )
    );
    NEW.zona_asal := v_zona;
    IF v_zona = 'zona_4' THEN
        NEW.kategori_wilayah := 'zona_4';
    ELSIF v_zona IS NOT NULL AND NEW.kategori_wilayah = 'zona_4' THEN
        NEW.kategori_wilayah := 'luar_jombang';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_personel_zona_otomatis ON public.master_relawan;
CREATE TRIGGER trg_personel_zona_otomatis
BEFORE INSERT OR UPDATE OF asal_organisasi, asal_daerah, kabupaten_normalisasi, zona_asal
ON public.master_relawan
FOR EACH ROW EXECUTE FUNCTION public.terapkan_zona_personel_otomatis();

CREATE OR REPLACE FUNCTION public.sinkronkan_zona_otomatis()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org integer := 0;
    v_personel_map integer := 0;
    v_personel_langsung integer := 0;
    v_belum integer := 0;
BEGIN
    IF NOT public.fase13_admin() THEN
        RAISE EXCEPTION 'Hanya admin yang boleh menyinkronkan zona';
    END IF;

    WITH inferred AS (
        SELECT
            o.organisasi_key,
            coalesce(
                nullif(public.normalisasi_label(o.provinsi), ''),
                public.provinsi_dari_daerah(o.kabupaten),
                public.provinsi_dari_daerah(o.organisasi_asli)
            ) AS provinsi_baru,
            coalesce(
                o.zona_asal,
                public.zona_otomatis_dari_daerah(o.kabupaten, o.organisasi_asli, o.provinsi)
            ) AS zona_baru
        FROM public.organisasi_kabupaten_map o
    )
    UPDATE public.organisasi_kabupaten_map o
    SET provinsi = i.provinsi_baru,
        zona_asal = i.zona_baru,
        updated_at = now()
    FROM inferred i
    WHERE i.organisasi_key = o.organisasi_key
      AND ((o.provinsi IS NULL AND i.provinsi_baru IS NOT NULL)
        OR (o.zona_asal IS NULL AND i.zona_baru IS NOT NULL));
    GET DIAGNOSTICS v_org = ROW_COUNT;

    UPDATE public.master_relawan m
    SET kabupaten_normalisasi = CASE
            WHEN nullif(public.normalisasi_label(m.kabupaten_normalisasi), '') IS NULL
              OR public.normalisasi_label(m.kabupaten_normalisasi) = 'BELUM DIISI'
            THEN nullif(public.normalisasi_label(o.kabupaten), 'BELUM DIISI')
            ELSE m.kabupaten_normalisasi
        END,
        zona_asal = o.zona_asal,
        kategori_wilayah = CASE
            WHEN o.zona_asal = 'zona_4' THEN 'zona_4'
            WHEN public.normalisasi_label(o.kabupaten) = 'JOMBANG'
              OR public.normalisasi_label(m.asal_organisasi) = 'PUSAT' THEN 'jombang'
            WHEN m.kategori_wilayah IN ('belum_dilengkapi', 'zona_4') THEN 'luar_jombang'
            ELSE m.kategori_wilayah
        END
    FROM public.organisasi_kabupaten_map o
    WHERE m.zona_asal IS NULL
      AND o.zona_asal IS NOT NULL
      AND o.organisasi_key = public.normalisasi_label(m.asal_organisasi);
    GET DIAGNOSTICS v_personel_map = ROW_COUNT;

    WITH inferred AS (
        SELECT m.nip,
               public.zona_otomatis_dari_daerah(
                   coalesce(m.kabupaten_normalisasi, m.asal_daerah),
                   m.asal_organisasi,
                   NULL
               ) AS zona_baru
        FROM public.master_relawan m
        WHERE m.zona_asal IS NULL
    )
    UPDATE public.master_relawan m
    SET zona_asal = i.zona_baru,
        kategori_wilayah = CASE
            WHEN i.zona_baru = 'zona_4' THEN 'zona_4'
            WHEN m.kategori_wilayah = 'zona_4' THEN 'luar_jombang'
            ELSE m.kategori_wilayah
        END
    FROM inferred i
    WHERE i.nip = m.nip AND i.zona_baru IS NOT NULL;
    GET DIAGNOSTICS v_personel_langsung = ROW_COUNT;

    SELECT count(*)::integer INTO v_belum
    FROM public.master_relawan WHERE zona_asal IS NULL;

    RETURN jsonb_build_object(
        'ok', true,
        'organisasi_diperbarui', v_org,
        'personel_diperbarui', v_personel_map + v_personel_langsung,
        'personel_belum_dipetakan', v_belum
    );
END;
$$;

REVOKE ALL ON FUNCTION public.provinsi_dari_daerah(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zona_otomatis_dari_daerah(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.terapkan_zona_organisasi_otomatis() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.terapkan_zona_personel_otomatis() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sinkronkan_zona_otomatis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provinsi_dari_daerah(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zona_otomatis_dari_daerah(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sinkronkan_zona_otomatis() TO authenticated;

-- Terapkan sekali pada data lama. Pengulangan aman karena zona manual tidak ditimpa.
SELECT public.sinkronkan_zona_otomatis();

COMMIT;
NOTIFY pgrst, 'reload schema';

SELECT
    count(*) AS total_personel,
    count(*) FILTER (WHERE zona_asal = 'zona_1') AS zona_1,
    count(*) FILTER (WHERE zona_asal = 'zona_2') AS zona_2,
    count(*) FILTER (WHERE zona_asal = 'zona_3') AS zona_3,
    count(*) FILTER (WHERE zona_asal = 'zona_4') AS zona_4,
    count(*) FILTER (WHERE zona_asal IS NULL) AS belum_dipetakan
FROM public.master_relawan;
