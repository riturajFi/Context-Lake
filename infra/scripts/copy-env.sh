#!/usr/bin/env bash

set -euo pipefail

services=(
  "services/ingest-api"
  "services/context-query-api"
  "services/stream-processor"
  "services/audit-writer"
)

for service in "${services[@]}"; do
  cp "${service}/.env.example" "${service}/.env"
  echo "created ${service}/.env"
done
