#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "🎬  VideoAI — Démarrage"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Add homebrew to PATH if needed
if [ -f /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# Check .env
if grep -q "your_openai_key_here" "$SCRIPT_DIR/backend/.env" 2>/dev/null; then
  echo "⚠️  ATTENTION : Tu n'as pas encore configuré tes clés API !"
  echo "   Ouvre le fichier backend/.env et remplace les valeurs."
  echo ""
fi

# Start backend
echo "🚀  Démarrage du backend (port 8000)..."
cd "$SCRIPT_DIR/backend"
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
echo "   Backend PID: $BACKEND_PID"

# Wait for backend
sleep 2

# Start frontend
echo "🚀  Démarrage du frontend (port 3000)..."
cd "$SCRIPT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!
echo "   Frontend PID: $FRONTEND_PID"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅  Plateforme démarrée !"
echo ""
echo "   🌐  Ouvre : http://localhost:3000"
echo ""
echo "   Ctrl+C pour arrêter"
echo ""

# Cleanup on exit
cleanup() {
  echo ""
  echo "Arrêt des serveurs..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# Keep running
wait
