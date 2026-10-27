#!/bin/sh
# Install or update BILC on Linux or macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/chickenfaight/chickenfaight/main/bilc/install.sh | sh
#
# Downloads the release archive for this machine and checksums.txt, verifies the
# archive's SHA-256, and installs the binary to $BILC_INSTALL_DIR (default
# ~/.local/bin). Running it again updates an existing install. Settings:
#   BILC_VERSION       install this version (e.g. 0.1.0) instead of the latest
#   BILC_INSTALL_DIR   where to put the binary
#   BILC_DOWNLOAD_URL  fetch assets from here instead of GitHub (for testing)
set -eu

REPO="chickenfaight/chickenfaight"
INSTALL_DIR="${BILC_INSTALL_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*" >&2; }
fail() { say "bilc install: $*"; exit 1; }

case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) fail "unsupported OS $(uname -s); on Windows, download bilc_windows_*.zip from https://github.com/$REPO/releases" ;;
esac
case "$(uname -m)" in
    x86_64 | amd64) arch=amd64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) fail "unsupported CPU $(uname -m); BILC is built for amd64 and arm64" ;;
esac
asset="bilc_${os}_${arch}.tar.gz"

if [ -n "${BILC_DOWNLOAD_URL:-}" ]; then
    base="${BILC_DOWNLOAD_URL%/}"
elif [ -n "${BILC_VERSION:-}" ]; then
    base="https://github.com/$REPO/releases/download/bilc/v${BILC_VERSION#v}"
else
    # Only BILC publishes GitHub Releases in this repo, so "latest" is BILC's.
    base="https://github.com/$REPO/releases/latest/download"
fi

if command -v curl >/dev/null 2>&1; then
    download() { curl -fsSL --retry 2 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
    download() { wget -q -O "$2" "$1"; }
else
    fail "needs curl or wget"
fi
if command -v sha256sum >/dev/null 2>&1; then
    sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
    sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
    fail "needs sha256sum or shasum to verify the download"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

say "Downloading $asset..."
download "$base/$asset" "$tmp/$asset" || fail "couldn't download $base/$asset"
download "$base/checksums.txt" "$tmp/checksums.txt" || fail "couldn't download $base/checksums.txt"

expected="$(awk -v name="$asset" '$2 == name { print $1 }' "$tmp/checksums.txt")"
[ -n "$expected" ] || fail "checksums.txt has no entry for $asset"
actual="$(sha256 "$tmp/$asset")"
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset (expected $expected, got $actual); nothing was installed"

tar -xzf "$tmp/$asset" -C "$tmp" bilc || fail "couldn't extract $asset"
new_version="$("$tmp/bilc" version 2>/dev/null)" || fail "the downloaded binary doesn't run on this machine"

target="$INSTALL_DIR/bilc"
if [ -x "$target" ]; then
    old_version="$("$target" version 2>/dev/null || echo "an unknown version")"
    if [ "$old_version" = "$new_version" ]; then
        say "$new_version is already installed at $target."
        exit 0
    fi
    action="Updated $old_version to"
else
    action="Installed"
fi

mkdir -p "$INSTALL_DIR"
# Copy beside the target, then rename over it, so a running bilc keeps working.
cp "$tmp/bilc" "$INSTALL_DIR/.bilc.new.$$"
chmod 755 "$INSTALL_DIR/.bilc.new.$$"
mv -f "$INSTALL_DIR/.bilc.new.$$" "$target"
say "$action $new_version at $target."

case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *) say "Add $INSTALL_DIR to your PATH to run bilc, e.g.: echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.profile" ;;
esac
if [ "$action" = "Installed" ]; then
    say "Next: get a pairing code from the BILC page and run: bilc pair <code>"
fi
