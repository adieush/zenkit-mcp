import nodeFetch from 'node-fetch';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://zenkit.com/api/v1';
export const LOCAL_CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'zenkit.local.json');

const MIME_BY_EXT = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain',
  csv: 'text/csv', json: 'application/json', xml: 'application/xml',
  html: 'text/html', pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml',
  zip: 'application/zip', gz: 'application/gzip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function guessMimetype(fileName) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

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
  function getKey() {
    const local = readLocalConfig(configPath);
    const key = local.apiKey || process.env.ZENKIT_API_KEY;
    if (!key) throw new Error('No API key found. Set apiKey in ~/.claude/zenkit.local.json or ZENKIT_API_KEY env var');
    return key;
  }

  function getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Zenkit-API-Key': getKey(),
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

  // Multipart upload — the JSON `request` helper can't be used because the body is
  // raw multipart/form-data, not JSON. The body is assembled manually (a single
  // "file" part) so the boundary is deterministic and there is no dependency on
  // node-fetch <-> FormData interop.
  async function uploadMultipart(path, { buffer, fileName, mimetype }) {
    const boundary = '----zenkitmcp' + Date.now().toString(16) + Math.random().toString(16).slice(2);
    const safeName = String(fileName).replace(/[\r\n"]/g, '');
    const head = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
      `Content-Type: ${mimetype}\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, Buffer.from(buffer), tail]);
    const res = await fetchFn(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Zenkit-API-Key': getKey(),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
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

    async deleteItem(listId, entryId) {
      return request('DELETE', `/lists/${listId}/entries/${entryId}`);
    },

    async listWorkspaceMembers(workspaceId) {
      return request('GET', `/workspaces/${workspaceId}/users`);
    },

    async listCollectionMembers(listId) {
      return request('GET', `/lists/${listId}/users`);
    },

    async getListElements(listId) {
      return request('GET', `/lists/${listId}/elements`);
    },

    // Low-level: upload raw bytes to a files element. Returns the created File object
    // ({ id, uuid, fileName, size, mimetype, ... }). This only puts the file into the
    // element's pool — it does NOT link it to any entry.
    async uploadFile(listId, elementId, { buffer, fileName, mimetype }) {
      // The endpoint responds with an array of created File objects (one per uploaded
      // part). We upload a single "file" part, so unwrap to that one File object.
      const res = await uploadMultipart(`/lists/${listId}/elements/${elementId}/files`, {
        buffer,
        fileName,
        mimetype: mimetype || guessMimetype(fileName),
      });
      return Array.isArray(res) ? res[0] : res;
    },

    // High-level: attach a file on disk to a specific entry (ticket). Uploads the file
    // to the collection's files element, then links it to the entry's files field
    // (`{elementUuid}_files`), preserving any files already attached.
    async addAttachment(listId, entryId, filePath) {
      const elements = await methods.getListElements(listId);
      const filesEl = elements.find(e => e.resourceRole === 'files' || e.elementcategory === 15);
      if (!filesEl) throw new Error(`No files/attachments element found in list ${listId}`);

      const fileName = basename(filePath);
      const buffer = readFileSync(filePath);
      const file = await methods.uploadFile(listId, filesEl.id, {
        buffer,
        fileName,
        mimetype: guessMimetype(fileName),
      });

      const fieldKey = `${filesEl.uuid}_files`;
      const entry = await methods.getItem(listId, entryId);
      const existing = Array.isArray(entry[fieldKey]) ? entry[fieldKey] : [];
      const files = [...new Set([...existing, file.id])];
      await methods.updateItem(listId, entryId, { [fieldKey]: files });

      return {
        ok: true,
        file: { id: file.id, uuid: file.uuid, fileName: file.fileName, size: file.size, mimetype: file.mimetype },
        elementUuid: filesEl.uuid,
        files,
      };
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
  listWorkspaces, listCollections, listItems, getItem, createItem, updateItem, deleteItem,
  listWorkspaceMembers, listCollectionMembers, getCurrentUser, listMyItems, getListElements,
  uploadFile, addAttachment,
} = defaultClient;
