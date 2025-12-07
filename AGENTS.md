---
created: 2025-12-07T13:45:00-0800
updated: 2025-12-07T13:45:00-0800
slug: zellij-pane-tracker
keywords: zellij, pane, tracker, plugin, terminal, mcp, ai-assistant
---
# Zellij Pane Tracker Plugin

A Zellij plugin that exports pane metadata to JSON for AI assistants and external tools.

## Quick Context

**What it does:** Continuously exports pane names/IDs to `/tmp/zj-pane-names.json`

**Why:** Lets AI coding assistants (OpenCode, etc.) "see" what's in other terminal panes

**Status:** Working, published to GitHub, MCP server available

## Key Files

| File | Purpose |
|------|---------|
| `src/main.rs` | Plugin source (Rust, compiles to WASM) |
| `mcp-server/index.ts` | MCP server (TypeScript/Bun) |
| `~/.config/zellij/plugins/zellij-pane-tracker.wasm` | Installed plugin |
| `/tmp/zj-pane-names.json` | Output file (pane metadata) |
| `~/zjdump` | Companion script to dump pane content |

## MCP Server

The MCP server exposes these tools to AI assistants:

| Tool | Description |
|------|-------------|
| `get_panes` | List all panes with IDs and names |
| `dump_pane` | Get visible content of a pane |
| `focus_pane` | Switch focus to a pane |
| `send_keys` | Send keystrokes to a pane |
| `run_in_pane` | Execute a command in a pane |
| `new_pane` | Create a new pane |

**Config location:** `~/.config/opencode/opencode.json` (enabled as "zellij")

## Commands

```bash
# Build
cd ~/Code/github.com/theslyprofessor/zellij-pane-tracker
cargo build --release --target wasm32-wasip1

# Install
cp target/wasm32-wasip1/release/zellij-pane-tracker.wasm ~/.config/zellij/plugins/

# Check output
cat /tmp/zj-pane-names.json

# Dump specific pane content
~/zjdump 2  # dumps terminal_2
```

## Roadmap / Future Ideas

- [ ] Tab metadata (not just panes)
- [ ] Pane content caching (avoid repeated dump-screen calls)
- [ ] Session awareness (multi-session support)
- [ ] Named pane aliases (user-defined friendly names)
- [ ] Real-time subscriptions via MCP
- [ ] Publish MCP server to npm

## Related

- `~/.config/zellij/config.kdl` - Zellij config with plugin load
- `~/.config/zsh/conf.d/10-aliases.zsh` - zjdump and other zellij helpers
- `~/.config/terminal/AGENTS.md` - broader terminal/Zellij context
