#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { $ } from "bun";

const PANE_JSON_PATH = "/tmp/zj-pane-names.json";
const ZJDUMP_PATH = `${process.env.HOME}/zjdump`;

// Default dump settings - limits scrollback to keep responses fast
const DEFAULT_DUMP_LINES = 100; // Last N lines by default

interface PaneInfo {
  panes: Record<string, string>;
  timestamp: number;
}

// Get total number of tabs in session
async function getTabCount(sessionName: string): Promise<number> {
  try {
    // Use query-tab-names which lists all tabs
    const result = await $`zellij -s ${sessionName} action query-tab-names 2>/dev/null`.text();
    return result.trim().split('\n').filter(line => line.trim()).length || 1;
  } catch {
    return 1; // Assume at least 1 tab
  }
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

// Helper to get active Zellij session name
async function getActiveSessionName(): Promise<string | null> {
  // First check env var (if we're lucky and it's set)
  if (process.env.ZELLIJ_SESSION_NAME) {
    return process.env.ZELLIJ_SESSION_NAME;
  }
  
  // Otherwise, find the active session from zellij list-sessions
  try {
    const result = await $`zellij list-sessions 2>/dev/null`.text();
    // Active sessions don't have "EXITED" in the line
    const lines = result.split('\n');
    for (const line of lines) {
      if (line && !line.includes('EXITED')) {
        // Extract session name (first word, remove ANSI codes)
        const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
        const sessionName = cleanLine.split(/\s+/)[0];
        if (sessionName) return sessionName;
      }
    }
  } catch (e) {
    console.error("Failed to get active session:", e);
  }
  return null;
}

// Resolve pane identifier to terminal ID number
// Accepts: "4", "Pane #4", "terminal_2", "opencode", etc.
// PRIORITY: Display name ("Pane #N") always takes precedence over terminal ID
function resolvePaneId(pane_id: string, metadata: PaneInfo | null): string | null {
  // If it's terminal_N format, extract N (explicit terminal ID)
  if (pane_id.startsWith('terminal_')) {
    return pane_id.replace('terminal_', '');
  }
  
  // If it's a plain number like "4", treat as "Pane #4" first
  // This is the most intuitive behavior - users see "Pane #4" in Zellij UI
  if (/^\d+$/.test(pane_id) && metadata) {
    const displayName = `pane #${pane_id}`;
    for (const [id, name] of Object.entries(metadata.panes)) {
      if (!id.startsWith('terminal_')) continue;
      if (name.toLowerCase().trim() === displayName) {
        return id.replace('terminal_', '');
      }
    }
    // No "Pane #N" found - don't fall back to terminal ID
    // This prevents confusing behavior where "4" -> terminal_4 (which might be "Pane #3")
    return null;
  }
  
  // Try to find by EXACT name match first (case-insensitive)
  // This handles "Pane #1", "Pane #2", "opencode", etc.
  if (metadata) {
    const normalizedInput = pane_id.toLowerCase().trim();
    
    for (const [id, name] of Object.entries(metadata.panes)) {
      if (!id.startsWith('terminal_')) continue;
      
      const normalizedName = name.toLowerCase().trim();
      
      // Exact match
      if (normalizedName === normalizedInput) {
        return id.replace('terminal_', '');
      }
    }
    
    // Partial/fuzzy match as fallback
    for (const [id, name] of Object.entries(metadata.panes)) {
      if (!id.startsWith('terminal_')) continue;
      
      const normalizedName = name.toLowerCase().trim();
      
      // Partial match (input is contained in name OR name is contained in input)
      if (normalizedName.includes(normalizedInput) || normalizedInput.includes(normalizedName)) {
        return id.replace('terminal_', '');
      }
    }
  }
  
  return null;
}

// Create MCP server
const server = new McpServer({
  name: "zellij-pane-mcp",
  version: "0.4.0",
});

// Tool: get_panes - List all panes with their names
server.tool(
  "get_panes",
  "Get list of all Zellij panes with their IDs and names. Use the Zellij display name (e.g., 'Pane #1', 'opencode') to reference panes in other tools.",
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

    // Format panes nicely with clear labeling
    const terminalPanes = Object.entries(metadata.panes)
      .filter(([id]) => id.startsWith("terminal_"))
      .sort((a, b) => {
        const numA = parseInt(a[0].replace('terminal_', ''));
        const numB = parseInt(b[0].replace('terminal_', ''));
        return numA - numB;
      })
      .map(([id, name]) => {
        const displayName = name || "(unnamed)";
        return `${id}: ${displayName}`;
      })
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Terminal Panes:\n${terminalPanes}\n\nTimestamp: ${new Date(metadata.timestamp * 1000).toISOString()}\n\nTip: Use the display name (e.g., "Pane #1", "opencode") or terminal ID (e.g., "2", "terminal_2") to reference panes.`,
        },
      ],
    };
  }
);

// Get the currently focused pane ID using list-clients
async function getCurrentPaneId(sessionName: string): Promise<string | null> {
  try {
    const result = await $`zellij -s ${sessionName} action list-clients 2>/dev/null`.text();
    // Output format: "1         terminal_1     /path/to/process"
    // We want the second column (terminal_N)
    const lastLine = result.trim().split('\n').pop();
    if (lastLine) {
      const parts = lastLine.trim().split(/\s+/);
      if (parts.length >= 2 && parts[1].startsWith('terminal_')) {
        return parts[1];
      }
    }
  } catch (e) {
    console.error("Failed to get current pane:", e);
  }
  return null;
}

// Get list of tab names
async function getTabNames(sessionName: string): Promise<string[]> {
  try {
    const result = await $`zellij -s ${sessionName} action query-tab-names 2>/dev/null`.text();
    return result.trim().split('\n').filter(line => line.trim());
  } catch {
    return [];
  }
}

// Navigate to target pane by cycling through all tabs and panes
// Returns true if found and focused on target, false otherwise
async function navigateToTargetPane(
  sessionName: string, 
  targetPaneId: string, 
  maxPanesPerTab: number = 10
): Promise<boolean> {
  const tabs = await getTabNames(sessionName);
  if (tabs.length === 0) tabs.push("Tab #1"); // Fallback
  
  for (const tab of tabs) {
    // Go to this tab
    await $`zellij -s ${sessionName} action go-to-tab-name ${tab} 2>/dev/null`.quiet();
    
    // Track first pane in this tab to detect wrap-around
    let firstPaneInTab: string | null = null;
    
    for (let i = 0; i < maxPanesPerTab; i++) {
      const currentPane = await getCurrentPaneId(sessionName);
      
      // Detect wrap-around (we've cycled back to start of this tab)
      if (firstPaneInTab === null) {
        firstPaneInTab = currentPane;
      } else if (currentPane === firstPaneInTab && i > 0) {
        break; // Done with this tab
      }
      
      // Check if we found our target
      if (currentPane === targetPaneId) {
        return true;
      }
      
      await $`zellij -s ${sessionName} action focus-next-pane`.quiet();
    }
  }
  
  return false;
}

// Dump a specific pane by navigating to it, dumping, then returning to origin
// Options:
//   full: true = dump entire scrollback (can be slow/large)
//   lines: N = dump last N lines (default: DEFAULT_DUMP_LINES)
async function dumpPaneSimple(
  sessionName: string, 
  targetTerminalNum: string, 
  metadata: PaneInfo | null,
  options: { full?: boolean; lines?: number } = {}
): Promise<string | null> {
  const targetPaneId = `terminal_${targetTerminalNum}`;
  const dumpFile = `/tmp/zjmcp-dump-${targetTerminalNum}.txt`;
  const { full = false, lines = DEFAULT_DUMP_LINES } = options;
  
  // Remember where we started
  const originPaneId = await getCurrentPaneId(sessionName);
  const originTab = (await getTabNames(sessionName))[0] || "Tab #1";
  
  // Build dump command - use --full flag only when explicitly requested
  const dumpCmd = full 
    ? $`zellij -s ${sessionName} action dump-screen --full ${dumpFile}`
    : $`zellij -s ${sessionName} action dump-screen ${dumpFile}`;
  
  // Quick check: are we already on the target pane?
  if (originPaneId === targetPaneId) {
    await dumpCmd.quiet();
    try {
      const content = await Bun.file(dumpFile).text();
      return full ? content : limitToLastNLines(content, lines);
    } catch {
      return null;
    }
  }
  
  // Navigate to target pane
  const found = await navigateToTargetPane(sessionName, targetPaneId);
  
  if (!found) {
    // Return to origin before failing
    if (originPaneId) {
      await navigateToTargetPane(sessionName, originPaneId);
    }
    return null;
  }
  
  // Dump the target pane
  await (full 
    ? $`zellij -s ${sessionName} action dump-screen --full ${dumpFile}`
    : $`zellij -s ${sessionName} action dump-screen ${dumpFile}`
  ).quiet();
  
  // Read the dump
  let content: string | null = null;
  try {
    const rawContent = await Bun.file(dumpFile).text();
    content = full ? rawContent : limitToLastNLines(rawContent, lines);
  } catch {}
  
  // Return to origin pane
  if (originPaneId && originPaneId !== targetPaneId) {
    await navigateToTargetPane(sessionName, originPaneId);
  }
  
  return content;
}

// Helper to get last N lines from content, stripping trailing empty lines
function limitToLastNLines(content: string, n: number): string {
  const lines = content.split('\n');
  
  // Strip trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  
  if (lines.length <= n) {
    return lines.join('\n');
  }
  
  const truncated = lines.slice(-n);
  const omitted = lines.length - n;
  return `[... ${omitted} lines omitted, showing last ${n} lines ...]\n\n${truncated.join('\n')}`;
}

// Tool: dump_pane - Get content of a specific pane using direct zellij commands
server.tool(
  "dump_pane",
  `Dump the scrollback content of a specific terminal pane. Can use terminal ID (e.g., '2' or 'terminal_2') or display name (e.g., 'Pane #2', 'opencode').

By default, returns last ${DEFAULT_DUMP_LINES} lines for faster responses. Use 'full: true' for complete scrollback, or 'lines: N' to customize.`,
  {
    pane_id: z
      .string()
      .describe("Pane identifier - Zellij display name (e.g., 'Pane #1', 'Pane #2', 'opencode') OR terminal ID (e.g., '2', 'terminal_2')"),
    full: z
      .boolean()
      .optional()
      .describe("If true, dump entire scrollback history (can be slow/large). Default: false"),
    lines: z
      .number()
      .optional()
      .describe(`Number of lines to return from end of scrollback. Default: ${DEFAULT_DUMP_LINES}. Ignored if 'full' is true.`),
  },
  async ({ pane_id, full = false, lines }) => {
    try {
      const sessionName = await getActiveSessionName();
      if (!sessionName) {
        return {
          content: [{ type: "text", text: "Could not determine active Zellij session." }],
        };
      }

      const metadata = await getPaneMetadata();
      const terminalNum = resolvePaneId(pane_id, metadata);
      
      if (!terminalNum) {
        const availablePanes = metadata 
          ? Object.entries(metadata.panes)
              .filter(([id]) => id.startsWith('terminal_'))
              .map(([id, name]) => `  ${id}: ${name}`)
              .join('\n')
          : 'No pane metadata available';
        return {
          content: [{ type: "text", text: `Could not resolve pane '${pane_id}'\n\nAvailable panes:\n${availablePanes}` }],
        };
      }

      // Build options for dump
      const dumpOptions: { full?: boolean; lines?: number } = { full };
      if (lines !== undefined && !full) {
        dumpOptions.lines = lines;
      }

      // Use simple brute-force approach: visit all tabs/panes, dump everything, return the right one
      const content = await dumpPaneSimple(sessionName, terminalNum, metadata, dumpOptions);
      
      if (!content) {
        return {
          content: [{ type: "text", text: `Could not dump terminal_${terminalNum}. Pane may not exist.` }],
        };
      }
      
      return { content: [{ type: "text", text: content }] };
      
    } catch (e: any) {
      return { content: [{ type: "text", text: `Failed to dump pane '${pane_id}': ${e.message}` }] };
    }
  }
);

// Tool: run_in_pane - Run a command in a specific pane
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
      const sessionName = await getActiveSessionName();
      if (!sessionName) {
        return { content: [{ type: "text", text: "Could not determine active Zellij session." }] };
      }

      const metadata = await getPaneMetadata();
      const terminalNum = resolvePaneId(pane_id, metadata);
      
      if (!terminalNum) {
        return { content: [{ type: "text", text: `Could not resolve pane '${pane_id}'` }] };
      }

      const targetPaneId = `terminal_${terminalNum}`;
      
      // Remember where we started
      const originPaneId = await getCurrentPaneId(sessionName);
      
      // Navigate to target
      if (originPaneId !== targetPaneId) {
        const found = await navigateToTargetPane(sessionName, targetPaneId);
        if (!found) {
          // Return to origin before failing
          if (originPaneId) {
            await navigateToTargetPane(sessionName, originPaneId);
          }
          return { content: [{ type: "text", text: `Could not navigate to ${targetPaneId}` }] };
        }
      }
      
      // Write the command
      await $`zellij -s ${sessionName} action write-chars ${command}`.quiet();
      await $`zellij -s ${sessionName} action write 10`.quiet(); // Enter
      
      // Return to origin
      if (originPaneId && originPaneId !== targetPaneId) {
        await navigateToTargetPane(sessionName, originPaneId);
      }
      
      return { content: [{ type: "text", text: `Executed in ${targetPaneId}: ${command}` }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Failed to run command in pane ${pane_id}: ${e.message}` }] };
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
      const sessionName = await getActiveSessionName();
      if (!sessionName) {
        return {
          content: [{ type: "text", text: "Could not determine active Zellij session." }],
        };
      }
      
      if (command) {
        await $`zellij -s ${sessionName} action new-pane -d ${direction} -- ${command}`.quiet();
      } else {
        await $`zellij -s ${sessionName} action new-pane -d ${direction}`.quiet();
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
      const sessionName = await getActiveSessionName();
      if (!sessionName) {
        return {
          content: [{ type: "text", text: "Could not determine active Zellij session." }],
        };
      }
      
      await $`zellij -s ${sessionName} action rename-session ${name}`.quiet();
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
  console.error("Zellij Pane MCP server v0.4.0 running on stdio (smart dump limiting)");
}

main().catch(console.error);

// v0.4.0 - Smart dump limiting (default 100 lines, optional full dump)
