#!/bin/sh
# Remove BILC from Linux or macOS.
#
#   sh uninstall.sh            remove the binary, keep config and credentials
#   sh uninstall.sh --purge    also unpair and delete config and credentials
#
# Uses $BILC_INSTALL_DIR (default ~/.local/bin), like install.sh. Purging only
# forgets the device on this machine; revoke it on the BILC page too.
set -eu

INSTALL_DIR="${BILC_INSTALL_DIR:-$HOME/.local/bin}"
target="$INSTALL_DIR/bilc"

say() { printf '%s\n' "$*" >&2; }

purge=false
case "${1:-}" in
    "") ;;
    --purge) purge=true ;;
    *) say "usage: sh uninstall.sh [--purge]"; exit 2 ;;
esac

if [ "$purge" = true ]; then
    # Unpair first: it deletes the token from the system keychain, which removing files can't.
    if [ -x "$target" ]; then
        "$target" unpair || say "warning: bilc unpair failed; check your keychain for a chickenfaight-bilc entry"
    fi
    case "$(uname -s)" in
        Darwin) config_dir="$HOME/Library/Application Support/chickenfaight" ;;
        *) config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/chickenfaight" ;;
    esac
    if [ -d "$config_dir/bilc" ]; then
        rm -rf "$config_dir/bilc"
        rmdir "$config_dir" 2>/dev/null || true
        say "Deleted $config_dir/bilc."
    fi
fi

if [ -e "$target" ]; then
    rm -f "$target"
    say "Removed $target."
else
    say "No bilc at $target."
fi
if [ "$purge" = true ]; then
    say "Revoke this device on the BILC page too, so the server forgets it."
fi
