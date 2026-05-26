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
   claude mcp add --scope user --transport stdio zenkit -- node ~/.claude/mcps/zenkit-mcp/index.js
   ```

   > `--scope user` сохраняет сервер глобально (`~/.claude.json`), а не в текущем проекте. Без этого флага MCP пропадает при смене проекта.

3. **Create the local config**

   Check if `zenkit.local.json` exists in `~/.claude/mcps/zenkit-mcp/`.
   If not:
   1. Tell the user to copy the template and fill in their API key:
      ```bash
      cp ~/.claude/mcps/zenkit-mcp/zenkit.local.json.example ~/.claude/mcps/zenkit-mcp/zenkit.local.json
      # then open the file and paste the key into the "apiKey" field
      # API key is at: Zenkit → Profile → Integrations → API key
      ```
   2. Once the user confirms the file is saved, call `init_zenkit` with no arguments — it reads the key from the file and fills in userId, displayname, and username automatically.

   Never ask the user to paste their API key into chat. Always use the file.

## Per-Project Setup

For each project directory, call `init_project` with:
- `projectPath` — absolute path to the project root
- `listId` — the Zenkit collection (list) ID for this project

This creates a `.zenkit` file in the project root. Commit it to git so teammates share the same collection.

When moving to a new collection after a sprint deploy, use `set_project_collection`.
