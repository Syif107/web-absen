#!/usr/bin/env bash
# ============================================================
# Membuat akun login baru (admin/koordinator) di server kantor.
# ------------------------------------------------------------
# Akun lama hasil migrasi tidak perlu dibuat ulang.
# Gunakan skrip ini untuk petugas/koordinator baru.
#
# Pemakaian (dari server):
#   bash deploy/scripts/buat-akun.sh \
#     --email koordinator@contoh.org \
#     --password 'kata-sandi-kuat' \
#     --nama 'Nama Koordinator' \
#     --role koordinator \
#     --lokasi 'Proyek A'
#
# Admin:
#   bash deploy/scripts/buat-akun.sh --email admin2@contoh.org \
#     --password 'kata-sandi-kuat' --nama 'Admin Dua' --role admin
#
# Dari mesin lain yang ada di tailnet, tambahkan:
#   --base https://pc-kantor.tailxxxx.ts.net
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BASE="http://127.0.0.1:8080"
EMAIL=""
PASSWORD=""
NAMA=""
ROLE=""
LOKASI=""

usage() {
    cat <<'MSG'
Pemakaian:
  bash deploy/scripts/buat-akun.sh \
    --email koordinator@contoh.org \
    --password 'kata-sandi-kuat' \
    --nama 'Nama Koordinator' \
    --role koordinator \
    --lokasi 'Proyek A'

Admin: --role admin (tanpa --lokasi).
Dari mesin lain di tailnet: tambahkan --base https://pc.tailxxxx.ts.net
MSG
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --email) EMAIL="${2:-}"; shift 2 ;;
        --password) PASSWORD="${2:-}"; shift 2 ;;
        --nama) NAMA="${2:-}"; shift 2 ;;
        --role) ROLE="${2:-}"; shift 2 ;;
        --lokasi) LOKASI="${2:-}"; shift 2 ;;
        --base) BASE="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Argumen tidak dikenal: $1"; usage; exit 1 ;;
    esac
done

BASE="${BASE%/}"

if [[ -z "$EMAIL" || -z "$PASSWORD" || -z "$ROLE" ]]; then
    echo "Wajib: --email, --password, --role"
    usage
    exit 1
fi

if [[ "$ROLE" != "admin" && "$ROLE" != "koordinator" ]]; then
    echo "Role harus 'admin' atau 'koordinator'."
    exit 1
fi

if [[ "$ROLE" == "koordinator" && -z "$LOKASI" ]]; then
    echo "Koordinator wajib punya --lokasi (nama proyek)."
    exit 1
fi

if [[ ${#PASSWORD} -lt 6 ]]; then
    echo "Password minimal 6 karakter."
    exit 1
fi

if [[ -z "$NAMA" ]]; then
    NAMA="${EMAIL%%@*}"
fi

if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
    echo "deploy/.env tidak ditemukan."
    exit 1
fi

set -a
# shellcheck disable=SC1091
. "$DEPLOY_DIR/.env"
set +a

if [[ -z "${SERVICE_ROLE_KEY:-}" ]]; then
    echo "SERVICE_ROLE_KEY kosong di deploy/.env. Jalankan generate-keys.mjs --write."
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 dibutuhkan untuk menyusun JSON."
    exit 1
fi

json_user="$(python3 - "$EMAIL" "$PASSWORD" "$NAMA" <<'PY'
import json, sys
email, password, nama = sys.argv[1:4]
print(json.dumps({
    "email": email,
    "password": password,
    "email_confirm": True,
    "user_metadata": {"full_name": nama},
}))
PY
)"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

http="$(curl -sS -o "$tmp" -w '%{http_code}' \
    -X POST "$BASE/auth/v1/admin/users" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$json_user")"
body="$(cat "$tmp")"

if [[ "$http" != "200" && "$http" != "201" ]]; then
    echo "Gagal membuat akun (HTTP $http):"
    echo "$body"
    echo
    echo "Jika email sudah ada, gunakan password reset lewat Admin API atau"
    echo "hapus akun lama lebih dulu. Jangan membuat akun ganda."
    exit 1
fi

user_id="$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))')"
if [[ -z "$user_id" ]]; then
    echo "Akun dibuat tetapi ID tidak terbaca dari respons:"
    echo "$body"
    exit 1
fi

json_profil="$(python3 - "$user_id" "$NAMA" "$ROLE" "$LOKASI" <<'PY'
import json, sys
uid, nama, role, lokasi = sys.argv[1:5]
print(json.dumps({
    "id": uid,
    "nama": nama,
    "role": role,
    "lokasi_proyek": lokasi if lokasi else None,
}))
PY
)"

http2="$(curl -sS -o "$tmp" -w '%{http_code}' \
    -X POST "$BASE/rest/v1/profil?on_conflict=id" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates,return=representation" \
    -d "$json_profil")"
body2="$(cat "$tmp")"

if [[ "$http2" != "200" && "$http2" != "201" ]]; then
    echo "Akun Auth dibuat (id=$user_id), tetapi profil gagal disimpan (HTTP $http2):"
    echo "$body2"
    exit 1
fi

echo "Akun berhasil dibuat."
echo "  email : $EMAIL"
echo "  role  : $ROLE"
if [[ -n "$LOKASI" ]]; then
    echo "  lokasi: $LOKASI"
fi
echo "  id    : $user_id"
echo
echo "Uji login lewat halaman login web absen."
