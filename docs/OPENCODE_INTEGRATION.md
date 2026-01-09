# OpenCode Integration Guide

This guide shows how to create a separate `zellij-pane-opencode` repository that uses the IPC protocol from `zellij-pane-tracker`.

## Why Separate Repositories?

### Separation of Concerns
- **zellij-pane-tracker** - Core Zellij plugin, Canvas API, IPC protocol
- **zellij-pane-opencode** - OpenCode-specific plugin, AI assistant integration

### Benefits
1. **Focused development** - Each repo has a single responsibility
2. **Independent versioning** - OpenCode integration can evolve without touching core
3. **Reusability** - Other AI assistants can create their own integration repos
4. **Clear dependencies** - OpenCode integration explicitly depends on core

## Repository Structure

### Core Repository (zellij-pane-tracker)

```
zellij-pane-tracker/
├── src/main.rs              # Zellij plugin (exports pane metadata)
├── ipc/
│   ├── types.ts            # IPC message protocol
│   ├── server.ts           # IPC server implementation
│   ├── client.ts           # IPC client implementation
│   └── ipc-server-standalone.ts
├── api/
│   └── canvas-api.ts       # High-level Zellij operations
├── mcp-server/
│   └── index.ts            # Reference MCP implementation
├── scripts/
│   └── zjdump              # Companion script
└── package.json            # Can be published to npm
```

### OpenCode Integration Repository (NEW)

```
zellij-pane-opencode/
├── src/
│   ├── mcp-server.ts       # MCP server using IPC client
│   ├── opencode-bridge.ts  # OpenCode-specific features
│   └── commands.ts         # Custom commands for OpenCode
├── skills/
│   └── zellij-pane/
│       └── SKILL.md        # OpenCode skill definition
├── package.json            # Depends on zellij-pane-tracker
├── README.md
└── INSTALL.md
```

## Step-by-Step Setup

### 1. Create OpenCode Integration Repository

```bash
mkdir zellij-pane-opencode
cd zellij-pane-opencode
bun init
```

### 2. Add Dependency on Core

**package.json:**
```json
{
  "name": "zellij-pane-opencode",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zellij-pane-tracker": "github:theslyprofessor/zellij-pane-tracker"
  }
}
```

### 3. Create MCP Server Using IPC

**src/mcp-server.ts:**
```typescript
#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectWithRetry, getSocketPath } from "zellij-pane-tracker/ipc";
import type { ServerMessage } from "zellij-pane-tracker/ipc";
import { z } from "zod";

const server = new McpServer({
  name: "zellij-pane-opencode",
  version: "1.0.0",
});

// Establish IPC connection to Zellij Canvas server
let ipcClient: any = null;
let responseHandlers = new Map<string, (msg: ServerMessage) => void>();

async function getIPCClient() {
  if (!ipcClient) {
    const socketPath = getSocketPath();
    ipcClient = await connectWithRetry({
      socketPath,
      onMessage: (msg: ServerMessage) => {
        // Route messages to waiting handlers
        const handler = responseHandlers.get(msg.type);
        if (handler) {
          handler(msg);
        }
      },
      onDisconnect: () => {
        console.error("IPC client disconnected");
        ipcClient = null;
      },
      onError: (error) => {
        console.error("IPC error:", error);
      }
    });
  }
  return ipcClient;
}

// MCP Tool: get_panes
server.tool(
  "zellij_get_panes",
  "Get list of all Zellij panes",
  {},
  async () => {
    const client = await getIPCClient();
    
    return new Promise((resolve) => {
      responseHandlers.set("panes", (msg) => {
        if (msg.type === "panes") {
          const panes = Object.entries(msg.data.panes)
            .filter(([id]) => id.startsWith("terminal_"))
            .map(([id, name]) => `${id}: ${name}`)
            .join("\n");
          
          resolve({
            content: [{ type: "text", text: panes }]
          });
        }
      });
      
      client.send({ type: "getPanes" });
    });
  }
);

// MCP Tool: dump_pane
server.tool(
  "zellij_dump_pane",
  "Dump content from a Zellij pane",
  {
    pane_id: z.string().describe("Pane ID (e.g., 'terminal_2')"),
    full: z.boolean().optional().describe("Dump full scrollback"),
    lines: z.number().optional().describe("Number of lines to return")
  },
  async ({ pane_id, full, lines }) => {
    const client = await getIPCClient();
    
    return new Promise((resolve) => {
      responseHandlers.set("paneContent", (msg) => {
        if (msg.type === "paneContent") {
          resolve({
            content: [{ type: "text", text: msg.content }]
          });
        }
      });
      
      responseHandlers.set("error", (msg) => {
        if (msg.type === "error") {
          resolve({
            content: [{ type: "text", text: `Error: ${msg.message}` }]
          });
        }
      });
      
      client.send({ 
        type: "dumpPane", 
        paneId: pane_id,
        options: { full, lines }
      });
    });
  }
);

// Start MCP server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Zellij-OpenCode MCP server running");
}

main().catch(console.error);
```

### 4. Create OpenCode Configuration

**~/.config/opencode/opencode.json:**
```json
{
  "mcp": {
    "zellij": {
      "type": "local",
      "command": ["bun", "run", "/path/to/zellij-pane-opencode/src/mcp-server.ts"],
      "enabled": true
    }
  }
}
```

### 5. Start IPC Server in Zellij

In a Zellij pane:
```bash
bun run node_modules/zellij-pane-tracker/ipc/ipc-server-standalone.ts
```

Or add to `~/.config/zellij/config.kdl`:
```kdl
// Auto-start IPC server on session start
layouts {
    default {
        pane split_direction="vertical" {
            pane command="bun" {
                args "run" "/path/to/zellij-pane-tracker/ipc/ipc-server-standalone.ts"
            }
            pane
        }
    }
}
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│              Zellij Session                             │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐                    │
│  │  terminal_1  │  │  terminal_2  │                    │
│  │  (OpenCode)  │  │ IPC Server   │                    │
│  └──────┬───────┘  └──────┬───────┘                    │
└─────────┼──────────────────┼──────────────────────────┘
          │                  │
          │ MCP              │ IPC (Unix socket)
          │                  │
┌─────────▼─────────┐  ┌─────▼──────────────────────────┐
│  OpenCode MCP     │  │  IPC Server                    │
│  Server           │◄─┤  (zellij-pane-tracker)        │
│  (zellij-pane-    │  │                                │
│   opencode)       │  │  - Canvas API                  │
│                   │  │  - Pane metadata reader        │
└───────────────────┘  └────────────────────────────────┘
```

## Development Workflow

### Making Changes to Core
1. Edit files in `zellij-pane-tracker`
2. Commit and push
3. Update dependency in `zellij-pane-opencode`: `bun install`

### Making OpenCode-Specific Changes
1. Edit files in `zellij-pane-opencode`
2. Restart OpenCode or kill MCP server
3. Test with OpenCode

### Testing IPC Protocol
```bash
# Terminal 1: Start IPC server
cd zellij-pane-tracker
bun run ipc/ipc-server-standalone.ts

# Terminal 2: Test with CLI client
cd zellij-pane-tracker
bun run ipc/ipc-client-cli.ts getPanes

# Terminal 3: Test with OpenCode
# Just use OpenCode normally
```

## Next Steps

1. Set up `zellij-pane-opencode` repository
2. Implement MCP server using IPC client
3. Add OpenCode-specific features (skills, commands)
4. Test end-to-end
5. Document and share!

## References

- [zellij-pane-tracker](https://github.com/theslyprofessor/zellij-pane-tracker)
- [claude-canvas](https://github.com/dvdsgl/claude-canvas)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [OpenCode](https://opencode.ai)
