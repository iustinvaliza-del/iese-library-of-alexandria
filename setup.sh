#!/bin/sh
# Mac setup: puts a private copy of Node.js in .node/ and installs the kit's two packages
# next to it. No admin rights, no PATH change, nothing installed system-wide.
# Safe to run again. UNTESTED on a Mac so far.
set -eu

NODE_VERSION=v24.22.0
# From https://nodejs.org/dist/v24.22.0/SHASUMS256.txt
case "$(uname -m)" in
  arm64)  ARCH=darwin-arm64; NODE_SHA256=6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5 ;;
  x86_64) ARCH=darwin-x64;   NODE_SHA256=495e3f273c645f3c4677d438304cdfc701729ea5dec5728f5c8e76a2dece4b91 ;;
  *) echo "This kit supports Apple silicon (arm64) and Intel (x86_64) Macs; this one reports $(uname -m)." >&2; exit 1 ;;
esac

KIT=$(cd "$(dirname "$0")" && pwd)
NODE_DIR="$KIT/.node"
NAME="node-$NODE_VERSION-$ARCH"

if [ ! -x "$NODE_DIR/bin/node" ] || [ "$("$NODE_DIR/bin/node" --version)" != "$NODE_VERSION" ]; then
  TMP="$KIT/.node-download"
  rm -rf "$TMP"
  mkdir -p "$TMP"
  echo "Downloading Node.js $NODE_VERSION ..."
  curl -fL --progress-bar -o "$TMP/$NAME.tar.gz" "https://nodejs.org/dist/$NODE_VERSION/$NAME.tar.gz"
  GOT=$(shasum -a 256 "$TMP/$NAME.tar.gz" | cut -d ' ' -f 1)
  if [ "$GOT" != "$NODE_SHA256" ]; then
    rm -rf "$TMP"
    echo "The Node.js download does not match its published checksum (got $GOT). Nothing was installed." >&2
    exit 1
  fi
  tar -xzf "$TMP/$NAME.tar.gz" -C "$TMP"
  rm -rf "$NODE_DIR"
  mv "$TMP/$NAME" "$NODE_DIR"
  rm -rf "$TMP"
fi

echo "Installing the kit's packages ..."
cd "$KIT"
# --ignore-scripts: no package gets to run code at install time.
# --cache inside .node/ keeps everything in the kit folder, so deleting it removes all.
"$NODE_DIR/bin/node" "$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js" ci --ignore-scripts --no-audit --no-fund --no-update-notifier --cache "$NODE_DIR/npm-cache"
echo "Setup finished."
