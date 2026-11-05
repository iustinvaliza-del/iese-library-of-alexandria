#!/bin/bash
# Double-click launcher for a Mac. The kit runs from a copy in ~/Library/Caches, never from the
# downloaded folder: a synced Desktop (iCloud) would sync node_modules and stall the cleanup.
# UNTESTED on a Mac so far.
HERE=$(cd "$(dirname "$0")" && pwd)
WORK="$HOME/Library/Caches/iese-alexandria"
export ALX_STATUS="$HERE/STATUS.txt"
NODE="$WORK/.node/bin/node"
RC=0

finish() {
  echo
  [ "${ALX_DRY:-}" = 1 ] || read -r -p "Press Enter to close " _
  exit "$RC"
}

stop() {
  printf 'Stopped: %s; double-click Start again to continue\n' "$1" > "$ALX_STATUS"
  echo "Stopped: $1"
  RC=1
  finish
}

echo "IESE Alexandria kit"
echo
CODE=""
if [ "${ALX_DRY:-}" != 1 ]; then
  [ -f "$HERE/code.txt" ] && CODE=$(tr -d '\r' < "$HERE/code.txt" | awk 'NF { print $1; exit }')
  if [ -z "$CODE" ]; then
    read -r -p "Paste your upload code (from the message Radu sent) and press Enter: " CODE
    CODE=$(printf '%s\n' "$CODE" | awk 'NF { print $1; exit }')
  fi
  [ -n "$CODE" ] || stop "no upload code was given"
fi

printf 'Setting up\342\200\246\n' > "$ALX_STATUS"
echo "Copying the kit to $WORK ..."
mkdir -p "$WORK" || stop "could not copy the kit to $WORK"
(cd "$HERE" && tar -cf - --exclude .git --exclude .node --exclude .node-download --exclude node_modules \
  --exclude output --exclude .browsers --exclude .state.json --exclude '*.tmp' --exclude progress.json \
  --exclude receipt.txt --exclude code.txt --exclude STATUS.txt .) | (cd "$WORK" && tar -xf -) \
  || stop "could not copy the kit to $WORK"

echo "Setting up (a few minutes the first time) ..."
sh "$WORK/setup.sh" || stop "setup did not finish (this window shows why)"
[ -x "$NODE" ] || stop "setup did not finish (this window shows why)"

echo
echo "A browser window will open: sign in to Blackboard there. Leave this window open; it shows the progress."
echo
if [ "${ALX_DRY:-}" = 1 ]; then
  "$NODE" "$WORK/kit.mjs" collect --dry
else
  "$NODE" "$WORK/kit.mjs" run --code "$CODE"
fi
RC=$?

ALL=0
if [ "${ALX_DRY:-}" = 1 ]; then
  [ "$RC" = 0 ] && ALL=1
else
  grep -q '"all_uploaded": true' "$WORK/progress.json" 2>/dev/null && ALL=1
fi

if [ -f "$WORK/receipt.txt" ]; then
  cp "$WORK/receipt.txt" "$HERE/receipt.txt"
  echo
  echo "Receipt (a copy is saved as receipt.txt in this folder):"
  cat "$WORK/receipt.txt"
  echo
fi

if [ "$ALL" != 1 ]; then
  echo
  echo "Not everything is uploaded yet. Your progress is kept in $WORK."
  echo "Double-click Start again tomorrow or after fixing the problem; it continues where it stopped."
  [ "$RC" = 0 ] && RC=1
  finish
fi

echo 'Done: all uploaded' > "$ALX_STATUS"
rm -rf "$WORK" 2>/dev/null
if [ -e "$WORK" ]; then
  echo
  echo "Everything is uploaded, but this folder could not be fully deleted: $WORK"
  echo "Close any window using it, then delete that folder by hand."
  echo "After that you can delete this folder ($HERE) and the zip you downloaded."
  RC=1
else
  echo
  echo "Everything is uploaded, and the kit's working copy in $WORK is deleted."
  echo "You can now delete this folder ($HERE) and the zip you downloaded."
fi
finish
