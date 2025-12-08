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

// Parse pane identifier for optional tab prefix
// Returns { tabName: string | null, paneQuery: string, tabIndex: number | null }
// Examples:
//   "Pane 1" -> { tabName: null, paneQuery: "Pane 1", tabIndex: null }
//   "Tab 2 Pane 1" -> { tabName: null, paneQuery: "Pane 1", tabIndex: 1 } (0-based)
//   "shell Pane 1" -> { tabName: "shell", paneQuery: "Pane 1", tabIndex: null }
//   "workspace pane 2" -> { tabName: "workspace", paneQuery: "pane 2", tabIndex: null }
function parseTabPaneQuery(input: string): { tabName: string | null; paneQuery: string; tabIndex: number | null } {
  // Match patterns like "Tab 2 Pane 1", "tab #2 pane #1" (numeric tab reference)
  const numericTabMatch = input.match(/^tab\s*#?\s*(\d+)\s+(.+)$/i);
  if (numericTabMatch) {
    const tabNum = parseInt(numericTabMatch[1], 10);
    const paneQuery = numericTabMatch[2].trim();
    // Convert to 0-based index (user says "Tab 2" meaning second tab)
    return { tabName: null, paneQuery, tabIndex: tabNum - 1 };
  }
  
  // Match patterns like "workspace Pane 1", "shell pane 2" (named tab reference)
  // Look for known tab name patterns followed by pane reference
  const namedTabMatch = input.match(/^(\S+)\s+(pane\s*#?\s*\d+|terminal_\d+|\d+)$/i);
  if (namedTabMatch) {
    const potentialTabName = namedTabMatch[1];
    const paneQuery = namedTabMatch[2].trim();
    // Don't treat "Pane" as a tab name
    if (potentialTabName.toLowerCase() !== 'pane') {
      return { tabName: potentialTabName, paneQuery, tabIndex: null };
    }
  }
  
  // No tab prefix, just the pane query
  return { tabName: null, paneQuery: input, tabIndex: null };
}

// Resolve pane identifier to terminal ID number
// Accepts: "4", "Pane #4", "terminal_2", "opencode", "Tab 2 Pane 1", etc.
// PRIORITY: Display name ("Pane #N") always takes precedence over terminal ID
// NEW: If no tab specified, searches current tab first (for speed)
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
  version: "0.6.1",
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

// Search for a pane by display name within CURRENT TAB ONLY
// This is faster when user says "Pane 1" without specifying a tab
// Returns terminal ID if found, null otherwise
async function findPaneInCurrentTab(
  sessionName: string,
  paneDisplayName: string,
  metadata: PaneInfo | null,
  maxPanesPerTab: number = 10
): Promise<{ terminalId: string; paneId: string } | null> {
  if (!metadata) return null;
  
  const normalizedQuery = paneDisplayName.toLowerCase().trim();
  // Handle "1" -> "pane #1", "Pane 1" -> "pane #1", "Pane #1" -> "pane #1"
  const paneNameToFind = /^\d+$/.test(normalizedQuery) 
    ? `pane #${normalizedQuery}` 
    : normalizedQuery.replace(/^pane\s+#?/i, 'pane #');
  
  let firstPaneInTab: string | null = null;
  
  for (let i = 0; i < maxPanesPerTab; i++) {
    const currentPaneId = await getCurrentPaneId(sessionName);
    if (!currentPaneId) break;
    
    // Detect wrap-around
    if (firstPaneInTab === null) {
      firstPaneInTab = currentPaneId;
    } else if (currentPaneId === firstPaneInTab && i > 0) {
      break; // Cycled through all panes in this tab
    }
    
    // Check if this pane matches
    const paneName = metadata.panes[currentPaneId];
    if (paneName) {
      const normalizedPaneName = paneName.toLowerCase().trim();
      if (normalizedPaneName === paneNameToFind || 
          normalizedPaneName.includes(paneNameToFind) ||
          paneNameToFind.includes(normalizedPaneName)) {
        const terminalNum = currentPaneId.replace('terminal_', '');
        return { terminalId: terminalNum, paneId: currentPaneId };
      }
    }
    
    await $`zellij -s ${sessionName} action focus-next-pane`.quiet();
  }
  
  // Return to first pane to leave tab in consistent state
  if (firstPaneInTab) {
    let currentPane = await getCurrentPaneId(sessionName);
    let attempts = 0;
    while (currentPane !== firstPaneInTab && attempts < maxPanesPerTab) {
      await $`zellij -s ${sessionName} action focus-next-pane`.quiet();
      currentPane = await getCurrentPaneId(sessionName);
      attempts++;
    }
  }
  
  return null;
}

// Navigate to a specific tab by name
async function goToTab(sessionName: string, tabName: string): Promise<boolean> {
  try {
    await $`zellij -s ${sessionName} action go-to-tab-name ${tabName} 2>/dev/null`.quiet();
    return true;
  } catch {
    return false;
  }
}

// Navigate to a specific tab by index (0-based)
async function goToTabByIndex(sessionName: string, tabIndex: number): Promise<string | null> {
  try {
    const tabs = await getTabNames(sessionName);
    if (tabIndex < 0 || tabIndex >= tabs.length) {
      return null;
    }
    const tabName = tabs[tabIndex];
    await $`zellij -s ${sessionName} action go-to-tab-name ${tabName} 2>/dev/null`.quiet();
    return tabName;
  } catch {
    return null;
  }
}

// Get current tab name by checking which tab we're on
async function getCurrentTabName(sessionName: string): Promise<string | null> {
  try {
    // Query tab names and use list-clients to figure out current position
    // Unfortunately Zellij doesn't have a direct "current tab" query
    // We'll use a workaround: dump the tab bar or infer from pane metadata
    const tabs = await getTabNames(sessionName);
    if (tabs.length === 1) return tabs[0];
    
    // For now, we can't directly get current tab - but we can remember it
    // before navigating away. Return null to signal we need the caller to track it.
    return null;
  } catch {
    return null;
  }
}

// Resolve pane with optional tab context
// If tabName or tabIndex is specified, go to that tab first then search
// If neither specified, search current tab first, then fall back to all tabs
async function resolveAndNavigateToPane(
  sessionName: string,
  paneQuery: string,
  tabName: string | null,
  metadata: PaneInfo | null,
  tabIndex: number | null = null
): Promise<{ found: boolean; terminalNum: string | null; tabName: string | null }> {
  
  // If specific tab requested by index (e.g., "Tab 2 Pane 1")
  if (tabIndex !== null) {
    const resolvedTabName = await goToTabByIndex(sessionName, tabIndex);
    if (!resolvedTabName) {
      return { found: false, terminalNum: null, tabName: null };
    }
    
    // Search within this specific tab
    const result = await findPaneInCurrentTab(sessionName, paneQuery, metadata);
    if (result) {
      return { found: true, terminalNum: result.terminalId, tabName: resolvedTabName };
    }
    return { found: false, terminalNum: null, tabName: null };
  }
  
  // If specific tab requested by name (e.g., "shell Pane 1")
  if (tabName) {
    const tabExists = await goToTab(sessionName, tabName);
    if (!tabExists) {
      return { found: false, terminalNum: null, tabName: null };
    }
    
    // Search within this specific tab
    const result = await findPaneInCurrentTab(sessionName, paneQuery, metadata);
    if (result) {
      return { found: true, terminalNum: result.terminalId, tabName };
    }
    return { found: false, terminalNum: null, tabName: null };
  }
  
  // No tab specified - search current tab first (fast path)
  const currentTabResult = await findPaneInCurrentTab(sessionName, paneQuery, metadata);
  if (currentTabResult) {
    // Found in current tab! Get tab name for return optimization
    const originSearch = await navigateToTargetPaneWithTabTracking(sessionName, currentTabResult.paneId, 1);
    return { found: true, terminalNum: currentTabResult.terminalId, tabName: originSearch.tabName };
  }
  
  // Not in current tab - fall back to resolvePaneId + full navigation
  const terminalNum = resolvePaneId(paneQuery, metadata);
  if (!terminalNum) {
    return { found: false, terminalNum: null, tabName: null };
  }
  
  const targetPaneId = `terminal_${terminalNum}`;
  const navResult = await navigateToTargetPaneWithTabTracking(sessionName, targetPaneId);
  
  return { 
    found: navResult.found, 
    terminalNum: navResult.found ? terminalNum : null, 
    tabName: navResult.tabName 
  };
}

// Return to origin pane efficiently - go directly to origin tab first
async function returnToOrigin(
  sessionName: string,
  originPaneId: string,
  originTabName: string | null
): Promise<void> {
  // If we know the origin tab, jump directly to it first
  if (originTabName) {
    await $`zellij -s ${sessionName} action go-to-tab-name ${originTabName} 2>/dev/null`.quiet();
  }
  
  // Now cycle within this tab to find the origin pane
  // This is much faster than cycling through ALL tabs
  const maxPanesPerTab = 10;
  let firstPaneInTab: string | null = null;
  
  for (let i = 0; i < maxPanesPerTab; i++) {
    const currentPane = await getCurrentPaneId(sessionName);
    
    if (currentPane === originPaneId) {
      return; // Found it!
    }
    
    // Detect wrap-around
    if (firstPaneInTab === null) {
      firstPaneInTab = currentPane;
    } else if (currentPane === firstPaneInTab && i > 0) {
      break; // We've cycled through all panes in this tab
    }
    
    await $`zellij -s ${sessionName} action focus-next-pane`.quiet();
  }
  
  // If we still haven't found it (shouldn't happen if originTabName was correct),
  // fall back to full navigation
  const currentPane = await getCurrentPaneId(sessionName);
  if (currentPane !== originPaneId) {
    await navigateToTargetPane(sessionName, originPaneId);
  }
}

// Navigate to target and remember which tab we found it on
async function navigateToTargetPaneWithTabTracking(
  sessionName: string,
  targetPaneId: string,
  maxPanesPerTab: number = 10
): Promise<{ found: boolean; tabName: string | null }> {
  const tabs = await getTabNames(sessionName);
  if (tabs.length === 0) tabs.push("Tab #1");
  
  for (const tab of tabs) {
    await $`zellij -s ${sessionName} action go-to-tab-name ${tab} 2>/dev/null`.quiet();
    
    let firstPaneInTab: string | null = null;
    
    for (let i = 0; i < maxPanesPerTab; i++) {
      const currentPane = await getCurrentPaneId(sessionName);
      
      if (firstPaneInTab === null) {
        firstPaneInTab = currentPane;
      } else if (currentPane === firstPaneInTab && i > 0) {
        break;
      }
      
      if (currentPane === targetPaneId) {
        return { found: true, tabName: tab };
      }
      
      await $`zellij -s ${sessionName} action focus-next-pane`.quiet();
    }
  }
  
  return { found: false, tabName: null };
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
  
  // Remember where we started - both pane AND tab
  const originPaneId = await getCurrentPaneId(sessionName);
  const tabs = await getTabNames(sessionName);
  
  // Find which tab the origin pane is on by checking current position
  // We do this BEFORE navigating away
  let originTabName: string | null = null;
  if (tabs.length > 0) {
    // We're currently on the origin pane, so current tab contains it
    // Use navigateToTargetPaneWithTabTracking to find it (it will find immediately since we're there)
    const originSearch = await navigateToTargetPaneWithTabTracking(sessionName, originPaneId || '', 1);
    originTabName = originSearch.tabName;
  }
  
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
  
  // Navigate to target pane (full search through all tabs)
  const { found } = await navigateToTargetPaneWithTabTracking(sessionName, targetPaneId);
  
  if (!found) {
    // Return to origin before failing (optimized return)
    if (originPaneId) {
      await returnToOrigin(sessionName, originPaneId, originTabName);
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
  
  // Return to origin pane (OPTIMIZED - direct tab jump + local pane cycle)
  if (originPaneId && originPaneId !== targetPaneId) {
    await returnToOrigin(sessionName, originPaneId, originTabName);
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

Supports tab-scoped queries:
- "Pane 1" or "1" → searches current tab first (fast), then other tabs
- "Tab 2 Pane 1" → goes directly to Tab #2, searches only there

By default, returns last ${DEFAULT_DUMP_LINES} lines for faster responses. Use 'full: true' for complete scrollback, or 'lines: N' to customize.`,
  {
    pane_id: z
      .string()
      .describe("Pane identifier - e.g., '1', 'Pane #1', 'Tab 2 Pane 1', 'opencode', 'terminal_2'"),
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
      
      // Parse for optional tab prefix: "Tab 2 Pane 1" or "shell Pane 1"
      const { tabName: requestedTab, paneQuery, tabIndex } = parseTabPaneQuery(pane_id);
      
      // Remember origin for return
      const originPaneId = await getCurrentPaneId(sessionName);
      let originTabName: string | null = null;
      if (originPaneId) {
        const originSearch = await navigateToTargetPaneWithTabTracking(sessionName, originPaneId, 1);
        originTabName = originSearch.tabName;
      }
      
      // Resolve and navigate to target pane
      const resolution = await resolveAndNavigateToPane(sessionName, paneQuery, requestedTab, metadata, tabIndex);
      
      if (!resolution.found || !resolution.terminalNum) {
        // Return to origin before failing
        if (originPaneId) {
          await returnToOrigin(sessionName, originPaneId, originTabName);
        }
        
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

      const terminalNum = resolution.terminalNum;
      const dumpFile = `/tmp/zjmcp-dump-${terminalNum}.txt`;
      
      // Dump the pane (we're already focused on it)
      await (full 
        ? $`zellij -s ${sessionName} action dump-screen --full ${dumpFile}`
        : $`zellij -s ${sessionName} action dump-screen ${dumpFile}`
      ).quiet();
      
      // Read the dump
      let content: string | null = null;
      try {
        const rawContent = await Bun.file(dumpFile).text();
        const lineLimit = lines !== undefined ? lines : DEFAULT_DUMP_LINES;
        content = full ? rawContent : limitToLastNLines(rawContent, lineLimit);
      } catch {
        content = null;
      }
      
      // Return to origin
      if (originPaneId) {
        await returnToOrigin(sessionName, originPaneId, originTabName);
      }
      
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
  `Run a shell command in a specific pane (by cycling to it, running command, returning).

Supports tab-scoped queries:
- "Pane 1" or "1" → searches current tab first (fast), then other tabs
- "Tab 2 Pane 1" → goes directly to Tab #2, searches only there`,
  {
    pane_id: z
      .string()
      .describe("Pane identifier - e.g., '1', 'Pane #1', 'Tab 2 Pane 1', 'opencode', 'terminal_2'"),
    command: z.string().describe("Command to run"),
  },
  async ({ pane_id, command }) => {
    try {
      const sessionName = await getActiveSessionName();
      if (!sessionName) {
        return { content: [{ type: "text", text: "Could not determine active Zellij session." }] };
      }

      const metadata = await getPaneMetadata();
      
      // Parse for optional tab prefix
      const { tabName: requestedTab, paneQuery, tabIndex } = parseTabPaneQuery(pane_id);
      
      // Remember where we started
      const originPaneId = await getCurrentPaneId(sessionName);
      let originTabName: string | null = null;
      if (originPaneId) {
        const originSearch = await navigateToTargetPaneWithTabTracking(sessionName, originPaneId, 1);
        originTabName = originSearch.tabName;
      }
      
      // Resolve and navigate to target pane
      const resolution = await resolveAndNavigateToPane(sessionName, paneQuery, requestedTab, metadata, tabIndex);
      
      if (!resolution.found || !resolution.terminalNum) {
        // Return to origin before failing
        if (originPaneId) {
          await returnToOrigin(sessionName, originPaneId, originTabName);
        }
        return { content: [{ type: "text", text: `Could not resolve pane '${pane_id}'` }] };
      }
      
      const targetPaneId = `terminal_${resolution.terminalNum}`;
      
      // Write the command (we're already focused on target)
      await $`zellij -s ${sessionName} action write-chars ${command}`.quiet();
      await $`zellij -s ${sessionName} action write 10`.quiet(); // Enter
      
      // Return to origin (OPTIMIZED - direct tab jump + local pane cycle)
      if (originPaneId && originPaneId !== targetPaneId) {
        await returnToOrigin(sessionName, originPaneId, originTabName);
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
  console.error("Zellij Pane MCP server v0.6.1 running on stdio (named tab support)");
}

main().catch(console.error);

// v0.6.1 - Support named tabs ("shell Pane 1") in addition to numeric ("Tab 2 Pane 1")
// v0.6.0 - Tab-scoped pane queries ("Pane 1" searches current tab first, "Tab 2 Pane 1" goes to specific tab)
// v0.5.0 - Optimized return navigation (direct tab jump instead of full scan)
// v0.4.0 - Smart dump limiting (default 100 lines, optional full dump)
