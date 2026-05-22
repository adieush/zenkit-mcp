import nodeFetch from 'node-fetch';

const BASE_URL = 'https://zenkit.com/api/v1';

export function makeClient(fetchFn = nodeFetch) {
  function getHeaders() {
    const key = process.env.ZENKIT_API_KEY;
    if (!key) throw new Error('ZENKIT_API_KEY environment variable is not set');
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

  return {
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
  };
}

// key is read lazily per request in getHeaders()
const defaultClient = makeClient();
export const { listWorkspaces, listCollections, listItems, getItem, createItem, updateItem } =
  defaultClient;
