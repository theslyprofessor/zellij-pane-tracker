# zellij-pane-tracker

A Zellij plugin + MCP server that lets AI assistants see and interact with your terminal panes.

## The Problem

AI coding assistants (Claude, GPT, Cursor, etc.) running in a terminal pane are blind to other panes. They can't see your build output, test results, or what's running in your file manager.

## The Solution

This project has two components:

1. **Zellij Plugin** - Exports pane metadata to JSON (`/tmp/zj-pane-names.json`)
2. **MCP Server** - Exposes pane operations to AI assistants via [Model Context Protocol](https://modelcontextprotocol.io/)

Together, they let your AI assistant:
- Know what panes exist and what they're named
- Read the full scrollback content of any pane
- Run commands in other panes
- Create new panes
- Rename sessions

## Quick Start

### 1. Build and Install the Plugin

```bash
git clone https://github.com/theslyprofessor/zellij-pane-tracker
cd zellij-pane-tracker

# Build (requires Rust)
rustup target add wasm32-wasip1
cargo build --release

# Install
mkdir -p ~/.config/zellij/plugins
cp target/wasm32-wasip1/release/zellij-pane-tracker.wasm ~/.config/zellij/plugins/
```

### 2. Configure Auto-Load

Add to `~/.config/zellij/config.kdl`:

```kdl
load_plugins {
    "file:~/.config/zellij/plugins/zellij-pane-tracker.wasm"
}
```

On first load, Zellij prompts for permissions. Press `y` to allow.

### 3. Install the zjdump Script

```bash
cp scripts/zjdump ~/zjdump  # or anywhere in your PATH
chmod +x ~/zjdump
```

### 4. Set Up MCP Server (Optional)

If your AI tool supports MCP (like [OpenCode](https://opencode.ai), Claude Desktop, etc.):

```bash
cd mcp-server
bun install
```

Add to your MCP config (e.g., `~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "zellij": {
      "type": "local",
      "command": ["bun", "run", "/path/to/zellij-pane-tracker/mcp-server/index.ts"],
      "enabled": true
    }
  }
}
```

Restart your AI tool. It now has these capabilities:
- `get_panes` - List all panes with IDs and names
- `dump_pane` - Get full scrollback of any pane
- `run_in_pane` - Execute commands in other panes
- `new_pane` - Create panes
- `rename_session` - Rename the Zellij session

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                     Zellij Session                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ terminal_1  │  │ terminal_2  │  │ terminal_3  │         │
│  │  opencode   │  │  npm build  │  │    nvim     │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│         │                                                   │
│         │ MCP protocol                                      │
│         ▼                                                   │
│  ┌─────────────────────┐      ┌──────────────────────────┐ │
│  │    MCP Server       │      │   pane-tracker plugin    │ │
│  │  (bun run index.ts) │◄────►│  (writes pane metadata)  │ │
│  └─────────────────────┘      └──────────────────────────┘ │
│         │                              │                    │
│         │ calls                        │ writes             │
│         ▼                              ▼                    │
│  ┌─────────────┐              ┌──────────────────────────┐ │
│  │  ~/zjdump   │              │ /tmp/zj-pane-names.json  │ │
│  │  (script)   │              │   { panes: {...} }       │ │
│  └─────────────┘              └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

1. **Plugin** subscribes to Zellij's `PaneUpdate` events
2. On each update, writes pane metadata to `/tmp/zj-pane-names.json`
3. **MCP Server** reads this JSON to answer `get_panes` requests
4. **zjdump** script navigates to a pane, captures content, returns to origin

## Usage Without MCP

You can use the plugin and zjdump script directly without the MCP server:

```bash
# See all panes
cat /tmp/zj-pane-names.json

# Dump a pane's content
~/zjdump 2              # by terminal ID
~/zjdump "Pane #2"      # by display name
~/zjdump                # current pane
```

### JSON Output

```json
{
  "panes": {
    "terminal_1": "opencode",
    "terminal_2": "Pane #1",
    "terminal_3": "nvim main.rs",
    "plugin_0": "zellij:tab-bar"
  },
  "timestamp": 1733600000
}
```

## Requirements

- Zellij 0.40.0+
- Rust (for building the plugin)
- Bun (for MCP server)
- jq (for zjdump script)

## Project Structure

```
zellij-pane-tracker/
├── src/main.rs          # Zellij plugin (Rust/WASM)
├── mcp-server/
│   ├── index.ts         # MCP server (TypeScript/Bun)
│   └── package.json
├── scripts/
│   └── zjdump           # Pane content dumper (zsh)
├── Cargo.toml
└── README.md
```

## License

MIT

## Author

Nakul Tiruviluamala ([@theslyprofessor](https://github.com/theslyprofessor))

---

**Feedback welcome!** This started as a personal tool to make my AI assistant more useful. If you find bugs or have ideas, open an issue.
