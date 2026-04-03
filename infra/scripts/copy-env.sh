#!/usr/bin/env bash

set -euo pipefail

services=(
  "services/ingest-api"
  "services/context-query-api"
  "services/stream-processor"
  "services/audit-writer"
)

cp ".env.example" ".env"
echo "created .env"

for service in "${services[@]}"; do
  cp "${service}/.env.example" "${service}/.env"
  echo "created ${service}/.env"
done
