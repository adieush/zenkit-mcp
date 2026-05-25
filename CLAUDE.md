# Zenkit MCP — Claude Setup Guide

This is the zenkit-mcp server. It adds Zenkit tools to Claude Code so you can read and manage tickets without leaving the terminal.

## First-Time Setup

When a user installs this server, complete these steps in order:

1. **Install dependencies**
   ```bash
   cd ~/.claude/mcps/zenkit-mcp && npm install
   ```

2. **Register with Claude Code**
   ```bash
   claude mcp add --transport stdio zenkit -- node ~/.claude/mcps/zenkit-mcp/index.js
   ```

3. **Create the local config**

   Check if `zenkit.local.json` exists in `~/.claude/mcps/zenkit-mcp/`.
   If not, tell the user:
   > "To connect Zenkit, I need your API key. Get it from **Zenkit → Profile → Integrations → API key**."

   Once they provide it, call `init_zenkit` with their key — it creates `zenkit.local.json` automatically.
   This file is gitignored and stays local to this machine.

## Per-Project Setup

For each project directory, call `init_project` with:
- `projectPath` — absolute path to the project root
- `listId` — the Zenkit collection (list) ID for this project

This creates a `.zenkit` file in the project root. Commit it to git so teammates share the same collection.

When moving to a new collection after a sprint deploy, use `set_project_collection`.
