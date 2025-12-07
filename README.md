# zellij-pane-tracker

A Zellij plugin that exports pane metadata to JSON for AI assistants, shell scripts, and automation.

## Why?

AI coding assistants (like Claude, GPT, etc.) running in a terminal pane can't see what's happening in other panes. This plugin solves that by continuously exporting pane metadata to a JSON file that any tool can read.

**Use cases:**
- Let your AI assistant know what's running in your build/test pane
- Script automation that needs to know which panes exist
- Monitor pane states from external tools

## What It Does

The plugin runs in the background and exports pane metadata to `/tmp/zj-pane-names.json`:

```json
{
  "panes": {
    "terminal_0": "Yazi: ~/projects",
    "terminal_1": "opencode",
    "terminal_2": "Pane #1",
    "terminal_3": "nvim main.rs",
    "plugin_0": "zellij:tab-bar",
    "plugin_1": "zellij:status-bar"
  },
  "timestamp": 1733600000
}
```

Updates automatically whenever panes change (new pane, renamed, closed, etc.).

## Installation

### 1. Build the plugin

```bash
# Clone the repo
git clone https://github.com/theslyprofessor/zellij-pane-tracker
cd zellij-pane-tracker

# Build (requires Rust with wasm32-wasip1 target)
rustup target add wasm32-wasip1
cargo build --release

# Install
mkdir -p ~/.config/zellij/plugins
cp target/wasm32-wasip1/release/zellij-pane-tracker.wasm ~/.config/zellij/plugins/
```

### 2. Configure auto-load

Add to your `~/.config/zellij/config.kdl`:

```kdl
load_plugins {
    "file:~/.config/zellij/plugins/zellij-pane-tracker.wasm"
}
```

### 3. Grant permissions

On first load, Zellij will prompt for permissions. Press `y` to allow:
- Read application state (to see pane info)
- Run commands (to write JSON file)

## Usage

### Reading pane metadata

```bash
# See all panes
cat /tmp/zj-pane-names.json

# Get specific pane name with jq
jq '.panes.terminal_2' /tmp/zj-pane-names.json

# List only terminal panes
jq '.panes | to_entries[] | select(.key | startswith("terminal_"))' /tmp/zj-pane-names.json
```

### Dumping pane content (companion script)

The plugin exports metadata, but to capture actual pane *content*, use this shell function:

```bash
# Add to your .zshrc or .bashrc
zjdump() {
    [[ -z "$ZELLIJ" ]] && { echo "Not in Zellij"; return 1; }
    local n="${1:-0}"; [[ "$1" =~ ^terminal_ ]] && n="${1#terminal_}"
    local f="/tmp/zjd-${n}.txt"
    (( n >= 2 )) && zellij action go-to-tab-name "shell" || zellij action go-to-tab-name "workspace"
    for i in {1..5}; do
        [[ "$(zellij action list-clients | tail -1 | awk '{print $2}')" == "terminal_${n}" ]] && {
            zellij action dump-screen -f "$f"
            zellij action go-to-tab-name "workspace"
            cat "$f"
            return 0
        }
        zellij action focus-next-pane
    done
    zellij action go-to-tab-name "workspace"
    echo "Pane terminal_${n} not found"
}
```

Then use it:

```bash
zjdump 2  # Dump terminal_2 content
```

**Note:** Adjust the tab names ("shell", "workspace") to match your layout.

## Manual Loading

If you prefer to load manually instead of auto-load:

```bash
zellij plugin -- file:~/.config/zellij/plugins/zellij-pane-tracker.wasm
```

## How It Works

1. Plugin subscribes to `PaneUpdate` events
2. On each update, extracts pane IDs, names, and commands from `PaneManifest`
3. Writes JSON to `/tmp/zj-pane-names.json` via shell command
4. Runs in background with minimal UI footprint

## Requirements

- Zellij 0.40.0 or later
- Rust (for building)

## License

MIT

## Author

Nakul Tiruviluamala ([@theslyprofessor](https://github.com/theslyprofessor))
