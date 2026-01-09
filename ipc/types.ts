// IPC Message Types for Zellij Pane Communication
// Inspired by claude-canvas IPC protocol

// Messages sent from Client (AI Assistant/OpenCode) to Server (Zellij Controller)
export type ClientMessage =
  | { type: "getPanes" }
  | { type: "dumpPane"; paneId: string; options?: DumpOptions }
  | { type: "runInPane"; paneId: string; command: string }
  | { type: "newPane"; direction?: "down" | "right"; command?: string }
  | { type: "renameSession"; name: string }
  | { type: "ping" }
  | { type: "close" };

// Messages sent from Server (Zellij Controller) to Client (AI Assistant/OpenCode)
export type ServerMessage =
  | { type: "ready"; version: string }
  | { type: "panes"; data: PaneMetadata }
  | { type: "paneContent"; paneId: string; content: string; lines?: number }
  | { type: "commandExecuted"; paneId: string; command: string }
  | { type: "paneCreated"; paneId: string }
  | { type: "sessionRenamed"; name: string }
  | { type: "error"; message: string; details?: string }
  | { type: "pong" };

// Pane metadata structure
export interface PaneMetadata {
  panes: Record<string, string>;
  timestamp: number;
}

// Options for dumping pane content
export interface DumpOptions {
  full?: boolean;  // Dump entire scrollback
  lines?: number;  // Number of lines from end (default: 100)
}

// Socket path convention - similar to claude-canvas
export function getSocketPath(sessionName?: string): string {
  const session = sessionName || process.env.ZELLIJ_SESSION_NAME || "default";
  return `/tmp/zellij-pane-${session}.sock`;
}

// Message serialization helpers
export function serializeMessage(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg) + "\n";
}

export function parseMessage(data: string): ClientMessage | ServerMessage | null {
  try {
    return JSON.parse(data.trim());
  } catch {
    return null;
  }
}
