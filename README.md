# zellij-pane-tracker

A Zellij plugin that automatically captures pane content and exports pane metadata to JSON files for shell script integration.

## What It Does

This plugin runs in the background and provides automatic pane tracking:

### 1. Auto-Capture Pane Content

Automatically dumps all terminal pane content to `/tmp/zj-pane-N.txt` files whenever panes update:

```bash
/tmp/zj-pane-1.txt  # Content of terminal pane 1
/tmp/zj-pane-3.txt  # Content of terminal pane 3
/tmp/zj-pane-5.txt  # Content of terminal pane 5
```

### 2. Named Pane Symlinks

Creates named symlinks for custom-named panes:

```bash
/tmp/zj-opencode.txt  → /tmp/zj-pane-1.txt
/tmp/zj-build.txt     → /tmp/zj-pane-5.txt
```

### 3. Pane Names Export

Maintains a JSON file mapping pane IDs to their current names:

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

### 4. Pane Metadata Export

Press `Ctrl-g` then `c` to capture full pane metadata to `/tmp/zj-panes-info.json`:

```json
[
  {
    "pane_id": "terminal_1",
    "name": "opencode",
    "command": "docker mcp gateway run",
    "is_focused": true,
    "is_floating": false,
    "coordinates": "120x40 at (0,0)"
  }
]
```

This eliminates the need to manually run `zjall` - content is always captured!

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

## Keybindings

- **Ctrl-g + c**: Manually trigger full pane capture with metadata export

## Integration with Shell Scripts

Since pane content is automatically captured, you can:

```bash
# Read any pane's content directly
cat /tmp/zj-pane-3.txt

# Or use named panes
cat /tmp/zj-opencode.txt

# Get pane metadata
jq '.[] | select(.name == "build")' /tmp/zj-panes-info.json

# Get pane names
jq '.panes' /tmp/zj-pane-names.json
```

The `zjall` function is now optional - content is always available!

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
