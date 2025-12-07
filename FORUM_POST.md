# Reddit r/zellij Post

**Title:** Plugin + MCP Server: Let AI assistants see and control your Zellij panes

---

I built a plugin that lets AI coding assistants (Claude, GPT, Cursor, OpenCode, etc.) actually see what's happening in your other terminal panes.

**The problem:** My AI assistant runs in one pane but has no idea what's in my build output, test results, or file manager. It can't "look over" at another pane.

**The solution:** Two components that work together:

1. **Zellij Plugin** - Exports pane metadata to `/tmp/zj-pane-names.json`
2. **MCP Server** - Gives AI assistants tools to read panes, run commands, create panes

Now my AI assistant can:
- List all panes and their names
- Read full scrollback from any pane ("what's the build error in pane 2?")
- Run commands in other panes
- Create new panes

**Example interaction:**
```
Me: "Check the build output in pane 2"
AI: [uses dump_pane tool] "I see a TypeScript error on line 42..."
```

**GitHub:** https://github.com/theslyprofessor/zellij-pane-tracker

Works with any MCP-compatible tool (OpenCode, Claude Desktop, etc.) or you can just use the plugin + shell scripts standalone.

First Zellij plugin - feedback welcome!

---

# Shorter Version (for Discord/quick posts)

**[Plugin] zellij-pane-tracker - AI assistant pane integration**

Made a plugin + MCP server that lets AI coding assistants see and interact with your Zellij panes.

Your AI can now:
- Know what panes exist (`get_panes`)
- Read pane content (`dump_pane`) 
- Run commands in other panes (`run_in_pane`)
- Create new panes (`new_pane`)

Use case: AI in pane 1 asks "what's the build error?" and reads pane 2's output directly.

Works with MCP-compatible tools (OpenCode, Claude Desktop) or standalone with shell scripts.

Repo: https://github.com/theslyprofessor/zellij-pane-tracker

---

# HN/Longer Form

**Show HN: Zellij plugin that lets AI assistants see your other terminal panes**

I've been using AI coding assistants in my terminal, but they're frustratingly blind to context. The AI runs in pane 1, my build is failing in pane 2, and I have to copy-paste errors back and forth.

So I built zellij-pane-tracker:

1. A Zellij plugin that exports pane metadata to JSON
2. An MCP server that exposes pane operations to AI tools
3. A shell script (zjdump) that captures pane content

Now when I ask "what's the build error?", my AI assistant can actually look at the build pane and tell me.

**How it works:**
- Plugin subscribes to Zellij's PaneUpdate events
- Writes pane names/IDs to /tmp/zj-pane-names.json
- MCP server reads this + uses zjdump to capture content
- AI tools call the MCP server via standard protocol

**MCP tools exposed:**
- `get_panes` - List all panes
- `dump_pane` - Read any pane's full scrollback
- `run_in_pane` - Execute commands in other panes
- `new_pane` - Create panes
- `rename_session` - Rename Zellij session

Works with OpenCode, Claude Desktop, or any MCP-compatible tool. Also works standalone without MCP if you just want the shell scripts.

GitHub: https://github.com/theslyprofessor/zellij-pane-tracker

This was my first Zellij plugin. The WASI sandbox made file I/O interesting (had to shell out to write JSON), but the plugin API is well-designed.

Feedback welcome!
