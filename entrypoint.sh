#!/bin/bash
set -e

# Static routes for management reach-back
# These are non-fatal — eth0 may not have an IP yet in some edge cases
ip route add 10.0.2.0/24   via 10.64.254.1 dev eth0 2>/dev/null || true
ip route add 10.77.7.0/24  via 10.64.254.1 dev eth0 2>/dev/null || true
ip route add 10.255.2.0/24 via 10.64.254.1 dev eth0 2>/dev/null || true

exec uvicorn main:app --host 0.0.0.0 --port 8080 --app-dir /app
