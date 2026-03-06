#!/bin/bash
set -e

echo ""
echo "🎬  VideoAI — Installation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. Homebrew ──
if ! command -v brew &>/dev/null; then
  echo "📦  Installation de Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add to PATH for Apple Silicon
  if [ -f /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
  fi
else
  echo "✅  Homebrew déjà installé"
fi

# ── 2. Node.js ──
if ! command -v node &>/dev/null; then
  echo "📦  Installation de Node.js..."
  brew install node
else
  echo "✅  Node.js $(node --version) déjà installé"
fi

# ── 3. FFmpeg ──
if ! command -v ffmpeg &>/dev/null; then
  echo "📦  Installation de FFmpeg..."
  brew install ffmpeg
else
  echo "✅  FFmpeg déjà installé"
fi

# ── 4. Python deps ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo ""
echo "📦  Installation des dépendances Python..."
cd "$SCRIPT_DIR/backend"
python3 -m pip install --upgrade pip -q
python3 -m pip install -r requirements.txt -q
echo "✅  Dépendances Python installées"

# ── 5. Node deps ──
echo ""
echo "📦  Installation des dépendances Node.js..."
cd "$SCRIPT_DIR/frontend"
npm install --silent
echo "✅  Dépendances Node.js installées"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅  Installation terminée !"
echo ""
echo "👉  Prochaine étape :"
echo "    Ouvre le fichier backend/.env et ajoute tes clés API"
echo "    Puis lance : ./start.sh"
echo ""
