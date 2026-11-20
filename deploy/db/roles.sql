-- ============================================================
-- RelawanSync - init Supabase Postgres
-- ------------------------------------------------------------
-- Menyamakan password role internal Supabase dengan
-- POSTGRES_PASSWORD dari deploy/.env. File ini dijalankan
-- otomatis oleh image supabase/postgres saat inisialisasi.
--
-- Jangan jalankan manual di database yang sudah berisi data.
-- ============================================================

\set pgpass `echo "$POSTGRES_PASSWORD"`
\set jwt_exp `echo "${JWT_EXP:-3600}"`

-- Hanya ubah role yang memang ada pada image yang dipakai.
SELECT format('ALTER USER %I WITH PASSWORD %L;', rolname, :'pgpass')
FROM pg_roles
WHERE rolname IN (
    'authenticator',
    'pgbouncer',
    'supabase_auth_admin',
    'supabase_functions_admin',
    'supabase_storage_admin'
)
\gexec

-- Dipakai GoTrue/PostgREST untuk menghitung masa berlaku token.
SELECT format('ALTER DATABASE %I SET "app.settings.jwt_exp" TO %L;', current_database(), :'jwt_exp')
\gexec
