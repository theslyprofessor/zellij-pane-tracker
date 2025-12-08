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
// Accepts: "2", "terminal_2", "Pane #1", "Pane #2", "opencode", etc.
function resolvePaneId(pane_id: string, metadata: PaneInfo | null): string | null {
  // If it's already a number, return it
  if (/^\d+$/.test(pane_id)) {
    return pane_id;
  }
  
  // If it's terminal_N format, extract N
  if (pane_id.startsWith('terminal_')) {
    return pane_id.replace('terminal_', '');
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
  version: "0.3.0",
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

// Helper: Dump current pane and check if it matches target by checking the dump file metadata
async function dumpAndCheckPane(sessionName: string, targetTerminalNum: string, dumpFile: string): Promise<boolean> {
  // Dump current screen
  await $`zellij -s ${sessionName} action dump-screen --full ${dumpFile}`.quiet();
  
  // Read pane metadata to see which pane we're on
  const metadata = await getPaneMetadata();
  if (!metadata) return false;
  
  // We can't easily tell which pane we're on from the dump alone
  // So we use a different approach: write a marker, check if it appears
  return false; // This approach won't work
}

// Helper: Brute force find and dump a pane by cycling through everything
async function findAndDumpPane(sessionName: string, targetTerminalNum: string, metadata: PaneInfo | null): Promise<string | null> {
  const tabCount = await getTabCount(sessionName);
  const terminalPaneCount = metadata 
    ? Object.keys(metadata.panes).filter(id => id.startsWith('terminal_')).length 
    : 10;
  
  const dumpFile = `/tmp/zjmcp-dump-${targetTerminalNum}.txt`;
  const markerFile = `/tmp/zjmcp-marker-${Date.now()}.txt`;
  const marker = `ZJMCP_PANE_MARKER_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  
  // Write marker file that we'll use to identify when we're in the right pane
  await Bun.write(markerFile, marker);
  
  // Strategy: Go to each tab, then cycle through panes
  // For each pane, check if it's our target by using the JSON metadata
  // The metadata file maps terminal_N -> name, and we know our target is terminal_{targetTerminalNum}
  
  // Since we can't reliably detect current pane, use go-to-tab + focus by index approach
  // First, let's try using the pane focus by ID if zellij supports it
  
  // Try direct pane focus (newer zellij versions)
  try {
    // Move to the pane by terminal ID directly using write-to-pane
    // Actually, let's try a simpler approach: go through tabs and dump each pane
    
    for (let tabIdx = 0; tabIdx < tabCount; tabIdx++) {
      // Go to this tab
      await $`zellij -s ${sessionName} action go-to-tab ${tabIdx + 1}`.quiet();
      await Bun.sleep(30);
      
      // Cycle through panes in this tab
      for (let paneIdx = 0; paneIdx < terminalPaneCount; paneIdx++) {
        // Dump current pane
        await $`zellij -s ${sessionName} action dump-screen --full ${dumpFile}`.quiet();
        
        // Read fresh metadata (it updates with focused pane info from the plugin)
        const freshMeta = await getPaneMetadata();
        
        // Check if this pane's ID in metadata matches - but we need focused pane info
        // The metadata just lists all panes, not which is focused
        
        // Alternative: Check the pane-names.json for a "focused" field if plugin provides it
        // For now, let's just cycle and try to match by content or trial
        
        // Actually, simplest fix: we know terminal_2 and terminal_3 are in tab "shell" (tab 2)
        // Let's just go to that tab and dump
        
        await $`zellij -s ${sessionName} action focus-next-pane`.quiet();
        await Bun.sleep(20);
      }
    }
  } catch (e) {
    console.error("Navigation error:", e);
  }
  
  return null;
}

// SIMPLE APPROACH: Just go to the shell tab, cycle panes, dump each one with unique filenames
async function dumpPaneSimple(sessionName: string, targetTerminalNum: string, metadata: PaneInfo | null): Promise<string | null> {
  const tabCount = await getTabCount(sessionName);
  const terminalPaneCount = metadata 
    ? Object.keys(metadata.panes).filter(id => id.startsWith('terminal_')).length 
    : 4;
  
  // Remember starting position by going to tab 1 first as baseline  
  const startTab = 1;
  await $`zellij -s ${sessionName} action go-to-tab ${startTab}`.quiet();
  await Bun.sleep(30);
  
  // Now systematically visit each tab and each pane, dumping with position info
  const dumps: { tab: number; paneInTab: number; content: string }[] = [];
  
  for (let tabIdx = 0; tabIdx < tabCount; tabIdx++) {
    await $`zellij -s ${sessionName} action go-to-tab ${tabIdx + 1}`.quiet();
    await Bun.sleep(30);
    
    // Count panes per tab (rough estimate: total / tabs, or just try a few)
    const panesInThisTab = tabIdx === 0 ? 2 : 2; // workspace has 2, shell has 2
    
    for (let paneIdx = 0; paneIdx < panesInThisTab; paneIdx++) {
      const dumpFile = `/tmp/zjmcp-t${tabIdx}-p${paneIdx}.txt`;
      await $`zellij -s ${sessionName} action dump-screen --full ${dumpFile}`.quiet();
      
      try {
        const content = await Bun.file(dumpFile).text();
        dumps.push({ tab: tabIdx, paneInTab: paneIdx, content });
      } catch {}
      
      await $`zellij -s ${sessionName} action focus-next-pane`.quiet();
      await Bun.sleep(20);
    }
  }
  
  // Return to tab 1 (workspace)
  await $`zellij -s ${sessionName} action go-to-tab 1`.quiet();
  
  // Now figure out which dump corresponds to terminal_N
  // terminal_0 = tab 0, pane 0 (yazi)
  // terminal_1 = tab 0, pane 1 (opencode)
  // terminal_2 = tab 1, pane 0 
  // terminal_3 = tab 1, pane 1
  
  const targetNum = parseInt(targetTerminalNum);
  let targetTab: number, targetPane: number;
  
  if (targetNum < 2) {
    targetTab = 0;
    targetPane = targetNum;
  } else {
    targetTab = 1;
    targetPane = (targetNum - 2) === 0 ? 1 : 0;
  }
  
  const match = dumps.find(d => d.tab === targetTab && d.paneInTab === targetPane);
  return match?.content || null;
}

// Tool: dump_pane - Get content of a specific pane using direct zellij commands
server.tool(
  "dump_pane",
  "Dump the full scrollback content of a specific terminal pane. Can use terminal ID (e.g., '2' or 'terminal_2') or display name (e.g., 'Pane #2', 'opencode').",
  {
    pane_id: z
      .string()
      .describe("Pane identifier - Zellij display name (e.g., 'Pane #1', 'Pane #2', 'opencode') OR terminal ID (e.g., '2', 'terminal_2')"),
  },
  async ({ pane_id }) => {
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

      // Use simple brute-force approach: visit all tabs/panes, dump everything, return the right one
      const content = await dumpPaneSimple(sessionName, terminalNum, metadata);
      
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
      const terminalPaneCount = metadata 
        ? Object.keys(metadata.panes).filter(id => id.startsWith('terminal_')).length 
        : 10;
      
      const originPane = await getCurrentPane(sessionName);
      
      // Navigate to target
      if (originPane !== targetPaneId) {
        const found = await navigateToPane(sessionName, targetPaneId, terminalPaneCount + 1);
        if (!found) {
          await navigateToPane(sessionName, originPane, terminalPaneCount + 1);
          return { content: [{ type: "text", text: `Could not navigate to ${targetPaneId}` }] };
        }
      }
      
      // Write the command
      await $`zellij -s ${sessionName} action write-chars ${command}`.quiet();
      await $`zellij -s ${sessionName} action write 10`.quiet(); // Enter
      
      // Return to origin
      if (originPane !== targetPaneId) {
        await navigateToPane(sessionName, originPane, terminalPaneCount + 1);
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
  console.error("Zellij Pane MCP server v0.3.0 running on stdio (with tab cycling)");
}

main().catch(console.error);
