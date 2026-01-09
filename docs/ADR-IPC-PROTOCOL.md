# Architecture Decision Record: IPC Protocol

## Status
**Accepted** - January 2026

## Context

The original `zellij-pane-tracker` repository had a monolithic structure:
- Zellij plugin (Rust/WASM)
- MCP server (TypeScript/Bun)
- Shell scripts (zjdump)

This created several issues:
1. **Tight coupling** - OpenCode-specific code mixed with core functionality
2. **Hard to extend** - Other AI assistants (Claude Desktop, Cursor) would need to fork the repo
3. **No clear boundaries** - Responsibilities unclear between plugin and MCP server
4. **Single integration** - Designed specifically for OpenCode, not reusable

## Decision

Adopt an **IPC (Inter-Process Communication) protocol** architecture inspired by [claude-canvas](https://github.com/dvdsgl/claude-canvas):

### Core Components (this repo)
1. **Zellij Plugin** - Exports pane metadata to JSON
2. **Canvas API** - High-level TypeScript abstraction for Zellij operations
3. **IPC Protocol** - Unix socket-based message protocol
4. **IPC Server** - Standalone server implementing the protocol
5. **Reference MCP Server** - Example implementation

### Integration Components (separate repos)
1. **OpenCode Integration** (`zellij-pane-opencode`) - MCP server using IPC client
2. **Claude Desktop Integration** (future) - Plugin using IPC client
3. **Custom Integrations** - Anyone can create their own

### Key Architectural Decisions

#### 1. Unix Domain Sockets
- **Why**: Fast, reliable, POSIX standard
- **Alternative considered**: HTTP server (too heavyweight)
- **Trade-off**: Local-only (can't connect remotely)

#### 2. JSON Message Protocol
- **Why**: Language-agnostic, human-readable, easy to debug
- **Alternative considered**: Protocol Buffers (too complex)
- **Trade-off**: Slightly larger messages

#### 3. Canvas API Abstraction
- **Why**: Hides Zellij CLI complexity, testable, reusable
- **Alternative considered**: Direct Zellij CLI calls in IPC server
- **Trade-off**: Extra abstraction layer

#### 4. Separate Integration Repos
- **Why**: Clear ownership, independent versioning, focused development
- **Alternative considered**: Monorepo with workspaces
- **Trade-off**: More coordination needed for breaking changes

## Consequences

### Positive
✅ **Separation of concerns** - Core vs integration logic clearly separated
✅ **Extensibility** - Easy to add new AI assistant integrations
✅ **Language agnostic** - IPC clients can be written in any language
✅ **Multiple clients** - Multiple AI assistants can run simultaneously
✅ **Clean testing** - Each layer can be tested independently
✅ **Better documentation** - Clear boundaries = clear docs

### Negative
❌ **More complex setup** - Need to run IPC server separately
❌ **Extra hop** - MCP server → IPC client → IPC server → Zellij
❌ **Network overhead** - Unix socket adds latency (minimal, ~1ms)
❌ **Breaking changes** - Changes to IPC protocol affect all integrations

### Neutral
⚪ **Migration path needed** - Existing users need to update
⚪ **More files** - More modules to maintain

## Implementation

### Phase 1: Core Infrastructure ✅
- [x] IPC protocol types (`ipc/types.ts`)
- [x] IPC server implementation (`ipc/server.ts`)
- [x] IPC client implementation (`ipc/client.ts`)
- [x] Canvas API (`api/canvas-api.ts`)
- [x] Standalone server binary (`ipc/ipc-server-standalone.ts`)
- [x] CLI test client (`ipc/ipc-client-cli.ts`)
- [x] Documentation (README, IPC docs, integration guide)

### Phase 2: OpenCode Integration (Next)
- [ ] Create `zellij-pane-opencode` repository
- [ ] MCP server using IPC client
- [ ] OpenCode skill definitions
- [ ] Installation guide
- [ ] Update OpenCode config

### Phase 3: Deprecation (Future)
- [ ] Mark `mcp-server/index.ts` as deprecated
- [ ] Update all references to use IPC
- [ ] Provide migration guide for users

## Examples

### Before (Monolithic)
```typescript
// mcp-server/index.ts
const canvas = new ZellijCanvas();
const content = await canvas.dumpPane("terminal_2");
// Return via MCP protocol
```

### After (IPC Protocol)
```typescript
// zellij-pane-opencode/src/mcp-server.ts
const client = await connectToServer({ socketPath });
client.send({ type: "dumpPane", paneId: "terminal_2" });
// Handle response in onMessage callback
```

## Alternatives Considered

### 1. HTTP/REST API
**Pros:** Standard, well-known, easy to test
**Cons:** Overhead, port management, security concerns
**Verdict:** Rejected - too heavyweight for local IPC

### 2. gRPC
**Pros:** Fast, type-safe, bi-directional
**Cons:** Complex setup, larger binaries
**Verdict:** Rejected - overkill for this use case

### 3. Message Queue (Redis, RabbitMQ)
**Pros:** Robust, scalable, persistent
**Cons:** External dependency, complexity
**Verdict:** Rejected - too complex for terminal tool

### 4. Shared Memory
**Pros:** Fastest possible IPC
**Cons:** Complex, error-prone, platform-specific
**Verdict:** Rejected - premature optimization

### 5. Named Pipes (FIFO)
**Pros:** Simple, standard
**Cons:** One-way only, awkward bidirectional
**Verdict:** Rejected - Unix sockets are better

## Lessons Learned

1. **Start simple** - JSON over Unix sockets is sufficient
2. **Document early** - Clear protocol docs prevent confusion
3. **Test independently** - Each layer should have its own tests
4. **Version carefully** - Breaking changes affect all integrations

## Future Considerations

### Versioning
- Add protocol version to `ready` message
- Client can check compatibility
- Graceful degradation for older clients

### Authentication
- Currently open to all local users
- Could add token-based auth if needed
- File permissions provide some security

### Remote Access
- Current design is local-only
- Could add SSH tunneling support
- Or create HTTP bridge server

### Performance
- Current implementation is synchronous
- Could add async/streaming for large dumps
- Benchmark shows <5ms overhead per request

## References

- [claude-canvas IPC implementation](https://github.com/dvdsgl/claude-canvas/tree/main/canvas/src/ipc)
- [Unix Domain Sockets](https://en.wikipedia.org/wiki/Unix_domain_socket)
- [Architectural Decision Records](https://adr.github.io/)

## Changelog

- **2026-01-09**: Initial ADR created
- **2026-01-09**: IPC protocol implemented
- **2026-01-09**: Documentation completed
