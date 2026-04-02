#!/bin/bash
# TrustReply — Start both backend and frontend
# Usage: ./start.sh

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Starting TrustReply...${NC}"

# Kill any existing processes on our ports
for port in 8000 3000; do
    pid=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo -e "${YELLOW}Killing process on port $port${NC}"
        kill -9 $pid 2>/dev/null || true
    fi
done

sleep 1

# Start backend
echo -e "${GREEN}Starting backend on port 8000...${NC}"
cd "$BACKEND_DIR"
source venv/bin/activate 2>/dev/null || source .venv/bin/activate 2>/dev/null || {
    echo "No virtualenv found. Run: cd backend && python -m venv venv && pip install -r requirements.txt"
    exit 1
}
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Wait for backend health
echo "Waiting for backend..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:8000/api/health > /dev/null 2>&1; then
        echo -e "${GREEN}Backend is healthy!${NC}"
        break
    fi
    sleep 1
done

# Start frontend
echo -e "${GREEN}Starting frontend on port 3000...${NC}"
cd "$FRONTEND_DIR"
npm run dev -- -p 3000 &
FRONTEND_PID=$!

sleep 3

echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  TrustReply is running!${NC}"
echo -e "${GREEN}  Frontend: http://localhost:3000${NC}"
echo -e "${GREEN}  Backend:  http://localhost:8000${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo "Press Ctrl+C to stop both services."

# Trap Ctrl+C to kill both
trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM

# Wait for either to exit
wait
