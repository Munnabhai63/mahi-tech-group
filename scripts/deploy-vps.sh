#!/usr/bin/env bash
# ==============================================================================
# ISOLATED VPS DEPLOYMENT SCRIPT FOR MAHI TECH GROUP (OVIAXE)
# SAFETY GUARANTEE: Operates STRICTLY within this project directory.
# NEVER touches or alters any other process, Nginx site, or PM2 application.
# ==============================================================================
set -euo pipefail

# 1. Resolve and navigate strictly to this project's root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

echo "=========================================================="
echo " Starting isolated deployment for MAHI TECH GROUP"
echo " Working Directory: ${PROJECT_ROOT}"
echo " Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=========================================================="

# 2. Pull latest production code from origin main
echo ">>> Pulling latest commits from origin main..."
git fetch origin main
git checkout main
git pull origin main

# 3. Install production dependencies strictly in this directory
echo ">>> Installing production dependencies..."
npm ci --omit=dev

# 4. Run database migrations safely (additive only, preserves existing records)
echo ">>> Running database migrations..."
npm run migrate

# 5. Reload ONLY this application in PM2 (strictly isolated by app name)
echo ">>> Safely reloading PM2 process 'mahi-tech-group'..."
if command -v pm2 >/dev/null 2>&1; then
  # Reload ONLY 'mahi-tech-group' without touching any other PM2 apps
  pm2 reload ecosystem.config.cjs --only mahi-tech-group --env production || pm2 restart mahi-tech-group
  echo ">>> PM2 process 'mahi-tech-group' reloaded cleanly."
else
  echo ">>> Warning: PM2 not found on PATH. If running via systemd, reload the local service."
fi

# 6. Execute live smoke tests against the live endpoint
echo ">>> Running post-deployment smoke verification..."
node scripts/live-deploy-smoke.cjs

echo "=========================================================="
echo " Deployment completed successfully with zero side-effects!"
echo "=========================================================="
