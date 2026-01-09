# IPC Protocol Quick Reference

## Socket Location
```
/tmp/zellij-pane-{session-name}.sock
```

## Message Format
All messages are JSON objects terminated by newline (`\n`).

## Client → Server Messages

### getPanes
Get list of all panes with their IDs and names.

```json
{ "type": "getPanes" }
```

**Response:**
```json
{
  "type": "panes",
  "data": {
    "panes": {
      "terminal_1": "zsh",
      "terminal_2": "Pane #1",
      "terminal_3": "nvim"
    },
    "timestamp": 1704835200
  }
}
```

---

### dumpPane
Get scrollback content from a specific pane.

```json
{
  "type": "dumpPane",
  "paneId": "terminal_2",
  "options": {
    "full": false,
    "lines": 100
  }
}
```

**Parameters:**
- `paneId` (string, required): Terminal ID (e.g., "terminal_2")
- `options.full` (boolean, optional): Dump entire scrollback (default: false)
- `options.lines` (number, optional): Number of lines from end (default: 100)

**Response:**
```json
{
  "type": "paneContent",
  "paneId": "terminal_2",
  "content": "... pane content ...",
  "lines": 100
}
```

---

### runInPane
Execute a shell command in a specific pane.

```json
{
  "type": "runInPane",
  "paneId": "terminal_2",
  "command": "npm test"
}
```

**Parameters:**
- `paneId` (string, required): Terminal ID
- `command` (string, required): Shell command to execute

**Response:**
```json
{
  "type": "commandExecuted",
  "paneId": "terminal_2",
  "command": "npm test"
}
```

---

### newPane
Create a new terminal pane.

```json
{
  "type": "newPane",
  "direction": "down",
  "command": "htop"
}
```

**Parameters:**
- `direction` (string, optional): "down" or "right" (default: "down")
- `command` (string, optional): Command to run in new pane

**Response:**
```json
{
  "type": "paneCreated",
  "paneId": "terminal_4"
}
```

---

### renameSession
Rename the current Zellij session.

```json
{
  "type": "renameSession",
  "name": "my-coding-session"
}
```

**Parameters:**
- `name` (string, required): New session name

**Response:**
```json
{
  "type": "sessionRenamed",
  "name": "my-coding-session"
}
```

---

### ping
Test server connectivity.

```json
{ "type": "ping" }
```

**Response:**
```json
{ "type": "pong" }
```

---

### close
Request server shutdown (development only).

```json
{ "type": "close" }
```

**Response:** Server closes connection and exits.

---

## Server → Client Messages

### ready
Sent when client connects.

```json
{
  "type": "ready",
  "version": "1.0.0"
}
```

---

### error
Sent when an error occurs.

```json
{
  "type": "error",
  "message": "Could not find pane terminal_99",
  "details": "Error: No such pane"
}
```

---

## Error Codes

| Error | Meaning |
|-------|---------|
| `Could not determine active Zellij session` | Not running in Zellij or ZELLIJ_SESSION_NAME not set |
| `No pane metadata found` | Plugin not loaded or not writing to `/tmp/zj-pane-names.json` |
| `Could not resolve pane {id}` | Pane ID not found in metadata |
| `Could not dump pane {id}` | Pane exists but dump failed (might not be accessible) |
| `Could not run command in pane {id}` | Command execution failed |
| `Could not create pane` | Pane creation failed |
| `Could not rename session` | Session rename failed |
| `Unknown message type` | Client sent invalid message type |

## Example Session

```bash
# Terminal 1: Start server
$ bun run ipc/ipc-server-standalone.ts
Starting IPC server on /tmp/zellij-pane-default.sock
Zellij Canvas IPC Server v1.0.0
Server ready. Clients: 0

# Terminal 2: Connect client
$ echo '{"type":"getPanes"}' | nc -U /tmp/zellij-pane-default.sock
{"type":"panes","data":{"panes":{"terminal_1":"zsh","terminal_2":"Pane #1"},"timestamp":1704835200}}

$ echo '{"type":"dumpPane","paneId":"terminal_1","options":{"lines":5}}' | nc -U /tmp/zellij-pane-default.sock
{"type":"paneContent","paneId":"terminal_1","content":"$ ls\napi  docs  ipc  mcp-server\n$ ","lines":5}

$ echo '{"type":"runInPane","paneId":"terminal_1","command":"echo hello"}' | nc -U /tmp/zellij-pane-default.sock
{"type":"commandExecuted","paneId":"terminal_1","command":"echo hello"}
```

## TypeScript Client Example

```typescript
import { connectWithRetry, getSocketPath } from "zellij-pane-tracker/ipc";

const client = await connectWithRetry({
  socketPath: getSocketPath(),
  
  onMessage: (msg) => {
    switch (msg.type) {
      case "ready":
        console.log("Connected! Version:", msg.version);
        break;
      
      case "panes":
        console.log("Panes:", msg.data.panes);
        break;
      
      case "paneContent":
        console.log(`Content from ${msg.paneId}:`, msg.content);
        break;
      
      case "error":
        console.error("Error:", msg.message);
        break;
    }
  },
  
  onDisconnect: () => {
    console.log("Disconnected from server");
  }
});

// Send messages
client.send({ type: "getPanes" });
client.send({ 
  type: "dumpPane", 
  paneId: "terminal_2",
  options: { lines: 50 }
});
client.send({
  type: "runInPane",
  paneId: "terminal_2",
  command: "npm test"
});
```

## Python Client Example

```python
import socket
import json

class ZellijIPCClient:
    def __init__(self, socket_path):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(socket_path)
        self.buffer = ""
    
    def send(self, msg):
        data = json.dumps(msg) + "\n"
        self.sock.sendall(data.encode())
    
    def receive(self):
        while "\n" not in self.buffer:
            data = self.sock.recv(4096).decode()
            if not data:
                return None
            self.buffer += data
        
        line, self.buffer = self.buffer.split("\n", 1)
        return json.loads(line)

# Usage
client = ZellijIPCClient("/tmp/zellij-pane-default.sock")

# Wait for ready message
ready = client.receive()
print(f"Connected! Version: {ready['version']}")

# Get panes
client.send({"type": "getPanes"})
response = client.receive()
print(f"Panes: {response['data']['panes']}")

# Dump pane
client.send({
    "type": "dumpPane",
    "paneId": "terminal_2",
    "options": {"lines": 50}
})
response = client.receive()
print(f"Content: {response['content'][:100]}...")
```

## See Also

- [IPC Protocol Documentation](README.md)
- [Canvas API Reference](../api/canvas-api.ts)
- [Testing Guide](TESTING.md)
- [OpenCode Integration Guide](OPENCODE_INTEGRATION.md)
