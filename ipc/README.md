# IPC Protocol Architecture

This directory contains the IPC (Inter-Process Communication) layer for Zellij pane operations, inspired by the [claude-canvas](https://github.com/dvdsgl/claude-canvas) architecture.

## Overview

The IPC protocol enables clean separation of concerns between:
1. **Core functionality** - Zellij plugin and Canvas API (this repo)
2. **Integration layer** - OpenCode/AI assistant specific code (separate repo)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Zellij Session                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  terminal_1  │  │  terminal_2  │  │  terminal_3  │      │
│  │  (OpenCode)  │  │  (npm build) │  │    (nvim)    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                                                    │
│         │ IPC protocol (Unix socket)                        │
│         ▼                                                    │
│  ┌──────────────────────────────────────────────────┐       │
│  │           IPC Server (ipc-server-standalone)     │       │
│  │                                                  │       │
│  │  Listens: /tmp/zellij-pane-{session}.sock       │       │
│  │  Uses: Canvas API + Pane Tracker JSON           │       │
│  └──────────────────────────────────────────────────┘       │
│         │                                │                  │
│         │ uses                           │ reads            │
│         ▼                                ▼                  │
│  ┌──────────────┐              ┌──────────────────────┐    │
│  │  Canvas API  │              │ /tmp/zj-pane-names   │    │
│  │  (high-level │              │      .json           │    │
│  │   actions)   │              │  (plugin output)     │    │
│  └──────────────┘              └──────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
         ▲
         │ IPC protocol
         │
┌────────┴───────────────────────────────────────────────┐
│  External Client (OpenCode, custom integrations)       │
│                                                         │
│  import { connectToServer } from "zellij-pane-tracker" │
│  const client = await connectToServer({ ... })         │
│  client.send({ type: "getPanes" })                     │
└─────────────────────────────────────────────────────────┘
```

## Protocol Messages

### Client → Server

```typescript
type ClientMessage =
  | { type: "getPanes" }
  | { type: "dumpPane"; paneId: string; options?: DumpOptions }
  | { type: "runInPane"; paneId: string; command: string }
  | { type: "newPane"; direction?: "down" | "right"; command?: string }
  | { type: "renameSession"; name: string }
  | { type: "ping" }
  | { type: "close" };
```

### Server → Client

```typescript
type ServerMessage =
  | { type: "ready"; version: string }
  | { type: "panes"; data: PaneMetadata }
  | { type: "paneContent"; paneId: string; content: string; lines?: number }
  | { type: "commandExecuted"; paneId: string; command: string }
  | { type: "paneCreated"; paneId: string }
  | { type: "sessionRenamed"; name: string }
  | { type: "error"; message: string; details?: string }
  | { type: "pong" };
```

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Message type definitions and protocol utilities |
| `server.ts` | IPC server implementation (listens on Unix socket) |
| `client.ts` | IPC client implementation (connects to server) |
| `ipc-server-standalone.ts` | Standalone server binary using Canvas API |
| `ipc-client-cli.ts` | Example CLI client for testing |

## Usage

### Starting the IPC Server

```bash
# In a Zellij pane
bun run ipc/ipc-server-standalone.ts
```

The server will:
1. Detect the active Zellij session
2. Create a Unix socket at `/tmp/zellij-pane-{session}.sock`
3. Listen for client connections
4. Respond to commands using the Canvas API

### Connecting a Client

```typescript
import { connectWithRetry } from "zellij-pane-tracker/ipc";

const client = await connectWithRetry({
  socketPath: "/tmp/zellij-pane-default.sock",
  
  onMessage: (msg) => {
    console.log("Received:", msg);
  },
  
  onDisconnect: () => {
    console.log("Disconnected");
  }
});

// Get list of panes
client.send({ type: "getPanes" });

// Dump a pane's content
client.send({ 
  type: "dumpPane", 
  paneId: "terminal_2",
  options: { lines: 50 }
});

// Run a command
client.send({
  type: "runInPane",
  paneId: "terminal_2",
  command: "npm test"
});
```

### Testing with CLI

```bash
# List all panes
bun run ipc/ipc-client-cli.ts getPanes

# Dump pane content
bun run ipc/ipc-client-cli.ts dumpPane terminal_2

# Run command in pane
bun run ipc/ipc-client-cli.ts runInPane terminal_2 "echo hello"

# Create new pane
bun run ipc/ipc-client-cli.ts newPane down "htop"
```

## Benefits of IPC Architecture

### Separation of Concerns
- **Core repo** (zellij-pane-tracker): Plugin, Canvas API, IPC protocol
- **Integration repo** (zellij-pane-opencode): OpenCode-specific code

### Language Agnostic
- Any language can implement an IPC client
- Just read/write JSON over Unix socket
- Examples: Python, Node.js, Go, Rust

### Multiple Clients
- Multiple AI assistants can connect simultaneously
- Separate tools can interact with same Zellij session
- No MCP server restart needed

### Clean Testing
- Test IPC server independently of integrations
- Mock clients for testing server
- Mock server for testing clients

## Migrating from MCP-Only

The existing `mcp-server/index.ts` can be refactored to use the IPC client:

```typescript
// Before: Direct Canvas API calls
const canvas = new ZellijCanvas();
const content = await canvas.dumpPane("terminal_2");

// After: IPC client calls (can be remote, multi-process, etc.)
const client = await connectToServer({ socketPath });
client.send({ type: "dumpPane", paneId: "terminal_2" });
// ... handle response in onMessage
```

## Creating OpenCode Integration (Separate Repo)

See [OPENCODE_INTEGRATION.md](../docs/OPENCODE_INTEGRATION.md) for guide on:
1. Creating `zellij-pane-opencode` repository
2. Referencing this repo as dependency
3. Building OpenCode-specific features on top of IPC

## Protocol Extension

To add new operations:

1. Add message types to `types.ts`
2. Implement in Canvas API (`api/canvas-api.ts`)
3. Handle in server (`ipc-server-standalone.ts`)
4. Update this README with examples

## Debugging

```bash
# Watch IPC server logs
bun run ipc/ipc-server-standalone.ts

# Test connection
echo '{"type":"ping"}' | nc -U /tmp/zellij-pane-default.sock

# Monitor socket
watch -n1 'ls -lh /tmp/zellij-pane-*.sock'
```

## References

- [claude-canvas IPC implementation](https://github.com/dvdsgl/claude-canvas/tree/main/canvas/src/ipc)
- [Unix Domain Sockets](https://en.wikipedia.org/wiki/Unix_domain_socket)
- [Bun socket API](https://bun.sh/docs/api/tcp)
