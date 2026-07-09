#!/usr/bin/env bash
# File Master installer
#   curl -fsSL https://raw.githubusercontent.com/frankiedei/file-master/main/install.sh | bash
set -euo pipefail

REPO="https://github.com/frankiedei/file-master.git"
APP_DIR="$HOME/.file-master"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v git  >/dev/null || die "git is required (install Xcode Command Line Tools: xcode-select --install)"
command -v node >/dev/null || die "Node.js 18+ is required (brew install node, or https://nodejs.org)"
[ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -ge 18 ] || die "Node.js 18+ is required (found $(node -v))"

# --- Get or update the app ---
if [ -d "$APP_DIR/.git" ]; then
  say "Updating existing install in $APP_DIR"
  git -C "$APP_DIR" pull --ff-only
else
  say "Cloning into $APP_DIR"
  git clone --depth 1 "$REPO" "$APP_DIR"
fi

say "Installing npm dependencies"
(cd "$APP_DIR" && npm install --no-audit --no-fund)

# --- External tools (ffmpeg/pandoc/yt-dlp) ---
missing=()
for tool in ffmpeg pandoc yt-dlp; do
  command -v "$tool" >/dev/null || missing+=("$tool")
done
if [ ${#missing[@]} -gt 0 ]; then
  if command -v brew >/dev/null; then
    say "Installing via Homebrew: ${missing[*]}"
    brew install "${missing[@]}"
  else
    warn "Missing tools: ${missing[*]} — install them for full functionality"
    warn "(ffmpeg: audio/video/image, pandoc: documents, yt-dlp: song downloads)"
  fi
fi

# --- Link the launcher onto PATH ---
chmod +x "$APP_DIR/bin/file-master"
if [ -w /usr/local/bin ]; then
  BIN_DIR="/usr/local/bin"
else
  BIN_DIR="$HOME/.local/bin"
  mkdir -p "$BIN_DIR"
fi
ln -sf "$APP_DIR/bin/file-master" "$BIN_DIR/file-master"
say "Linked launcher to $BIN_DIR/file-master"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not on your PATH — add this to your shell profile:"
     printf '    export PATH="%s:$PATH"\n' "$BIN_DIR" ;;
esac

echo
say "Done! Commands:"
echo "    file-master          start the server + open the app"
echo "    file-master stop     shut the server down"
echo "    file-master status   check if it's running"
echo "    file-master update   pull the latest version"
