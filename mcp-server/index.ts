#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { $ } from "bun";

const PANE_JSON_PATH = "/tmp/zj-pane-names.json";
const ZJDUMP_PATH = `${process.env.HOME}/zjdump`;

interface PaneInfo {
  panes: Record<string, string>;
  timestamp: number;
}

// Helper to read pane metadata
async function getPaneMetadata(): Promise<PaneInfo | null> {
  try {
    const file = Bun.file(PANE_JSON_PATH);
    if (await file.exists()) {
      return await file.json();
    }
  } catch (e) {
    console.error("Failed to read pane metadata:", e);
  }
  return null;
}

// Create MCP server
const server = new McpServer({
  name: "zellij-pane-mcp",
  version: "0.2.0",
});

// Tool: get_panes - List all panes with their names
server.tool(
  "get_panes",
  "Get list of all Zellij panes with their IDs and names",
  {},
  async () => {
    const metadata = await getPaneMetadata();
    if (!metadata) {
      return {
        content: [
          {
            type: "text",
            text: "No pane metadata found. Is the zellij-pane-tracker plugin running?",
          },
        ],
      };
    }

    // Format panes nicely
    const terminalPanes = Object.entries(metadata.panes)
      .filter(([id]) => id.startsWith("terminal_"))
      .map(([id, name]) => `${id}: ${name || "(unnamed)"}`)
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Terminal Panes:\n${terminalPanes}\n\nTimestamp: ${new Date(metadata.timestamp * 1000).toISOString()}`,
        },
      ],
    };
  }
);

// Tool: dump_pane - Get content of a specific pane using ~/zjdump
server.tool(
  "dump_pane",
  "Dump the full scrollback content of a specific terminal pane. Can use terminal ID (e.g., '2' or 'terminal_2') or display name (e.g., 'Pane #2', 'opencode').",
  {
    pane_id: z
      .string()
      .describe("Pane identifier - terminal ID (e.g., '2', 'terminal_2') or display name (e.g., 'Pane #2', 'opencode')"),
  },
  async ({ pane_id }) => {
    try {
      // Use ~/zjdump which handles all the complexity of finding and dumping panes
      // Explicitly pass ZELLIJ env vars to ensure they're available in the subprocess
      const result = await $`${ZJDUMP_PATH} ${pane_id}`.env({
        ...process.env,
        ZELLIJ: process.env.ZELLIJ || "0",
        ZELLIJ_SESSION_NAME: process.env.ZELLIJ_SESSION_NAME || "",
      }).text();
      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (e: any) {
      // Include diagnostic info about env vars
      const envInfo = `ZELLIJ=${process.env.ZELLIJ}, SESSION=${process.env.ZELLIJ_SESSION_NAME}`;
      return {
        content: [
          {
            type: "text",
            text: `Failed to dump pane '${pane_id}': ${e.message}\n\nEnv: ${envInfo}\n\nMake sure:\n1. You're running inside a Zellij session\n2. The pane-tracker plugin is running\n3. ~/zjdump exists and is executable`,
          },
        ],
      };
    }
  }
);

// Tool: run_in_pane - Run a command in a specific pane
// Note: This uses zjexec shell function approach
server.tool(
  "run_in_pane",
  "Run a shell command in a specific pane (by cycling to it, running command, returning)",
  {
    pane_id: z
      .string()
      .describe("Pane identifier - terminal ID (e.g., '2') or display name"),
    command: z.string().describe("Command to run"),
  },
  async ({ pane_id, command }) => {
    try {
      // Use zjexec approach: source zshrc to get the function, then call it
      const result = await $`zsh -c 'source ~/.zshrc && zjexec ${pane_id} "${command}"'`.text();
      return {
        content: [
          {
            type: "text",
            text: result || `Executed in pane ${pane_id}: ${command}`,
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to run command in pane ${pane_id}: ${e.message}`,
          },
        ],
      };
    }
  }
);

// Tool: new_pane - Create a new pane
server.tool(
  "new_pane",
  "Create a new terminal pane",
  {
    direction: z
      .enum(["down", "right"])
      .optional()
      .describe("Direction to split (default: down)"),
    command: z
      .string()
      .optional()
      .describe("Optional command to run in new pane"),
  },
  async ({ direction = "down", command }) => {
    try {
      if (command) {
        await $`zellij action new-pane -d ${direction} -- ${command}`.quiet();
      } else {
        await $`zellij action new-pane -d ${direction}`.quiet();
      }
      return {
        content: [
          {
            type: "text",
            text: `Created new pane (${direction})${command ? ` running: ${command}` : ""}`,
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `Failed to create pane: ${e.message}` }],
      };
    }
  }
);

// Tool: rename_session - Rename current Zellij session
server.tool(
  "rename_session",
  "Rename the current Zellij session",
  {
    name: z.string().describe("New session name"),
  },
  async ({ name }) => {
    try {
      await $`zsh -c 'source ~/.zshrc && zjrename ${name}'`.quiet();
      return {
        content: [{ type: "text", text: `Session renamed to: ${name}` }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `Failed to rename session: ${e.message}` }],
      };
    }
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Zellij Pane MCP server v0.2.0 running on stdio");
}

main().catch(console.error);
