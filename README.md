# zellij-pane-tracker

A Zellij plugin that exports pane names to `/tmp/zj-pane-names.json` for shell script integration.

## What It Does

This plugin runs in the background and maintains a JSON file mapping pane IDs to their current names:

```json
{
  "panes": {
    "terminal_1": "opencode",
    "terminal_3": "Pane #3",
    "terminal_5": "build"
  },
  "timestamp": 1733515200
}
```

This allows shell scripts (like `zjall`) to automatically use named panes when capturing output.

## Building

Requires Rust and `wasm32-wasi` target:

```bash
# Install wasm32-wasi target (one-time setup)
rustup target add wasm32-wasi

# Build the plugin
cd ~/Code/github.com/theslyprofessor/zellij-pane-tracker
cargo build --release

# The plugin will be at:
# target/wasm32-wasi/release/zellij-pane-tracker.wasm
```

## Installation

1. Build the plugin (see above)
2. Copy to Zellij plugins directory:

```bash
mkdir -p ~/.config/zellij/plugins
cp target/wasm32-wasi/release/zellij-pane-tracker.wasm ~/.config/zellij/plugins/
```

## Usage

### Option 1: Load Manually

```bash
# Load in a floating pane
zellij plugin -- file:~/.config/zellij/plugins/zellij-pane-tracker.wasm

# Or load in background (hidden)
zellij plugin --configuration "floating=false" -- file:~/.config/zellij/plugins/zellij-pane-tracker.wasm
```

### Option 2: Auto-Load in Layout

Add to your Zellij layout file (`~/.config/zellij/layouts/default.kdl`):

```kdl
layout {
    pane size=1 borderless=true {
        plugin location="file:~/.config/zellij/plugins/zellij-pane-tracker.wasm"
    }
    pane
}
```

### Option 3: Auto-Load on Startup

Add to `~/.config/zellij/config.kdl`:

```kdl
plugins {
    pane-tracker location="file:~/.config/zellij/plugins/zellij-pane-tracker.wasm"
}
```

## Integration with zjall

The `zjall` function can be enhanced to read `/tmp/zj-pane-names.json` and create named symlinks:

```bash
# After zjall runs, you'll have both:
# /tmp/zj-pane-3.txt          # Numeric pane file
# /tmp/zj-build.txt           # Named symlink (if pane 3 is named "build")
```

See `~/.config/zsh/conf.d/10-aliases.zsh` for the updated `zjall` implementation.

## How It Works

1. Plugin subscribes to `PaneUpdate` events from Zellij
2. On each update, extracts pane IDs and titles from `PaneManifest`
3. Writes mapping to `/tmp/zj-pane-names.json`
4. Shell scripts read this file to resolve pane names

## Naming Panes

To set custom pane names in Zellij:

```bash
# Option 1: Use Zellij action
zellij action rename-pane "my-custom-name"

# Option 2: Use zjlabel alias (if configured)
zjlabel my-custom-name
```

## Troubleshooting

### Plugin Not Updating File

Check plugin permissions:
- Plugin needs `ReadApplicationState` permission
- Plugin needs `RunCommands` permission to write to `/tmp/`

### File Not Found

Ensure plugin is loaded and running:
```bash
# Check if plugin is active
zellij action list-clients

# Check if file exists
ls -la /tmp/zj-pane-names.json
```

## Development

```bash
# Watch mode for development
cargo watch -x 'build --release --target wasm32-wasi'

# Reload plugin in Zellij
# Close old instance, then reload with:
zellij plugin -- file:target/wasm32-wasi/release/zellij-pane-tracker.wasm
```

## License

MIT

## Author

Nakul Tiruviluamala (@theslyprofessor)
