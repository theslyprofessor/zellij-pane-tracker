#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { $ } from "bun";

const PANE_JSON_PATH = "/tmp/zj-pane-names.json";

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

// Helper to check if we're in Zellij
async function inZellij(): Promise<boolean> {
  return !!process.env.ZELLIJ;
}

// Helper to run zellij action
async function zellijAction(...args: string[]): Promise<string> {
  try {
    const result = await $`zellij action ${args}`.text();
    return result.trim();
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

// Create MCP server
const server = new McpServer({
  name: "zellij-pane-mcp",
  version: "0.1.0",
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

    const pluginPanes = Object.entries(metadata.panes)
      .filter(([id]) => id.startsWith("plugin_"))
      .map(([id, name]) => `${id}: ${name}`)
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Terminal Panes:\n${terminalPanes}\n\nPlugin Panes:\n${pluginPanes}\n\nTimestamp: ${new Date(metadata.timestamp * 1000).toISOString()}`,
        },
      ],
    };
  }
);

// Tool: dump_pane - Get content of a specific pane
server.tool(
  "dump_pane",
  "Dump the visible content of a specific terminal pane",
  {
    pane_id: z
      .string()
      .describe("Pane ID (e.g., 'terminal_2' or just '2')"),
  },
  async ({ pane_id }) => {
    // Normalize pane_id
    const normalizedId = pane_id.startsWith("terminal_")
      ? pane_id
      : `terminal_${pane_id}`;
    const paneNum = normalizedId.replace("terminal_", "");

    const dumpFile = `/tmp/zjd-${paneNum}.txt`;

    try {
      // Use the zjdump approach: dump-screen to file
      await $`zellij action dump-screen -p ${normalizedId} ${dumpFile}`.quiet();

      const file = Bun.file(dumpFile);
      if (await file.exists()) {
        const content = await file.text();
        return {
          content: [
            {
              type: "text",
              text: `Content of ${normalizedId}:\n\n${content}`,
            },
          ],
        };
      }
    } catch (e: any) {
      // Fallback: try alternative dump method
      try {
        const result =
          await $`zellij action dump-screen -p ${normalizedId}`.text();
        return {
          content: [{ type: "text", text: `Content of ${normalizedId}:\n\n${result}` }],
        };
      } catch (e2: any) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to dump pane ${normalizedId}: ${e2.message}. Make sure the pane exists and you're in Zellij.`,
            },
          ],
        };
      }
    }

    return {
      content: [{ type: "text", text: `No content found for ${normalizedId}` }],
    };
  }
);

// Tool: focus_pane - Switch focus to a pane
server.tool(
  "focus_pane",
  "Focus/switch to a specific pane",
  {
    pane_id: z
      .string()
      .describe("Pane ID (e.g., 'terminal_2' or just '2')"),
  },
  async ({ pane_id }) => {
    const normalizedId = pane_id.startsWith("terminal_")
      ? pane_id
      : `terminal_${pane_id}`;

    try {
      await $`zellij action focus-pane -p ${normalizedId}`.quiet();
      return {
        content: [{ type: "text", text: `Focused on ${normalizedId}` }],
      };
    } catch (e: any) {
      return {
        content: [
          { type: "text", text: `Failed to focus ${normalizedId}: ${e.message}` },
        ],
      };
    }
  }
);

// Tool: send_keys - Send keystrokes to a pane
server.tool(
  "send_keys",
  "Send keystrokes to a specific pane (runs command if ending with Enter)",
  {
    pane_id: z
      .string()
      .describe("Pane ID (e.g., 'terminal_2' or just '2')"),
    keys: z
      .string()
      .describe("Keys to send (use \\n for Enter, or end with \\n to execute)"),
  },
  async ({ pane_id, keys }) => {
    const normalizedId = pane_id.startsWith("terminal_")
      ? pane_id
      : `terminal_${pane_id}`;

    try {
      // Write keys using zellij action write
      await $`zellij action write-chars -p ${normalizedId} ${keys}`.quiet();
      return {
        content: [
          { type: "text", text: `Sent keys to ${normalizedId}: "${keys}"` },
        ],
      };
    } catch (e: any) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to send keys to ${normalizedId}: ${e.message}`,
          },
        ],
      };
    }
  }
);

// Tool: run_in_pane - Run a command in a specific pane
server.tool(
  "run_in_pane",
  "Run a shell command in a specific pane",
  {
    pane_id: z
      .string()
      .describe("Pane ID (e.g., 'terminal_2' or just '2')"),
    command: z.string().describe("Command to run"),
  },
  async ({ pane_id, command }) => {
    const normalizedId = pane_id.startsWith("terminal_")
      ? pane_id
      : `terminal_${pane_id}`;

    try {
      // Write command and press enter
      await $`zellij action write-chars -p ${normalizedId} ${command}`.quiet();
      await $`zellij action write -p ${normalizedId} 10`.quiet(); // 10 = Enter key
      return {
        content: [
          {
            type: "text",
            text: `Executed in ${normalizedId}: ${command}`,
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to run command in ${normalizedId}: ${e.message}`,
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

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Zellij Pane MCP server running on stdio");
}

main().catch(console.error);
