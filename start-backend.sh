#!/bin/bash
# ─── TrustReply — Start Everything ───────────────────────
# Run: bash "/Users/kutluhanbayram/Desktop/Projects/TRUST REPLY/start-backend.sh"
# Or open a Terminal and run this script. Servers survive closing the window.
# Logs: /tmp/trustreply-backend.log, /tmp/trustreply-frontend.log

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Stopping existing servers..."
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:8000 | xargs kill -9 2>/dev/null
sleep 1

echo "Starting backend (port 8000)..."
cd "$DIR/backend"
nohup ./venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/trustreply-backend.log 2>&1 &
disown

echo "Starting frontend (port 3000)..."
cd "$DIR/frontend"
nohup /opt/homebrew/bin/node node_modules/.bin/next dev > /tmp/trustreply-frontend.log 2>&1 &
disown

echo "Waiting for servers..."

# Poll up to 45s — backend cold-start loads sentence-transformers which is slow.
BACKEND="000"
FRONTEND="000"
for _ in $(seq 1 45); do
    [ "$BACKEND" != "200" ] && BACKEND=$(curl -sS -o /dev/null -w "%{http_code}" http://localhost:8000/api/health 2>/dev/null)
    [ "$FRONTEND" != "200" ] && FRONTEND=$(curl -sS -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null)
    [ "$BACKEND" = "200" ] && [ "$FRONTEND" = "200" ] && break
    sleep 1
done

if [ "$BACKEND" = "200" ]; then
    echo "✅ Backend:  http://localhost:8000 (healthy)"
else
    echo "❌ Backend:  FAILED — check /tmp/trustreply-backend.log"
fi

if [ "$FRONTEND" = "200" ]; then
    echo "✅ Frontend: http://localhost:3000 (ready)"
else
    echo "❌ Frontend: FAILED — check /tmp/trustreply-frontend.log"
fi

echo ""
echo "Done. Close this window — servers keep running."
