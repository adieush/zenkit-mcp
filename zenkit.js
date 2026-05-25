import nodeFetch from 'node-fetch';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://zenkit.com/api/v1';
export const LOCAL_CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'zenkit.local.json');

export function readLocalConfig(configPath = LOCAL_CONFIG_PATH) {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

export function writeLocalConfig(data, configPath = LOCAL_CONFIG_PATH) {
  writeFileSync(configPath, JSON.stringify(data, null, 2));
}

export function readProjectConfig(projectPath) {
  try {
    return JSON.parse(readFileSync(join(projectPath, '.zenkit'), 'utf8'));
  } catch {
    return null;
  }
}

export function writeProjectConfig(projectPath, data) {
  writeFileSync(join(projectPath, '.zenkit'), JSON.stringify(data, null, 2));
}

export function makeClient(fetchFn = nodeFetch, configPath = LOCAL_CONFIG_PATH) {
  function getHeaders() {
    const local = readLocalConfig(configPath);
    const key = local.apiKey || process.env.ZENKIT_API_KEY;
    if (!key) throw new Error('No API key found. Set apiKey in ~/.claude/zenkit.local.json or ZENKIT_API_KEY env var');
    return {
      'Content-Type': 'application/json',
      'Zenkit-API-Key': key,
    };
  }

  async function request(method, path, body) {
    const opts = { method, headers: getHeaders() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetchFn(`${BASE_URL}${path}`, opts);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Zenkit ${res.status}: ${text}`);
    }
    return res.json();
  }

  async function fetchWorkspacesWithLists() {
    return request('GET', '/users/me/workspacesWithLists');
  }

  const methods = {
    async listWorkspaces() {
      const workspaces = await fetchWorkspacesWithLists();
      return workspaces.map(ws => ({
        id: ws.id,
        name: ws.name,
        shortId: ws.shortId,
        listCount: ws.lists ? ws.lists.length : 0,
      }));
    },

    async listCollections(workspaceId) {
      const workspaces = await fetchWorkspacesWithLists();
      const ws = workspaces.find(w => String(w.id) === String(workspaceId));
      if (!ws) throw new Error(`Workspace ${workspaceId} not found`);
      return (ws.lists || []).map(l => ({ id: l.id, name: l.name, shortId: l.shortId }));
    },

    async listItems(listId, filter) {
      const body = filter ? { filter } : undefined;
      const result = await request('POST', `/lists/${listId}/entries/filter/list`, body);
      return result.listEntries ?? result;
    },

    async getItem(listId, entryId) {
      return request('GET', `/lists/${listId}/entries/${entryId}`);
    },

    async createItem(listId, fields) {
      return request('POST', `/lists/${listId}/entries`, fields);
    },

    async updateItem(listId, entryId, fields) {
      return request('PUT', `/lists/${listId}/entries/${entryId}`, fields);
    },

    async listWorkspaceMembers(workspaceId) {
      return request('GET', `/workspaces/${workspaceId}/users`);
    },

    async getListElements(listId) {
      return request('GET', `/lists/${listId}/elements`);
    },

    async getCurrentUser() {
      const local = readLocalConfig(configPath);
      if (local.userId) {
        return { id: local.userId, displayname: local.displayname, username: local.username };
      }
      const raw = await request('GET', '/auth/currentuser');
      const { id, shortId, uuid, displayname, fullname, initials, username, timezone } = raw;
      return { id, shortId, uuid, displayname, fullname, initials, username, timezone };
    },

    async listMyItems(listId) {
      const local = readLocalConfig(configPath);
      const userId = local.userId ?? (await methods.getCurrentUser()).id;
      const items = await methods.listItems(listId);
      return items.filter(item =>
        Object.keys(item).some(
          k => k.endsWith('_persons') && Array.isArray(item[k]) && item[k].includes(userId)
        )
      );
    },
  };
  return methods;
}

// key is read lazily per request in getHeaders()
const defaultClient = makeClient();
export const {
  listWorkspaces, listCollections, listItems, getItem, createItem, updateItem,
  listWorkspaceMembers, getCurrentUser, listMyItems, getListElements,
} = defaultClient;
