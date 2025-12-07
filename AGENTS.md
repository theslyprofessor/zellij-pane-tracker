---
created: 2025-12-07T13:45:00-0800
updated: 2025-12-07T15:55:00-0800
slug: zellij-pane-tracker
keywords: zellij, pane, tracker, plugin, terminal, mcp, ai-assistant
---
# Zellij Pane Tracker Plugin

A Zellij plugin + MCP server that gives AI assistants visibility into all terminal panes.

## Quick Context

**What it does:** Exports pane metadata to JSON + MCP server for AI assistants to read/interact with panes

**Why:** Lets AI coding assistants (OpenCode, etc.) "see" and interact with other terminal panes

**Status:** ✅ **FULLY WORKING** - Plugin, companion script, and MCP server all operational

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Zellij Session                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │terminal_1│  │terminal_2│  │terminal_3│  │pane-tracker │ │
│  │(opencode)│  │(Pane #1) │  │(Pane #2) │  │  (plugin)   │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────┬──────┘ │
└───────────────────────────────────────────────────┼────────┘
                                                    │
                                    writes metadata │
                                                    ▼
                              /tmp/zj-pane-names.json
                                                    │
                    ┌───────────────────────────────┼───────────────────┐
                    │                               │                   │
                    ▼                               ▼                   ▼
              ~/zjdump                        MCP Server           Direct read
         (cycles + dumps)                   (calls zjdump)      (cat JSON file)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.rs` | Plugin source (Rust, compiles to WASM) |
| `mcp-server/index.ts` | MCP server (TypeScript/Bun) - needs fixes |
| `~/.config/zellij/plugins/zellij-pane-tracker.wasm` | Installed plugin |
| `/tmp/zj-pane-names.json` | Output file (pane metadata) |
| `~/zjdump` | **Primary tool** - dump any pane content with full scrollback |

## ~/zjdump - The Companion Script

**Location:** `~/zjdump` (standalone script, not a shell function)

**What it does:**
- Reads pane metadata from `/tmp/zj-pane-names.json`
- Cycles through tabs and panes to find target
- Dumps full scrollback with `--full` flag
- Returns focus to original position

**Usage:**
```bash
~/zjdump              # Dump current focused pane
~/zjdump 3            # Dump terminal_3 by ID
~/zjdump "Pane #2"    # Dump by display name
~/zjdump opencode     # Dump by pane name
```

**Performance:**
- Current pane: ~0.4s (fast path)
- Other pane: ~2s (cycles through tabs/panes)

**Output:** Writes to `/tmp/zjd-{id}.txt` and outputs to stdout

**OpenCode integration:**
```
User: "check pane 2"
OpenCode runs: ~/zjdump 2
```

## Pane Metadata JSON

**File:** `/tmp/zj-pane-names.json`

**Format:**
```json
{
  "panes": {
    "terminal_1": "opencode",
    "terminal_2": "Pane #1",
    "terminal_3": "Pane #2",
    "plugin_0": "(.) - file:/path/to/plugin.wasm"
  },
  "timestamp": 1765146556
}
```

**Updated by:** The Zellij plugin continuously on pane events

## MCP Server (WORKING)

The MCP server provides AI assistants with full Zellij integration via OpenCode's native tools.

**Pane Identification:**
- Use **Zellij display names**: `"Pane #1"`, `"Pane #2"`, `"opencode"`
- Or **terminal IDs**: `"2"`, `"terminal_2"`
- Names are resolved via `/tmp/zj-pane-names.json` metadata

**Tools available:**
| Tool | Status | Description |
|------|--------|-------------|
| `zellij_get_panes` | ✅ Working | List all panes with IDs and display names |
| `zellij_dump_pane` | ✅ Working | Get full scrollback of any pane |
| `zellij_run_in_pane` | ✅ Working | Execute commands in other panes |
| `zellij_new_pane` | ✅ Working | Create new panes |
| `zellij_rename_session` | ✅ Working | Rename the Zellij session |

**Config:** `~/.config/opencode/opencode.json`

**Example usage in OpenCode:**
```
User: "check pane #1"
→ zellij_dump_pane("Pane #1")

User: "what's in the build pane"  
→ zellij_get_panes() to find it, then zellij_dump_pane()

User: "run tests in pane 2"
→ zellij_run_in_pane("2", "bun test")
```

## Commands

```bash
# Build plugin
cd ~/Code/github.com/theslyprofessor/zellij-pane-tracker
cargo build --release --target wasm32-wasip1

# Install plugin
cp target/wasm32-wasip1/release/zellij-pane-tracker.wasm ~/.config/zellij/plugins/

# Check metadata
cat /tmp/zj-pane-names.json | jq .

# Dump pane content
~/zjdump 2           # By ID
~/zjdump "Pane #2"   # By name
```

## Roadmap / TODO

- [x] Plugin exports pane metadata to JSON
- [x] Companion script (~/zjdump) with full scrollback
- [x] Cross-tab pane navigation
- [x] Name-based pane lookup (supports "Pane #1", "opencode", etc.)
- [x] MCP server with full pane visibility and interaction
- [ ] Tab metadata (not just panes)
- [ ] Session awareness (multi-session support)
- [ ] Publish MCP server to npm

## Related

- `~/.config/zellij/config.kdl` - Zellij config with plugin load
- `~/.config/terminal/AGENTS.md` - Terminal/Zellij context (references this)
- `~/zjdump` - The companion dump script
