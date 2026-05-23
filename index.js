import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listWorkspaces, listCollections, listItems, getItem, createItem, updateItem, listWorkspaceMembers, getCurrentUser, listMyItems } from './zenkit.js';

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
      case 'update_item':            result = await updateItem(args.listId, args.entryId, args.fields); break;
      case 'list_workspace_members': result = await listWorkspaceMembers(args.workspaceId); break;
      case 'list_my_items':          result = await listMyItems(args.listId); break;
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
