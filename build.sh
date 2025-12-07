#!/usr/bin/env bash
set -euo pipefail

echo "🦀 Building zellij-pane-tracker plugin..."

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust is not installed!"
    echo ""
    echo "Install Rust with one of these methods:"
    echo "  1. Official installer: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    echo "  2. Via asdf: asdf plugin add rust && asdf install rust latest && asdf global rust latest"
    echo ""
    exit 1
fi

# Check if wasm32-wasi target is installed
if ! rustup target list --installed | grep -q wasm32-wasi; then
    echo "📦 Installing wasm32-wasi target..."
    rustup target add wasm32-wasi
fi

# Build the plugin
echo "🔨 Compiling plugin..."
cargo build --release --target wasm32-wasi

# Copy to zellij plugins directory
PLUGIN_DIR="$HOME/.config/zellij/plugins"
mkdir -p "$PLUGIN_DIR"

echo "📋 Installing to $PLUGIN_DIR..."
cp target/wasm32-wasi/release/zellij-pane-tracker.wasm "$PLUGIN_DIR/"

echo "✅ Build complete!"
echo ""
echo "Plugin installed to: $PLUGIN_DIR/zellij-pane-tracker.wasm"
echo ""
echo "To use:"
echo "  zellij plugin -- file:$PLUGIN_DIR/zellij-pane-tracker.wasm"
echo ""
echo "Or add to your Zellij layout (see README.md)"
