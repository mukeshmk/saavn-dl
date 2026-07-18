#!/bin/bash
set -e

# ── Configuration ───────────────────────────────────────────────────────────────
TARBALL="saavn-dl.tar.gz"
REMOTE_DIR="~/saavn-dl"

# ── Usage ───────────────────────────────────────────────────────────────────────
if [ -z "$1" ]; then
  echo "Usage: ./deploy.sh user@host [remote_dir]"
  echo ""
  echo "  user@host   - SSH destination (e.g. root@192.168.1.50)"
  echo "  remote_dir  - Optional remote path (default: ~/saavn-dl)"
  exit 1
fi

REMOTE_HOST="$1"
[ -n "$2" ] && REMOTE_DIR="$2"

# ── Create tarball ──────────────────────────────────────────────────────────────
echo "📦 Creating tarball..."
tar czf "$TARBALL" \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.git' \
  --exclude='.history' \
  --exclude='.kiro' \
  --exclude='assets' \
  --exclude='nas' \
  --exclude='.DS_Store' \
  --exclude='*.log' \
  --exclude="$TARBALL" \
  .

echo "✅ Tarball created: $TARBALL ($(du -h "$TARBALL" | cut -f1))"

# ── SCP to remote ──────────────────────────────────────────────────────────────
echo "🚀 Copying to $REMOTE_HOST:$REMOTE_DIR..."
ssh "$REMOTE_HOST" "mkdir -p $REMOTE_DIR"
scp "$TARBALL" "$REMOTE_HOST:$REMOTE_DIR/$TARBALL"

# ── Extract on remote ──────────────────────────────────────────────────────────
echo "📂 Extracting on remote..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && tar xzf $TARBALL && rm $TARBALL"

# ── Cleanup local tarball ──────────────────────────────────────────────────────
rm "$TARBALL"

echo ""
echo "✅ Done! Code is at $REMOTE_HOST:$REMOTE_DIR"
echo ""
echo "To build the Docker image, SSH in and run:"
echo "  ssh $REMOTE_HOST"
echo "  cd $REMOTE_DIR"
echo "  docker build -t saavn-dl ."
