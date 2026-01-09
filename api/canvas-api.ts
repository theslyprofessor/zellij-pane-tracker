// Canvas API - High-level abstraction for Zellij pane operations
// Provides a clean interface for interacting with Zellij panes
// Similar to claude-canvas/src/api/canvas-api.ts

import { $ } from "bun";

const PANE_JSON_PATH = "/tmp/zj-pane-names.json";
const DEFAULT_DUMP_LINES = 100;

export interface PaneInfo {
  panes: Record<string, string>;
  timestamp: number;
}

export interface DumpPaneOptions {
  full?: boolean;
  lines?: number;
}

export interface NewPaneOptions {
  direction?: "down" | "right";
  command?: string;
}

/**
 * Canvas API for Zellij pane operations
 */
export class ZellijCanvas {
  private sessionName: string | null = null;

  constructor(sessionName?: string) {
    this.sessionName = sessionName || process.env.ZELLIJ_SESSION_NAME || null;
  }

  /**
   * Get the active Zellij session name
   */
  async getSessionName(): Promise<string | null> {
    if (this.sessionName) {
      return this.sessionName;
    }

    try {
      const result = await $`zellij list-sessions 2>/dev/null`.text();
      const lines = result.split('\n');
      for (const line of lines) {
        if (line && !line.includes('EXITED')) {
          const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
          const sessionName = cleanLine.split(/\s+/)[0];
          if (sessionName) {
            this.sessionName = sessionName;
            return sessionName;
          }
        }
      }
    } catch (e) {
      console.error("Failed to get active session:", e);
    }
    return null;
  }

  /**
   * Get pane metadata from the pane tracker plugin
   */
  async getPaneMetadata(): Promise<PaneInfo | null> {
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

  /**
   * Get list of all terminal panes with their names
   */
  async listPanes(): Promise<Array<{ id: string; name: string }>> {
    const metadata = await this.getPaneMetadata();
    if (!metadata) {
      return [];
    }

    return Object.entries(metadata.panes)
      .filter(([id]) => id.startsWith("terminal_"))
      .sort((a, b) => {
        const numA = parseInt(a[0].replace('terminal_', ''));
        const numB = parseInt(b[0].replace('terminal_', ''));
        return numA - numB;
      })
      .map(([id, name]) => ({ id, name }));
  }

  /**
   * Get currently focused pane ID
   */
  async getCurrentPaneId(): Promise<string | null> {
    const sessionName = await this.getSessionName();
    if (!sessionName) return null;

    try {
      const result = await $`zellij -s ${sessionName} action list-clients 2>/dev/null`.text();
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

  /**
   * Dump content from a specific pane
   */
  async dumpPane(paneId: string, options: DumpPaneOptions = {}): Promise<string | null> {
    const sessionName = await this.getSessionName();
    if (!sessionName) return null;

    const { full = false, lines = DEFAULT_DUMP_LINES } = options;
    
    // Extract terminal number from pane ID
    const terminalNum = paneId.replace('terminal_', '');
    const dumpFile = `/tmp/zjcanvas-dump-${terminalNum}.txt`;

    try {
      // Use dump-screen command
      if (full) {
        await $`zellij -s ${sessionName} action dump-screen --full ${dumpFile}`.quiet();
      } else {
        await $`zellij -s ${sessionName} action dump-screen ${dumpFile}`.quiet();
      }

      const content = await Bun.file(dumpFile).text();
      
      // Limit lines if not full dump
      if (!full && lines > 0) {
        return this.limitToLastNLines(content, lines);
      }
      
      return content;
    } catch (e) {
      console.error(`Failed to dump pane ${paneId}:`, e);
      return null;
    }
  }

  /**
   * Run a command in a specific pane
   */
  async runInPane(paneId: string, command: string): Promise<boolean> {
    const sessionName = await this.getSessionName();
    if (!sessionName) return false;

    try {
      // Convert command to byte codes to avoid duplication bug
      const bytes = [...command].map(c => c.charCodeAt(0));
      await $`zellij -s ${sessionName} action write ${bytes.join(' ')}`.quiet();
      await $`zellij -s ${sessionName} action write 10`.quiet(); // Enter
      return true;
    } catch (e) {
      console.error(`Failed to run command in pane ${paneId}:`, e);
      return false;
    }
  }

  /**
   * Create a new pane
   */
  async createPane(options: NewPaneOptions = {}): Promise<boolean> {
    const sessionName = await this.getSessionName();
    if (!sessionName) return false;

    const { direction = "down", command } = options;

    try {
      if (command) {
        await $`zellij -s ${sessionName} action new-pane -d ${direction} -- ${command}`.quiet();
      } else {
        await $`zellij -s ${sessionName} action new-pane -d ${direction}`.quiet();
      }
      return true;
    } catch (e) {
      console.error("Failed to create pane:", e);
      return false;
    }
  }

  /**
   * Rename the current Zellij session
   */
  async renameSession(name: string): Promise<boolean> {
    const sessionName = await this.getSessionName();
    if (!sessionName) return false;

    try {
      await $`zellij -s ${sessionName} action rename-session ${name}`.quiet();
      this.sessionName = name; // Update cached name
      return true;
    } catch (e) {
      console.error("Failed to rename session:", e);
      return false;
    }
  }

  /**
   * Helper to limit content to last N lines
   */
  private limitToLastNLines(content: string, n: number): string {
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
}
