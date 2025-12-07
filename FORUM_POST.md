# Reddit r/zellij Post

**Title:** Plugin: zellij-pane-tracker - Export pane metadata to JSON for AI assistants and scripts

---

I built a simple plugin that exports pane metadata to a JSON file, so external tools (like AI coding assistants) can see what's happening in your Zellij session.

**The problem:** I use an AI coding assistant (Claude via OpenCode) in one terminal pane, but it has no idea what's running in my other panes - build output, test results, file manager, etc. It can't "look over" at another pane.

**The solution:** This plugin continuously exports pane info to `/tmp/zj-pane-names.json`:

```json
{
  "panes": {
    "terminal_0": "Yazi: ~/projects",
    "terminal_1": "opencode", 
    "terminal_2": "npm run build",
    "plugin_0": "zellij:tab-bar"
  },
  "timestamp": 1733600000
}
```

Now my AI assistant can read this file and know which panes exist and what they're named. Combined with `zellij action dump-screen`, it can actually see the content of other panes when needed.

**GitHub:** https://github.com/theslyprofessor/zellij-pane-tracker

It's my first Zellij plugin - learned a lot about the WASI sandbox and plugin APIs. Happy to hear feedback or suggestions!

---

# Alternative: Shorter Version

**Title:** Made a plugin to help AI assistants "see" other panes

Built `zellij-pane-tracker` - it exports pane metadata to JSON so external tools can know what's running in your session.

Use case: AI coding assistant in pane 1 can now know pane 2 is running `npm run build` and pane 3 has `nvim main.rs` open.

GitHub: https://github.com/theslyprofessor/zellij-pane-tracker

First plugin, feedback welcome!

---

# Discord/Forum Alternative

**[Plugin] zellij-pane-tracker - Pane metadata export for external tools**

Hey all! Just finished my first Zellij plugin and wanted to share.

**What it does:** Exports pane names/IDs to `/tmp/zj-pane-names.json` on every pane update.

**Why:** I wanted my AI coding assistant (running in one pane) to be able to "see" what's happening in other panes - build output, file managers, editors, etc.

**How it works:**
1. Subscribes to `PaneUpdate` events
2. Extracts pane metadata from `PaneManifest`
3. Writes JSON via shell command (WASI sandbox workaround)

Combined with `zellij action dump-screen`, external tools can now both *know about* and *read* other panes.

Repo: https://github.com/theslyprofessor/zellij-pane-tracker

Would love feedback! This was a fun learning experience with the plugin APIs.
