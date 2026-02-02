#!/bin/bash

# VideoX Standalone Startup Script

BASE_DIR="/Users/txwen/Documents/Navlink/videox"
BACKEND_DIR="$BASE_DIR/backend-nodejs"
FRONTEND_DIR="$BASE_DIR/frontend"

echo "🚀 Starting VideoX Standalone Services..."

# 1. Kill existing processes on target ports
echo "Checking ports 3100 (Backend) and 5176 (Frontend)..."
lsof -ti :3100 | xargs kill -9 2>/dev/null
lsof -ti :5176 | xargs kill -9 2>/dev/null

# 2. Start Backend
echo "Starting Backend (Port 3100)..."
cd "$BACKEND_DIR"
nohup node server.js > "$BASE_DIR/backend.log" 2>&1 &
echo $! > "$BASE_DIR/backend.pid"

# 3. Start Frontend
echo "Starting Frontend (Port 5176)..."
cd "$FRONTEND_DIR"
# Use npm run dev but ensure it binds to the correct port if defined in vite.config
nohup npm run dev -- --port 5176 > "$BASE_DIR/frontend.log" 2>&1 &
echo $! > "$BASE_DIR/frontend.pid"

echo "----------------------------------------"
echo "✅ VideoX services started!"
echo "Backend logging to: $BASE_DIR/backend.log"
echo "Frontend logging to: $BASE_DIR/frontend.log"
echo ""
echo "Access VideoX at: http://localhost:5176"
echo "----------------------------------------"
