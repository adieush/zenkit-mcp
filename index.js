import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import nodeFetch from 'node-fetch';
import { makeClient, listWorkspaces, listItems, getItem, createItem, updateItem, deleteItem, listWorkspaceMembers, listCollectionMembers, getCurrentUser, listMyItems, getListElements, readLocalConfig, writeLocalConfig, readProjectConfig, writeProjectConfig, LOCAL_CONFIG_PATH } from './zenkit.js';

async function resolveCollection(listIdOrShortId) {
  const workspaces = await listWorkspaces();
  for (const ws of workspaces) {
    const cols = await makeClient().listCollections(String(ws.id));
    const found = cols.find(c =>
      String(c.id) === String(listIdOrShortId) || c.shortId === listIdOrShortId
    );
    if (found) return found; // { id (numeric), name, shortId }
  }
  return null;
}

async function fetchCollectionMeta(listId) {
  const elements = await getListElements(listId);
  const stageEl = elements.find(e =>
    e.elementcategory === 6 &&
    (e.predefinedCategories || e.elementData?.predefinedCategories || [])
      .some(c => c.resourceRole === 'todo' || c.resourceRole === 'done')
  );
  const personsEl = elements.find(e => e.elementcategory === 14);
  return {
    stageElementUuid: stageEl?.uuid ?? null,
    personsElementUuid: personsEl?.uuid ?? null,
    stages: stageEl
      ? (stageEl.predefinedCategories || stageEl.elementData?.predefinedCategories || [])
          .map(c => ({ id: c.id, name: c.name }))
      : [],
  };
}

const server = new Server(
  { name: 'zenkit', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [{
    uri: 'zenkit://me',
    name: 'My Zenkit Profile',
    description: 'Current user identity — who is using this MCP server (based on ZENKIT_API_KEY)',
    mimeType: 'application/json',
  }],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri !== 'zenkit://me') throw new Error(`Unknown resource: ${request.params.uri}`);
  const user = await getCurrentUser();
  return {
    contents: [{
      uri: 'zenkit://me',
      mimeType: 'application/json',
      text: JSON.stringify(user, null, 2),
    }],
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_workspaces',
      description: 'List all Zenkit workspaces',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'list_collections',
      description: 'List collections (lists) inside a workspace',
      inputSchema: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: 'Workspace ID (numeric)' },
        },
        required: ['workspaceId'],
      },
    },
    {
      name: 'list_items',
      description: 'List items (entries) in a collection, optionally filtered',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Collection (list) ID' },
          filter: { type: 'object', description: 'Optional Zenkit filter object, e.g. { "searchValue": "bug" }' },
        },
        required: ['listId'],
      },
    },
    {
      name: 'get_item',
      description: 'Get full details of a single item',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Collection (list) ID' },
          entryId: { type: 'string', description: 'Entry ID' },
        },
        required: ['listId', 'entryId'],
      },
    },
    {
      name: 'create_item',
      description: 'Create a new item in a collection',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Collection (list) ID' },
          fields: { type: 'object', description: 'Field values, e.g. { "displayString": "Fix login bug" }' },
        },
        required: ['listId', 'fields'],
      },
    },
    {
      name: 'delete_item',
      description: 'Delete an item from a collection',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Collection (list) ID' },
          entryId: { type: 'string', description: 'Entry ID' },
        },
        required: ['listId', 'entryId'],
      },
    },
    {
      name: 'update_item',
      description: 'Update fields or status of an existing item',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Collection (list) ID' },
          entryId: { type: 'string', description: 'Entry ID' },
          fields: { type: 'object', description: 'Fields to update, e.g. { "displayString": "Updated title" }' },
        },
        required: ['listId', 'entryId', 'fields'],
      },
    },
    {
      name: 'list_workspace_members',
      description: 'List all members of a workspace',
      inputSchema: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: 'Workspace ID (numeric)' },
        },
        required: ['workspaceId'],
      },
    },
    {
      name: 'list_collection_members',
      description: 'List all members who have access to a collection (more complete than workspace members)',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Collection (list) ID' },
        },
        required: ['listId'],
      },
    },
    {
      name: 'get_list_elements',
      description: 'Get all field definitions (elements) for a collection — useful to inspect structure, find stage/assignee/label field UUIDs',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Collection (list) ID' },
        },
        required: ['listId'],
      },
    },
    {
      name: 'list_my_items',
      description: 'List items assigned to the current user (identified by ZENKIT_API_KEY)',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Collection (list) ID' },
        },
        required: ['listId'],
      },
    },
    {
      name: 'init_zenkit',
      description: 'Initialize ~/.claude/zenkit.local.json with API key and user profile. Run once to set up.',
      inputSchema: {
        type: 'object',
        properties: {
          apiKey: { type: 'string', description: 'Zenkit API key (optional if ZENKIT_API_KEY env var is set)' },
        },
      },
    },
    {
      name: 'init_project',
      description: 'Create .zenkit config in a project directory, linking it to a Zenkit collection',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Absolute path to the project root' },
          listId: { type: 'string', description: 'Zenkit collection (list) ID to associate with this project' },
        },
        required: ['projectPath', 'listId'],
      },
    },
    {
      name: 'get_project_collection',
      description: 'Get the Zenkit collection linked to a project (reads .zenkit from project root)',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Absolute path to the project root' },
        },
        required: ['projectPath'],
      },
    },
    {
      name: 'set_project_collection',
      description: 'Update the Zenkit collection for a project (use after deploying a batch and moving to a new collection)',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Absolute path to the project root' },
          listId: { type: 'string', description: 'New Zenkit collection (list) ID' },
        },
        required: ['projectPath', 'listId'],
      },
    },
    {
      name: 'create_project_item',
      description: 'Create a ticket in the project\'s linked Zenkit collection, auto-assigned to the current user',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Absolute path to the project root' },
          title: { type: 'string', description: 'Ticket title' },
          stage: { type: 'string', description: 'Stage name to place the ticket in, e.g. "In Progress". Must match a stage in .zenkit.' },
        },
        required: ['projectPath', 'title'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    let result;
    switch (name) {
      case 'list_workspaces':   result = await listWorkspaces(); break;
      case 'list_collections':  result = await listCollections(args.workspaceId); break;
      case 'list_items':        result = await listItems(args.listId, args.filter); break;
      case 'get_item':          result = await getItem(args.listId, args.entryId); break;
      case 'create_item':       result = await createItem(args.listId, args.fields); break;
      case 'update_item':  result = await updateItem(args.listId, args.entryId, args.fields); break;
      case 'delete_item':  result = await deleteItem(args.listId, args.entryId); break;
      case 'list_workspace_members':   result = await listWorkspaceMembers(args.workspaceId); break;
      case 'list_collection_members': result = await listCollectionMembers(args.listId); break;
      case 'get_list_elements':       result = await getListElements(args.listId); break;
      case 'list_my_items':          result = await listMyItems(args.listId); break;

      case 'init_zenkit': {
        const local = readLocalConfig();
        const apiKey = args.apiKey || local.apiKey || process.env.ZENKIT_API_KEY;
        if (!apiKey) throw new Error('Provide apiKey argument or set ZENKIT_API_KEY env var');
        const res = await nodeFetch('https://zenkit.com/api/v1/auth/currentuser', {
          headers: { 'Content-Type': 'application/json', 'Zenkit-API-Key': apiKey },
        });
        if (!res.ok) throw new Error(`Zenkit auth failed: ${res.status}`);
        const user = await res.json();
        writeLocalConfig({ ...local, apiKey, userId: user.id, displayname: user.displayname, username: user.username });
        result = { ok: true, message: `Initialized as ${user.displayname} (${user.username})`, userId: user.id };
        break;
      }

      case 'init_project': {
        const existing = readProjectConfig(args.projectPath);
        if (existing) {
          result = { ok: false, message: `.zenkit already exists in ${args.projectPath}`, current: existing };
          break;
        }
        const col = await resolveCollection(args.listId);
        if (!col) throw new Error(`Collection "${args.listId}" not found in any workspace`);
        const meta = await fetchCollectionMeta(String(col.id));
        writeProjectConfig(args.projectPath, { listId: String(col.id), listName: col.name, ...meta });
        result = { ok: true, message: `Created .zenkit in ${args.projectPath}`, listId: String(col.id), listName: col.name, stages: meta.stages };
        break;
      }

      case 'get_project_collection': {
        const cfg = readProjectConfig(args.projectPath);
        if (!cfg) throw new Error(`No .zenkit found in ${args.projectPath}. Run init_project first.`);
        result = cfg;
        break;
      }

      case 'set_project_collection': {
        const cfg = readProjectConfig(args.projectPath) ?? {};
        const col = await resolveCollection(args.listId);
        if (!col) throw new Error(`Collection "${args.listId}" not found in any workspace`);
        const meta = await fetchCollectionMeta(String(col.id));
        writeProjectConfig(args.projectPath, { ...cfg, listId: String(col.id), listName: col.name, ...meta });
        result = { ok: true, message: `Updated .zenkit in ${args.projectPath}`, listId: String(col.id), listName: col.name, stages: meta.stages };
        break;
      }

      case 'create_project_item': {
        const cfg = readProjectConfig(args.projectPath);
        if (!cfg) throw new Error(`No .zenkit found in ${args.projectPath}. Run init_project first.`);
        const local = readLocalConfig();
        const userId = local.userId;
        if (!userId) throw new Error('User not initialized. Run init_zenkit first.');
        const fields = { displayString: args.title };
        if (cfg.personsElementUuid) {
          fields[`${cfg.personsElementUuid}_persons`] = [userId];
        } else {
          const elements = await getListElements(cfg.listId);
          const personsEl = elements.find(e => e.elementcategory === 14);
          if (personsEl) fields[`${personsEl.uuid}_persons`] = [userId];
        }
        if (args.stage) {
          if (!cfg.stageElementUuid || !cfg.stages?.length) {
            throw new Error('Stage info missing from .zenkit. Re-run init_project or set_project_collection to refresh.');
          }
          const stage = cfg.stages.find(s => s.name.toLowerCase() === args.stage.toLowerCase());
          if (!stage) throw new Error(`Stage "${args.stage}" not found. Available: ${cfg.stages.map(s => s.name).join(', ')}`);
          fields[`${cfg.stageElementUuid}_categories`] = [stage.id];
        }
        result = await createItem(cfg.listId, fields);
        break;
      }

      default: throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
