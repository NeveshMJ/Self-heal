#!/usr/bin/env bash
# Self-signed certificate for local HTTPS testing.
# For anything real, use certbot or your organisation's CA and drop
# fullchain.pem / privkey.pem into ./certs.
set -euo pipefail

mkdir -p certs
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout certs/privkey.pem \
  -out certs/fullchain.pem \
  -subj "/C=IN/ST=Tamil Nadu/L=Chennai/O=Self-Healing Controller/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

chmod 600 certs/privkey.pem
echo "Wrote certs/fullchain.pem and certs/privkey.pem (self-signed, 365 days)."
echo "Browsers will warn about the self-signed certificate - that is expected."
