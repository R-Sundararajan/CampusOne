#!/bin/sh
set -eu
cd /app
# Validate runtime inputs before touching the database. No development tools needed.
node --input-type=module -e "import { loadConfig } from './backend/dist/src/config.js'; loadConfig();"
# Prisma records applied migrations; each startup invokes this once, before HTTP.
npm run db:migrate
# Static serving resolves ../frontend/dist from the backend workspace.
cd /app/backend
# Keep Node as PID 1 so the existing SIGTERM handler receives shutdown signals.
exec node dist/src/index.js
