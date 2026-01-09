// IPC Server - Zellij Controller side
// Listens on a Unix domain socket for client commands
// Inspired by claude-canvas IPC architecture

import type { ClientMessage, ServerMessage } from "./types";
import { unlinkSync, existsSync } from "fs";

export interface IPCServerOptions {
  socketPath: string;
  onMessage: (msg: ClientMessage, clientId: string) => void;
  onClientConnect?: (clientId: string) => void;
  onClientDisconnect?: (clientId: string) => void;
  onError?: (error: Error) => void;
}

export interface IPCServer {
  broadcast: (msg: ServerMessage) => void;
  send: (clientId: string, msg: ServerMessage) => void;
  close: () => void;
  getClientCount: () => number;
}

export async function createIPCServer(options: IPCServerOptions): Promise<IPCServer> {
  const { socketPath, onMessage, onClientConnect, onClientDisconnect, onError } = options;

  // Remove existing socket file if it exists
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  const clients = new Map<string, any>();
  const clientBuffers = new Map<string, string>();
  let nextClientId = 1;

  const server = Bun.listen({
    unix: socketPath,
    socket: {
      open(socket) {
        const clientId = `client_${nextClientId++}`;
        clients.set(clientId, socket);
        clientBuffers.set(clientId, "");
        onClientConnect?.(clientId);
      },

      data(socket, data) {
        // Find which client this socket belongs to
        let clientId: string | null = null;
        for (const [id, client] of clients.entries()) {
          if (client === socket) {
            clientId = id;
            break;
          }
        }

        if (!clientId) return;

        // Accumulate data and parse complete JSON messages
        let buffer = clientBuffers.get(clientId) || "";
        buffer += data.toString();

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        clientBuffers.set(clientId, buffer);

        for (const line of lines) {
          if (line.trim()) {
            try {
              const msg = JSON.parse(line) as ClientMessage;
              onMessage(msg, clientId);
            } catch (e) {
              onError?.(new Error(`Failed to parse message: ${line}`));
            }
          }
        }
      },

      close(socket) {
        // Find and remove the client
        for (const [id, client] of clients.entries()) {
          if (client === socket) {
            clients.delete(id);
            clientBuffers.delete(id);
            onClientDisconnect?.(id);
            break;
          }
        }
      },

      error(socket, error) {
        onError?.(error);
      },
    },
  });

  return {
    broadcast(msg: ServerMessage) {
      const data = JSON.stringify(msg) + "\n";
      for (const client of clients.values()) {
        try {
          client.write(data);
        } catch (e) {
          onError?.(e as Error);
        }
      }
    },

    send(clientId: string, msg: ServerMessage) {
      const client = clients.get(clientId);
      if (client) {
        try {
          const data = JSON.stringify(msg) + "\n";
          client.write(data);
        } catch (e) {
          onError?.(e as Error);
        }
      }
    },

    close() {
      server.stop();
      if (existsSync(socketPath)) {
        unlinkSync(socketPath);
      }
      clients.clear();
      clientBuffers.clear();
    },

    getClientCount() {
      return clients.size;
    },
  };
}
