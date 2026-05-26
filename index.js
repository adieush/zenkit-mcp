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
  const titleEl = elements.find(e => e.elementcategory === 1 && e.isPrimary);
  return {
    titleElementUuid: titleEl?.uuid ?? null,
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
      description: 'List all Zenkit workspaces the current user has access to. Use this to discover workspaceIds needed for list_collections.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'list_collections',
      description: 'List all collections (sprints/boards) inside a workspace. Returns id, name, shortId. Use to find the listId for a project. Accepts numeric workspaceId from list_workspaces.',
      inputSchema: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: 'Workspace ID (numeric) from list_workspaces' },
        },
        required: ['workspaceId'],
      },
    },
    {
      name: 'list_items',
      description: 'List all tickets (entries) in a collection. Returns raw field data including UUID-keyed fields. For the current user\'s tickets use list_my_items instead. For the current project\'s listId use get_project_collection.',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Collection (list) ID' },
          filter: { type: 'object', description: 'Optional Zenkit filter, e.g. { "searchValue": "bug" }' },
        },
        required: ['listId'],
      },
    },
    {
      name: 'get_item',
      description: 'Get full details of a single ticket including all field values. Use when you need description, comments, or specific field data for one item.',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Collection (list) ID' },
          entryId: { type: 'string', description: 'Entry (ticket) ID' },
        },
        required: ['listId', 'entryId'],
      },
    },
    {
      name: 'create_item',
      description: 'Low-level: create a ticket with raw field values. Requires knowing field UUIDs. For project tickets prefer create_project_item which handles title, assignee and stage automatically. WARNING: "displayString" is a computed read-only field — writing to it has no effect. Use the primary field UUID (isPrimary: true from get_list_elements) for the ticket title.',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Collection (list) ID' },
          fields: { type: 'object', description: 'Field values. Title: { "{titleUuid}": "..." } where titleUuid has isPrimary:true in get_list_elements. Assignee: { "{personsUuid}_persons": [userId] }. Stage: { "{stageUuid}_categories": [stageId] }' },
        },
        required: ['listId', 'fields'],
      },
    },
    {
      name: 'delete_item',
      description: 'Permanently delete a ticket. Requires listId and entryId. Always confirm with the user before deleting.',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Collection (list) ID' },
          entryId: { type: 'string', description: 'Entry (ticket) ID' },
        },
        required: ['listId', 'entryId'],
      },
    },
    {
      name: 'update_item',
      description: 'Update any fields of an existing ticket. Field names follow the pattern "{elementUuid}_persons" for assignees or "{elementUuid}_categories" for stages. Use get_project_collection to get cached elementUuids from .zenkit instead of calling get_list_elements every time.',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Collection (list) ID' },
          entryId: { type: 'string', description: 'Entry (ticket) ID' },
          fields: { type: 'object', description: 'Fields to update. Title: { "{titleUuid}": "..." } — use titleElementUuid from .zenkit or isPrimary field from get_list_elements. Assignee: { "{personsUuid}_persons": [userId] }. Stage: { "{stageUuid}_categories": [stageId] }. WARNING: "displayString" is read-only.' },
        },
        required: ['listId', 'entryId', 'fields'],
      },
    },
    {
      name: 'list_workspace_members',
      description: 'List members of a workspace. May return fewer members than list_collection_members. Use list_collection_members for a more complete list. IMPORTANT: never call this to find the current user — current user\'s id, displayname and username are stored in zenkit.local.json (set by init_zenkit).',
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
      description: 'List all members who have access to a collection. More complete than list_workspace_members. Use when you need to find a teammate\'s userId to assign a ticket. IMPORTANT: never call this to find the current user — current user\'s id is in zenkit.local.json.',
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
      description: 'Get all field definitions for a collection: names, UUIDs, types (elementcategory), and allowed values. Use to discover field UUIDs when .zenkit cache is missing or incomplete. elementcategory 14 = assignee (persons), 6 = stage/labels/tags.',
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
      description: 'List tickets assigned to the current user in a collection. Current user is identified automatically from zenkit.local.json — do NOT call list_workspace_members or list_collection_members to find userId. For the current project\'s listId read .zenkit with get_project_collection instead of calling list_workspaces + list_collections.',
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
      description: 'One-time setup: reads apiKey from zenkit.local.json in the server directory, calls Zenkit API to fetch user profile, and saves userId, displayname, username back to zenkit.local.json. Must be run once before using any other tools. Do NOT pass apiKey as argument — user should put it in zenkit.local.json manually first.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'init_project',
      description: 'Link a project directory to a Zenkit collection by creating a .zenkit file. Accepts numeric listId or shortId. Saves listName, stageElementUuid, personsElementUuid, and stages list to .zenkit so they are available without extra API calls. Run once per project. Commit the resulting .zenkit to git.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Absolute path to the project root' },
          listId: { type: 'string', description: 'Zenkit collection ID (numeric) or shortId' },
        },
        required: ['projectPath', 'listId'],
      },
    },
    {
      name: 'get_project_collection',
      description: 'Read the .zenkit file for a project. Returns listId, listName, stageElementUuid, personsElementUuid, and stages. Use this before create_item or update_item to get cached field UUIDs instead of calling get_list_elements.',
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
      description: 'Switch the project to a new Zenkit collection — run after deploying a sprint and moving to the next one. Accepts numeric listId or shortId. Updates listName, stages, and field UUIDs in .zenkit automatically.',
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
      description: 'High-level tool to create a ticket in the current project. This is a SINGLE-CALL operation — do NOT call list_workspaces, list_collections, or get_project_collection first. Everything is read automatically: listId and stages from .zenkit, userId from zenkit.local.json. Just call this tool with projectPath, title, and optionally stage.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Absolute path to the project root' },
          title: { type: 'string', description: 'Ticket title' },
          stage: { type: 'string', description: 'Stage name, e.g. "In Progress", "To-Do". Must match a name in .zenkit stages list. If omitted, ticket is created without a stage.' },
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
        const fields = cfg.titleElementUuid
          ? { [cfg.titleElementUuid]: args.title }
          : { displayString: args.title };
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
