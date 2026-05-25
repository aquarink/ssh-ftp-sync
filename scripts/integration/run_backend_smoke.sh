#!/usr/bin/env bash
set -eu
API_BASE="http://127.0.0.1:8790"
echo "Vault health:"
curl -sS -X GET "$API_BASE/api/security/vault-health" | jq || true

echo "\nNote: Identity test and SFTP smoke are templates in README.md — replace endpoints and IDs as needed."
