#!/usr/bin/env bash
set -euo pipefail

# Generate a Tauri v2 updater minisign keypair, write the public key into
# src-tauri/tauri.conf.json, and optionally upload TAURI_SIGNING_PRIVATE_KEY
# to GitHub Actions secrets via `gh secret set`.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TAURI_CONF="${ROOT_DIR}/src-tauri/tauri.conf.json"

APPLY_REPO=""
PASSWORD=""
KEY_OUT="${HOME}/.tauri/pve-center-updater.key"

usage() {
  cat <<'EOF'
Usage: ./scripts/setup-updater-keys.sh [OPTIONS]

Generates a Tauri v2 updater signing keypair (outside the git repository),
updates plugins.updater.pubkey in src-tauri/tauri.conf.json, and optionally
uploads TAURI_SIGNING_PRIVATE_KEY to GitHub Actions secrets.

Options:
  --key-path <PATH>     Output path for private key (default: ~/.tauri/pve-center-updater.key)
  --password <PASS>     Optional password protecting the private key
  --apply-gh <REPO>     Upload secrets directly via GitHub CLI (e.g. PVE-Center/pve-center-clients)
  -h, --help            Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --key-path)
      KEY_OUT="$2"
      shift 2
      ;;
    --password)
      PASSWORD="$2"
      shift 2
      ;;
    --apply-gh)
      APPLY_REPO="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

mkdir -p "$(dirname "${KEY_OUT}")"

SIGNER_ARGS=(tauri signer generate --ci -w "${KEY_OUT}" -f)
if [[ -n "${PASSWORD}" ]]; then
  SIGNER_ARGS+=(-p "${PASSWORD}")
fi

(cd "${ROOT_DIR}" && npx "${SIGNER_ARGS[@]}")

PUB_PATH="${KEY_OUT}.pub"
if [[ ! -f "${PUB_PATH}" || ! -f "${KEY_OUT}" ]]; then
  echo "Error: signer failed to create ${KEY_OUT} and ${PUB_PATH}" >&2
  exit 1
fi

PUBKEY_B64="$(tr -d '\r\n' < "${PUB_PATH}")"

python3 - "${TAURI_CONF}" "${PUBKEY_B64}" <<'PY'
import json, sys

conf_path, pubkey = sys.argv[1], sys.argv[2]
with open(conf_path, "r", encoding="utf-8") as f:
    data = json.load(f)

data.setdefault("plugins", {}).setdefault("updater", {})["pubkey"] = pubkey

with open(conf_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY

echo "Updated plugins.updater.pubkey in ${TAURI_CONF}"
echo "Private key saved OUTSIDE repo at: ${KEY_OUT}"

if [[ -n "${APPLY_REPO}" ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "Error: GitHub CLI (gh) not found. Install gh or set secrets manually." >&2
    exit 1
  fi
  gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "${APPLY_REPO}" < "${KEY_OUT}"
  if [[ -n "${PASSWORD}" ]]; then
    printf '%s' "${PASSWORD}" | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "${APPLY_REPO}"
  fi
  echo "Uploaded updater secrets to ${APPLY_REPO}."
else
  cat <<EOF

Next step: add the following GitHub Actions secret(s) on your repository:
  TAURI_SIGNING_PRIVATE_KEY          <- contents of ${KEY_OUT}
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD <- optional passphrase (if set)

Never commit ${KEY_OUT} to Git.
EOF
fi
