#!/usr/bin/env bun
// IPC Client Example - Testing the IPC protocol
// This demonstrates how to connect to the Zellij Canvas IPC server

import { connectWithRetry } from "../ipc/client";
import { getSocketPath } from "../ipc/types";
import type { ServerMessage } from "../ipc/types";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "getPanes";

  // Get socket path from session name (or use default)
  const sessionName = process.env.ZELLIJ_SESSION_NAME;
  const socketPath = getSocketPath(sessionName);

  console.error(`Connecting to ${socketPath}...`);

  try {
    const client = await connectWithRetry({
      socketPath,
      
      onMessage: (msg: ServerMessage) => {
        console.log("\nReceived:", JSON.stringify(msg, null, 2));
        
        // Exit after receiving response (for simple CLI usage)
        if (msg.type !== "ready") {
          client.close();
          process.exit(0);
        }
      },

      onDisconnect: () => {
        console.error("Disconnected from server");
      },

      onError: (error: Error) => {
        console.error("Client error:", error.message);
      }
    });

    console.error("Connected!");

    // Send command based on CLI args
    switch (command) {
      case "ping":
        client.send({ type: "ping" });
        break;

      case "getPanes":
        client.send({ type: "getPanes" });
        break;

      case "dumpPane": {
        const paneId = args[1] || "terminal_1";
        const full = args[2] === "--full";
        client.send({ 
          type: "dumpPane", 
          paneId, 
          options: { full, lines: full ? undefined : 50 }
        });
        break;
      }

      case "runInPane": {
        const paneId = args[1] || "terminal_1";
        const cmd = args.slice(2).join(" ") || "echo 'Hello from IPC'";
        client.send({ 
          type: "runInPane", 
          paneId, 
          command: cmd 
        });
        break;
      }

      case "newPane": {
        const direction = (args[1] as "down" | "right") || "down";
        const cmd = args.slice(2).join(" ");
        client.send({ 
          type: "newPane", 
          direction,
          command: cmd || undefined
        });
        break;
      }

      case "renameSession": {
        const name = args[1] || "my-session";
        client.send({ 
          type: "renameSession", 
          name 
        });
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.error("Usage: ipc-client-cli.ts [command] [args...]");
        console.error("Commands:");
        console.error("  ping");
        console.error("  getPanes");
        console.error("  dumpPane <paneId> [--full]");
        console.error("  runInPane <paneId> <command>");
        console.error("  newPane [down|right] [command]");
        console.error("  renameSession <name>");
        client.close();
        process.exit(1);
    }

    // Keep alive for response
    setTimeout(() => {
      console.error("\nTimeout - no response received");
      client.close();
      process.exit(1);
    }, 5000);

  } catch (e) {
    console.error("Failed to connect:", e);
    process.exit(1);
  }
}

main();
