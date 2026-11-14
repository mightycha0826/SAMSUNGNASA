#!/bin/bash
# Self-signed cert for the hub. Extra IPs (e.g. the wired address) as arguments:
#   tools/make_cert.sh 10.1.111.79
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p certs
SAN="IP:10.42.0.1,IP:127.0.0.1,DNS:localhost,DNS:$(hostname).local"
for ip in "$@"; do SAN="$SAN,IP:$ip"; done
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout certs/key.pem -out certs/cert.pem -subj "/CN=marswalk" \
  -addext "subjectAltName=$SAN" 2>/dev/null
chmod 600 certs/key.pem
echo "certs/cert.pem  SAN: $SAN"
