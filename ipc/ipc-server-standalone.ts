#!/usr/bin/env bun
// IPC Server Implementation - Zellij Controller
// This server listens on a Unix domain socket and handles client requests
// using the Canvas API abstraction

import { createIPCServer } from "../ipc/server";
import { getSocketPath } from "../ipc/types";
import { ZellijCanvas } from "../api/canvas-api";
import type { ClientMessage, ServerMessage } from "../ipc/types";

const VERSION = "1.0.0";

async function main() {
  const canvas = new ZellijCanvas();
  const sessionName = await canvas.getSessionName();
  
  if (!sessionName) {
    console.error("Could not determine active Zellij session");
    process.exit(1);
  }

  const socketPath = getSocketPath(sessionName);
  console.error(`Starting IPC server on ${socketPath}`);
  console.error(`Zellij Canvas IPC Server v${VERSION}`);

  const server = await createIPCServer({
    socketPath,
    
    onMessage: async (msg: ClientMessage, clientId: string) => {
      console.error(`[${clientId}] Received: ${msg.type}`);
      
      try {
        let response: ServerMessage;
        
        switch (msg.type) {
          case "ping":
            response = { type: "pong" };
            break;

          case "getPanes": {
            const metadata = await canvas.getPaneMetadata();
            if (metadata) {
              response = { type: "panes", data: metadata };
            } else {
              response = { 
                type: "error", 
                message: "Could not read pane metadata",
                details: "Is the zellij-pane-tracker plugin running?"
              };
            }
            break;
          }

          case "dumpPane": {
            const content = await canvas.dumpPane(msg.paneId, msg.options);
            if (content !== null) {
              response = { 
                type: "paneContent", 
                paneId: msg.paneId, 
                content,
                lines: msg.options?.lines
              };
            } else {
              response = { 
                type: "error", 
                message: `Could not dump pane ${msg.paneId}` 
              };
            }
            break;
          }

          case "runInPane": {
            const success = await canvas.runInPane(msg.paneId, msg.command);
            if (success) {
              response = { 
                type: "commandExecuted", 
                paneId: msg.paneId, 
                command: msg.command 
              };
            } else {
              response = { 
                type: "error", 
                message: `Could not run command in pane ${msg.paneId}` 
              };
            }
            break;
          }

          case "newPane": {
            const success = await canvas.createPane({
              direction: msg.direction,
              command: msg.command
            });
            if (success) {
              response = { 
                type: "paneCreated", 
                paneId: "new" // TODO: Get actual new pane ID
              };
            } else {
              response = { 
                type: "error", 
                message: "Could not create pane" 
              };
            }
            break;
          }

          case "renameSession": {
            const success = await canvas.renameSession(msg.name);
            if (success) {
              response = { 
                type: "sessionRenamed", 
                name: msg.name 
              };
            } else {
              response = { 
                type: "error", 
                message: "Could not rename session" 
              };
            }
            break;
          }

          case "close":
            console.error(`[${clientId}] Client requested close`);
            server.close();
            process.exit(0);

          default:
            response = { 
              type: "error", 
              message: `Unknown message type: ${(msg as any).type}` 
            };
        }

        server.send(clientId, response);
      } catch (e: any) {
        const errorResponse: ServerMessage = {
          type: "error",
          message: e.message || "Unknown error",
          details: e.stack
        };
        server.send(clientId, errorResponse);
      }
    },

    onClientConnect: (clientId: string) => {
      console.error(`[${clientId}] Client connected`);
      server.send(clientId, { type: "ready", version: VERSION });
    },

    onClientDisconnect: (clientId: string) => {
      console.error(`[${clientId}] Client disconnected`);
    },

    onError: (error: Error) => {
      console.error("Server error:", error);
    }
  });

  console.error(`Server ready. Clients: ${server.getClientCount()}`);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.error('\nShutting down...');
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('\nShutting down...');
    server.close();
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

main().catch(console.error);
