# Testing and Usage Guide

This guide shows how to test and use the IPC protocol with zellij-pane-tracker.

## Prerequisites

- **Bun** runtime (for IPC server/client)
- **Zellij** terminal multiplexer
- **Rust** toolchain (for building the plugin)

### Installing Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

## Quick Start Testing

### 1. Start Zellij Session

```bash
# Start a new Zellij session
zellij

# Or attach to existing
zellij attach default
```

### 2. Build and Install Plugin

```bash
cd zellij-pane-tracker

# Build plugin
rustup target add wasm32-wasip1
cargo build --release --target wasm32-wasip1

# Install
mkdir -p ~/.config/zellij/plugins
cp target/wasm32-wasip1/release/zellij-pane-tracker.wasm ~/.config/zellij/plugins/

# Configure auto-load in ~/.config/zellij/config.kdl
load_plugins {
    "file:~/.config/zellij/plugins/zellij-pane-tracker.wasm"
}
```

### 3. Verify Plugin Output

```bash
# Check that plugin is writing metadata
cat /tmp/zj-pane-names.json

# Should show something like:
# {
#   "panes": {
#     "terminal_1": "zsh",
#     "terminal_2": "Pane #1",
#     ...
#   },
#   "timestamp": 1704835200
# }
```

### 4. Start IPC Server

In one Zellij pane:

```bash
cd zellij-pane-tracker
bun run ipc/ipc-server-standalone.ts
```

You should see:
```
Starting IPC server on /tmp/zellij-pane-default.sock
Zellij Canvas IPC Server v1.0.0
Server ready. Clients: 0
```

### 5. Test with CLI Client

In another Zellij pane:

```bash
cd zellij-pane-tracker

# Test 1: Ping
bun run ipc/ipc-client-cli.ts ping

# Test 2: Get panes
bun run ipc/ipc-client-cli.ts getPanes

# Test 3: Dump pane content
bun run ipc/ipc-client-cli.ts dumpPane terminal_1

# Test 4: Run command in pane
bun run ipc/ipc-client-cli.ts runInPane terminal_1 "echo 'Hello from IPC'"

# Test 5: Create new pane
bun run ipc/ipc-client-cli.ts newPane down
```

## Testing Canvas API Directly

You can also test the Canvas API without the IPC layer:

```typescript
// test-canvas.ts
import { ZellijCanvas } from "./api/canvas-api";

const canvas = new ZellijCanvas();

// Get session info
const session = await canvas.getSessionName();
console.log("Session:", session);

// List panes
const panes = await canvas.listPanes();
console.log("Panes:", panes);

// Dump a pane
const content = await canvas.dumpPane("terminal_1", { lines: 20 });
console.log("Content:", content);

// Run command
await canvas.runInPane("terminal_1", "echo 'test'");

// Create pane
await canvas.createPane({ direction: "down" });
```

Run with:
```bash
bun run test-canvas.ts
```

## Testing with Mock Data

If you don't have Zellij running, you can test with mock data:

```bash
# Create mock pane metadata
cat > /tmp/zj-pane-names.json << 'EOF'
{
  "panes": {
    "terminal_1": "zsh",
    "terminal_2": "Pane #1",
    "terminal_3": "nvim",
    "plugin_0": "zellij:tab-bar"
  },
  "timestamp": 1704835200
}
EOF

# Test IPC server (will read mock data)
bun run ipc/ipc-server-standalone.ts
```

## Integration Testing

### Test End-to-End Flow

```bash
#!/bin/bash
# test-e2e.sh

set -e

echo "=== Starting IPC Server ==="
bun run ipc/ipc-server-standalone.ts &
SERVER_PID=$!
sleep 2

echo "=== Testing getPanes ==="
bun run ipc/ipc-client-cli.ts getPanes

echo "=== Testing dumpPane ==="
bun run ipc/ipc-client-cli.ts dumpPane terminal_1

echo "=== Cleanup ==="
kill $SERVER_PID

echo "=== All tests passed! ==="
```

### Test Multiple Clients

Terminal 1:
```bash
bun run ipc/ipc-server-standalone.ts
```

Terminal 2:
```bash
while true; do
  bun run ipc/ipc-client-cli.ts getPanes
  sleep 5
done
```

Terminal 3:
```bash
while true; do
  bun run ipc/ipc-client-cli.ts dumpPane terminal_1
  sleep 5
done
```

Both clients should work simultaneously without interference.

## Debugging

### Enable Debug Logging

```typescript
// In ipc-server-standalone.ts, enable verbose logging
console.error(`[DEBUG] Received message: ${JSON.stringify(msg)}`);
console.error(`[DEBUG] Sending response: ${JSON.stringify(response)}`);
```

### Check Socket

```bash
# List active sockets
ls -lh /tmp/zellij-pane-*.sock

# Test socket manually
echo '{"type":"ping"}' | nc -U /tmp/zellij-pane-default.sock

# Monitor socket with strace
strace -e trace=connect nc -U /tmp/zellij-pane-default.sock
```

### Check Process

```bash
# Find IPC server process
ps aux | grep ipc-server-standalone

# Kill if needed
pkill -f ipc-server-standalone
```

## Performance Testing

### Test Response Times

```bash
# test-performance.sh
for i in {1..100}; do
  time bun run ipc/ipc-client-cli.ts ping
done | grep real | awk '{sum+=$2; count++} END {print "Avg:", sum/count "ms"}'
```

### Test Large Dumps

```bash
# Dump full scrollback (could be large)
time bun run ipc/ipc-client-cli.ts dumpPane terminal_1 --full
```

### Test Concurrent Clients

```bash
# Start 10 concurrent clients
for i in {1..10}; do
  bun run ipc/ipc-client-cli.ts getPanes &
done
wait
```

## Troubleshooting

### IPC Server Won't Start

**Problem:** `Could not determine active Zellij session`

**Solution:**
```bash
# Make sure you're in a Zellij session
echo $ZELLIJ

# Or manually set session name
export ZELLIJ_SESSION_NAME=default
bun run ipc/ipc-server-standalone.ts
```

### Client Can't Connect

**Problem:** `Failed to connect: ENOENT`

**Solution:**
```bash
# Check if server is running
ps aux | grep ipc-server

# Check socket exists
ls -lh /tmp/zellij-pane-*.sock

# Restart server
pkill -f ipc-server-standalone
bun run ipc/ipc-server-standalone.ts
```

### Pane Metadata Not Found

**Problem:** `No pane metadata found`

**Solution:**
```bash
# Check plugin is loaded
cat /tmp/zj-pane-names.json

# If empty, restart Zellij or reload plugin
zellij action plugin-reload
```

## CI/CD Testing

### GitHub Actions Example

```yaml
name: Test IPC Protocol

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Bun
        uses: oven-sh/setup-bun@v1
      
      - name: Install Zellij
        run: |
          wget https://github.com/zellij-org/zellij/releases/download/v0.40.1/zellij-x86_64-unknown-linux-musl.tar.gz
          tar -xzf zellij-*.tar.gz
          sudo mv zellij /usr/local/bin/
      
      - name: Test IPC Protocol
        run: |
          # Create mock data
          mkdir -p /tmp
          echo '{"panes":{"terminal_1":"test"},"timestamp":1704835200}' > /tmp/zj-pane-names.json
          
          # Start server in background
          bun run ipc/ipc-server-standalone.ts &
          sleep 2
          
          # Test client
          bun run ipc/ipc-client-cli.ts getPanes
```

## Next Steps

1. Test with real OpenCode integration
2. Create performance benchmarks
3. Add stress testing suite
4. Document edge cases and error handling

## References

- [IPC Protocol Documentation](ipc/README.md)
- [Canvas API Documentation](api/canvas-api.ts)
- [OpenCode Integration Guide](docs/OPENCODE_INTEGRATION.md)
