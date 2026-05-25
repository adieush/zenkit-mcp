# zenkit-mcp

Zenkit MCP server for Claude Code — read and manage tickets without leaving your terminal.

## Setup

### 1. Clone into `~/.claude/mcps`

```bash
git clone git@github.com:adieush/zenkit-mcp.git ~/.claude/mcps/zenkit-mcp
cd ~/.claude/mcps/zenkit-mcp
npm install
```

### 2. Initialize your profile

Copy the template and fill in your API key (get it from **Zenkit → Profile → Integrations → API key**):

```bash
cp ~/.claude/mcps/zenkit-mcp/zenkit.local.json.example ~/.claude/mcps/zenkit-mcp/zenkit.local.json
# open the file and paste your key into the "apiKey" field
```

Then in Claude Code, run `init_zenkit` with no arguments — it reads the key from the file and saves your user profile:

```
init_zenkit
```

`zenkit.local.json` is gitignored and stays local to this machine.

### 3. Register with Claude Code

```bash
claude mcp add --transport stdio zenkit -- node ~/.claude/mcps/zenkit-mcp/index.js
```

## Project setup

Link a project folder to a Zenkit collection by running this in Claude Code from your project directory:

```
init_project /absolute/path/to/project listId
```

This creates a `.zenkit` file in the project root (commit it to git):
```json
{
  "listId": "3870339",
  "listName": "My Project Sprint 1"
}
```

When you move to a new collection after a deploy:
```
set_project_collection /path/to/project newListId
```

## Tools

| Tool | Description |
|------|-------------|
| `init_zenkit` | Save API key and user profile to `zenkit.local.json` next to the server |
| `init_project` | Link a project directory to a Zenkit collection |
| `get_project_collection` | Get the collection linked to a project |
| `set_project_collection` | Update the collection (e.g. after deploying a batch) |
| `create_project_item` | Create a ticket in the project's collection, auto-assigned to you |
| `list_workspaces` | List all workspaces |
| `list_collections` | List collections in a workspace |
| `list_items` | List items in a collection (with optional filter) |
| `get_item` | Get full details of a single item |
| `create_item` | Create an item in any collection |
| `update_item` | Update fields or status of an item |
| `list_workspace_members` | List members of a workspace |
| `list_my_items` | List items assigned to the current user |

## Files

| File | Description |
|------|-------------|
| `~/.claude/mcps/zenkit-mcp/zenkit.local.json` | Personal: API key + user profile. Gitignored, never commit. |
| `~/.claude/mcps/zenkit-mcp/zenkit.local.json.example` | Template — shows the expected structure. |
| `.zenkit` | Per-project: current collection ID. Commit to git. |

## Usage examples

```
# See your tickets in the current project
show my tickets in this project

# Create a ticket
create a ticket "Fix login bug" in this project

# After deploying — move to new collection
set collection for this project to listId 3900000
```

## Requirements

- Node.js 18+
- Claude Code
- Zenkit API key
