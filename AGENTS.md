---
created: 2025-12-07T13:45:00-0800
updated: 2025-12-08T00:50:00-0800
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

**Version:** 0.6.1 (tab-scoped queries with named tab support)

**Pane Identification (Tab-Scoped):**
- `"Pane 1"` or `"1"` → searches **current tab first** (fast), then other tabs
- `"Tab 2 Pane 1"` → goes directly to **Tab #2**, searches only there
- `"shell Pane 1"` → goes directly to tab named **"shell"**
- `"opencode"` → finds pane by name across all tabs
- `"terminal_2"` → explicit terminal ID

**Tools available:**
| Tool | Status | Description |
|------|--------|-------------|
| `zellij_get_panes` | ✅ Working | List all panes with IDs and display names |
| `zellij_dump_pane` | ✅ Working | Get scrollback of any pane (default: last 100 lines) |
| `zellij_run_in_pane` | ✅ Working | Execute commands in other panes |
| `zellij_new_pane` | ✅ Working | Create new panes |
| `zellij_rename_session` | ✅ Working | Rename the Zellij session |

**zellij_dump_pane options:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `pane_id` | string | required | Pane identifier (see above) |
| `full` | boolean | false | If true, dump entire scrollback (can be slow/large) |
| `lines` | number | 100 | Number of lines from end to return (ignored if full=true) |

**Config:** `~/.config/opencode/opencode.json`

**Example usage in OpenCode:**
```
User: "check pane 2"
→ zellij_dump_pane("2")  # Searches current tab first

User: "what's in tab 2 pane 1"
→ zellij_dump_pane("Tab 2 Pane 1")  # Goes directly to second tab

User: "check shell pane 2"
→ zellij_dump_pane("shell 2")  # Goes to tab named "shell"

User: "get full output from pane 2"
→ zellij_dump_pane("2", full=true)  # Returns entire scrollback

User: "run tests in pane 2"
→ zellij_run_in_pane("2", "bun test")
```

## Development Workflow

**CRITICAL: After editing `mcp-server/index.ts`, ALWAYS kill the MCP process:**
```bash
pkill -f "bun.*zellij-pane-tracker/mcp-server"
```

This is required because OpenCode spawns the MCP server as a child process. The server won't pick up code changes until restarted. After killing, restart OpenCode or it will auto-restart the MCP server on next tool call.

**Agent instruction:** When making changes to `mcp-server/index.ts`, automatically run the pkill command above before informing the user the change is complete.

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

## For AI Agents

This `AGENTS.md` file is intentionally committed to the repository (not gitignored) so that any AI coding assistant working on this project has immediate context about:
- Project architecture and purpose
- MCP server tools and their usage
- Development workflow (especially the critical pkill step after edits)
- Version history and roadmap

If you're an AI agent reading this: the MCP server at `mcp-server/index.ts` is the main file you'll edit. Always run `pkill -f "bun.*zellij-pane-tracker/mcp-server"` after making changes.

## Related

- `~/.config/zellij/config.kdl` - Zellij config with plugin load
- `~/.config/terminal/AGENTS.md` - Terminal/Zellij context (references this)
- `~/zjdump` - The companion dump script
