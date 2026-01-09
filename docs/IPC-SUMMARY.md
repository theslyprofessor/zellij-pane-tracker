# IPC Protocol Implementation Summary

## What Was Built

This implementation adds a **complete IPC (Inter-Process Communication) protocol** to zellij-pane-tracker, inspired by the architecture of [claude-canvas](https://github.com/dvdsgl/claude-canvas).

## Problem Solved

**Original Issue:** The repository had a monolithic structure mixing core functionality (Zellij plugin, pane operations) with integration-specific code (OpenCode MCP server), making it hard to:
- Extend for other AI assistants (Claude Desktop, Cursor, etc.)
- Maintain clear separation of concerns
- Test components independently
- Support multiple simultaneous clients

## Solution

Implemented a **layered architecture** with clean separation:

### 1. Core Components (this repo)
- **Zellij Plugin** (Rust/WASM) - Exports pane metadata
- **Canvas API** (TypeScript) - High-level abstraction for pane operations
- **IPC Protocol** (TypeScript) - Unix socket-based message protocol
- **IPC Server** (TypeScript) - Standalone server implementing protocol
- **Reference MCP Server** - Example implementation (kept for backward compatibility)

### 2. Integration Components (future separate repos)
- **zellij-pane-opencode** - OpenCode-specific MCP server using IPC client
- **zellij-pane-claude** - Claude Desktop integration (future)
- **Custom integrations** - Anyone can build on top of IPC protocol

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Zellij Session                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  terminal_1  │  │  terminal_2  │  │  terminal_3  │      │
│  │  (OpenCode)  │  │ IPC Server   │  │    (nvim)    │      │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘      │
└─────────┼──────────────────┼────────────────────────────────┘
          │                  │
          │ MCP              │ IPC (Unix socket)
          │                  │
┌─────────▼────────┐  ┌──────▼──────────────────────────────┐
│  OpenCode        │  │  IPC Server                         │
│  Integration     │◄─┤  - Canvas API                       │
│  (separate repo) │  │  - Reads /tmp/zj-pane-names.json    │
│                  │  │  - Executes Zellij actions          │
└──────────────────┘  └──────────────────────────────────────┘
                                  ▲
                                  │
                      ┌───────────┴───────────┐
                      │  pane-tracker plugin  │
                      │  (writes metadata)    │
                      └───────────────────────┘
```

## Files Created

### IPC Protocol (`ipc/`)
- `types.ts` - Protocol message type definitions
- `server.ts` - IPC server implementation (Unix sockets)
- `client.ts` - IPC client with retry logic
- `ipc-server-standalone.ts` - Standalone server binary
- `ipc-client-cli.ts` - CLI client for testing
- `README.md` - Protocol documentation

### Canvas API (`api/`)
- `canvas-api.ts` - High-level Zellij operations abstraction
- `index.ts` - Module exports

### Documentation (`docs/`)
- `OPENCODE_INTEGRATION.md` - Guide for creating separate integration repo
- `TESTING.md` - Testing procedures and examples
- `ADR-IPC-PROTOCOL.md` - Architecture decision record
- `IPC-QUICK-REFERENCE.md` - Protocol message quick reference

### Configuration
- `package.json` - Package configuration with exports and scripts

### Updated Files
- `README.md` - Added IPC protocol section and architecture diagrams
- `AGENTS.md` - Updated with new architecture information

## Key Features

### 1. Unix Domain Socket Communication
- Fast, reliable local IPC
- Standard POSIX approach
- No port management needed
- Automatic cleanup on disconnect

### 2. JSON Message Protocol
- Language-agnostic (any language can implement client)
- Human-readable for debugging
- Easy to test with `nc` or `curl`
- Type-safe with TypeScript

### 3. Canvas API Abstraction
- Hides Zellij CLI complexity
- Consistent error handling
- Testable in isolation
- Reusable across integrations

### 4. Multiple Client Support
- Server handles multiple concurrent clients
- Each client has independent message stream
- Broadcast capability for future features
- Client identification for debugging

## Protocol Messages

### Client → Server
- `getPanes` - List all panes with IDs and names
- `dumpPane` - Get pane scrollback content
- `runInPane` - Execute command in pane
- `newPane` - Create new pane
- `renameSession` - Rename Zellij session
- `ping` - Test connectivity
- `close` - Request shutdown

### Server → Client
- `ready` - Connection established
- `panes` - Pane list response
- `paneContent` - Pane content response
- `commandExecuted` - Command execution confirmation
- `paneCreated` - Pane creation confirmation
- `sessionRenamed` - Session rename confirmation
- `error` - Error message
- `pong` - Ping response

## Usage Examples

### Starting IPC Server
```bash
bun run ipc/ipc-server-standalone.ts
```

### Testing with CLI
```bash
# Get panes
bun run ipc/ipc-client-cli.ts getPanes

# Dump pane content
bun run ipc/ipc-client-cli.ts dumpPane terminal_2

# Run command
bun run ipc/ipc-client-cli.ts runInPane terminal_2 "npm test"
```

### TypeScript Client
```typescript
import { connectWithRetry, getSocketPath } from "zellij-pane-tracker/ipc";

const client = await connectWithRetry({
  socketPath: getSocketPath(),
  onMessage: (msg) => console.log(msg),
  onDisconnect: () => console.log("Disconnected")
});

client.send({ type: "getPanes" });
client.send({ 
  type: "dumpPane", 
  paneId: "terminal_2",
  options: { lines: 50 }
});
```

### Python Client
```python
import socket, json

sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.connect("/tmp/zellij-pane-default.sock")

# Send message
msg = json.dumps({"type": "getPanes"}) + "\n"
sock.sendall(msg.encode())

# Receive response
data = sock.recv(4096).decode()
response = json.loads(data.strip())
print(response)
```

## Benefits

### For Core Development
✅ **Focused scope** - Core repo handles only plugin + IPC protocol
✅ **Clear boundaries** - Well-defined interfaces between layers
✅ **Easy testing** - Each layer can be tested independently
✅ **Better documentation** - Clear separation = clear docs

### For Integration Development
✅ **Independence** - OpenCode integration can evolve without touching core
✅ **Reusability** - Other AI assistants can create their own integrations
✅ **Language flexibility** - IPC clients can be written in any language
✅ **Multiple clients** - Multiple AI assistants can run simultaneously

### For Users
✅ **Better reliability** - IPC server can restart without affecting AI assistant
✅ **More options** - Can choose which AI assistants to connect
✅ **Easier debugging** - Can test IPC protocol independently

## Migration Path

### For Existing Users
1. **No immediate change required** - Existing MCP server still works
2. **Optional migration** - Can switch to IPC-based OpenCode integration
3. **Gradual transition** - Both approaches work during transition period

### For New Users
1. **Start with IPC** - Use new IPC-based approach from the start
2. **Follow integration guide** - Clear docs for creating separate repos
3. **Choose integration** - Pick OpenCode, Claude Desktop, or custom

## Next Steps

### Immediate
- [x] ✅ Core IPC infrastructure implemented
- [x] ✅ Canvas API abstraction created
- [x] ✅ Documentation completed
- [ ] Test with real Zellij session (requires Bun + Zellij)
- [ ] Create example OpenCode integration repo

### Near Term
- [ ] Publish package to npm
- [ ] Create GitHub Actions CI/CD
- [ ] Add TypeScript type declarations
- [ ] Performance benchmarks

### Long Term
- [ ] Claude Desktop integration
- [ ] Cursor integration
- [ ] Protocol versioning
- [ ] Streaming for large dumps
- [ ] Authentication mechanism

## Comparison with claude-canvas

### Similarities
✅ Unix domain socket for IPC
✅ JSON message protocol
✅ Separation of core and integration
✅ Client/server architecture
✅ Language-agnostic protocol

### Differences
- **Domain**: claude-canvas is for TUI canvases, this is for terminal panes
- **Integration**: claude-canvas has tmux, this has Zellij
- **Messages**: Different message types for different use cases
- **API**: Canvas API specific to Zellij operations

### Lessons Learned from claude-canvas
1. **Keep protocol simple** - JSON is sufficient
2. **Document thoroughly** - Protocol docs are essential
3. **Separate concerns** - Core vs integration split is valuable
4. **Test independently** - Each layer needs its own tests

## References

- [claude-canvas IPC Implementation](https://github.com/dvdsgl/claude-canvas/tree/main/canvas/src/ipc)
- [IPC Protocol Documentation](ipc/README.md)
- [OpenCode Integration Guide](docs/OPENCODE_INTEGRATION.md)
- [Testing Guide](docs/TESTING.md)
- [ADR: IPC Protocol](docs/ADR-IPC-PROTOCOL.md)
- [IPC Quick Reference](docs/IPC-QUICK-REFERENCE.md)

## Contributing

To add new IPC features:
1. Update `ipc/types.ts` with new message types
2. Implement in `api/canvas-api.ts` if needed
3. Handle in `ipc/ipc-server-standalone.ts`
4. Update documentation
5. Add tests

## License

MIT - Same as zellij-pane-tracker

## Author

Implementation by GitHub Copilot based on problem statement from theslyprofessor.

Inspired by [claude-canvas](https://github.com/dvdsgl/claude-canvas) by @dvdsgl.
