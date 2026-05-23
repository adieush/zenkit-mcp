import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeClient, readLocalConfig, writeLocalConfig, readProjectConfig, writeProjectConfig } from './zenkit.js';

// Helper: create a mock fetch that returns a fixed JSON response
function mockFetch(responseBody, status = 200) {
  return async (_url, _opts) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  });
}

// Helper: capture the request made by mock fetch
function captureFetch(responseBody, status = 200) {
  let captured = null;
  const fetchFn = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    };
  };
  return { fetchFn, getCapture: () => captured };
}

test('listWorkspaces returns mapped workspace list', async () => {
  const raw = [
    { id: 1, name: 'Work', shortId: 'abc', lists: [{}] },
    { id: 2, name: 'Personal', shortId: 'def', lists: [] },
  ];
  const client = makeClient(mockFetch(raw));
  process.env.ZENKIT_API_KEY = 'test-key';
  const result = await client.listWorkspaces();
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'Work');
  assert.equal(result[0].listCount, 1);
  assert.equal(result[1].listCount, 0);
});

test('listWorkspaces sends correct auth header', async () => {
  const { fetchFn, getCapture } = captureFetch([]);
  process.env.ZENKIT_API_KEY = 'my-secret';
  const client = makeClient(fetchFn);
  await client.listWorkspaces();
  const { url, opts } = getCapture();
  assert.equal(url, 'https://zenkit.com/api/v1/users/me/workspacesWithLists');
  assert.equal(opts.headers['Zenkit-API-Key'], 'my-secret');
  assert.equal(opts.method, 'GET');
});

test('listCollections filters lists for given workspaceId', async () => {
  const raw = [
    { id: 10, name: 'WS1', shortId: 'ws1', lists: [{ id: 100, name: 'Backlog', shortId: 'bl' }] },
    { id: 20, name: 'WS2', shortId: 'ws2', lists: [] },
  ];
  const client = makeClient(mockFetch(raw));
  process.env.ZENKIT_API_KEY = 'test-key';
  const result = await client.listCollections('10');
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Backlog');
  assert.equal(result[0].id, 100);
});

test('listCollections throws if workspace not found', async () => {
  const client = makeClient(mockFetch([]));
  process.env.ZENKIT_API_KEY = 'test-key';
  await assert.rejects(
    () => client.listCollections('999'),
    /Workspace 999 not found/
  );
});

test('listItems POSTs to entries/filter/list', async () => {
  const entries = [{ id: 1 }, { id: 2 }];
  const { fetchFn, getCapture } = captureFetch({ listEntries: entries });
  process.env.ZENKIT_API_KEY = 'test-key';
  const client = makeClient(fetchFn);
  const result = await client.listItems('42', { searchValue: 'bug' });
  const { url, opts } = getCapture();
  assert.equal(url, 'https://zenkit.com/api/v1/lists/42/entries/filter/list');
  assert.equal(opts.method, 'POST');
  assert.deepEqual(JSON.parse(opts.body), { filter: { searchValue: 'bug' } });
  assert.equal(result.length, 2);
});

test('listItems works without filter', async () => {
  const { fetchFn, getCapture } = captureFetch({ listEntries: [] });
  process.env.ZENKIT_API_KEY = 'test-key';
  const client = makeClient(fetchFn);
  await client.listItems('42');
  const { opts } = getCapture();
  assert.equal(opts.body, undefined);
});

test('getItem GETs single entry', async () => {
  const entry = { id: 5, displayString: 'Fix login bug' };
  const { fetchFn, getCapture } = captureFetch(entry);
  process.env.ZENKIT_API_KEY = 'test-key';
  const client = makeClient(fetchFn);
  const result = await client.getItem('42', '5');
  const { url, opts } = getCapture();
  assert.equal(url, 'https://zenkit.com/api/v1/lists/42/entries/5');
  assert.equal(opts.method, 'GET');
  assert.equal(result.id, 5);
});

test('createItem POSTs fields to entries endpoint', async () => {
  const created = { id: 99, displayString: 'New task' };
  const { fetchFn, getCapture } = captureFetch(created);
  process.env.ZENKIT_API_KEY = 'test-key';
  const client = makeClient(fetchFn);
  const result = await client.createItem('42', { displayString: 'New task' });
  const { url, opts } = getCapture();
  assert.equal(url, 'https://zenkit.com/api/v1/lists/42/entries');
  assert.equal(opts.method, 'POST');
  assert.deepEqual(JSON.parse(opts.body), { displayString: 'New task' });
  assert.equal(result.id, 99);
});

test('updateItem PUTs fields to entries/{id} endpoint', async () => {
  const updated = { id: 5, displayString: 'Updated' };
  const { fetchFn, getCapture } = captureFetch(updated);
  process.env.ZENKIT_API_KEY = 'test-key';
  const client = makeClient(fetchFn);
  const result = await client.updateItem('42', '5', { displayString: 'Updated' });
  const { url, opts } = getCapture();
  assert.equal(url, 'https://zenkit.com/api/v1/lists/42/entries/5');
  assert.equal(opts.method, 'PUT');
  assert.deepEqual(JSON.parse(opts.body), { displayString: 'Updated' });
  assert.equal(result.id, 5);
});

test('API error throws with status code in message', async () => {
  const client = makeClient(mockFetch({ message: 'Not found' }, 404));
  process.env.ZENKIT_API_KEY = 'test-key';
  await assert.rejects(
    () => client.getItem('42', '999'),
    /Zenkit 404/
  );
});

test('missing API key throws before fetch', async () => {
  delete process.env.ZENKIT_API_KEY;
  const client = makeClient(mockFetch({}));
  await assert.rejects(
    () => client.listWorkspaces(),
    /ZENKIT_API_KEY/
  );
});

test('listWorkspaceMembers GETs workspace users', async () => {
  const users = [
    { id: 1, username: 'alice', displayname: 'Alice' },
    { id: 2, username: 'bob', displayname: 'Bob' },
  ];
  const { fetchFn, getCapture } = captureFetch(users);
  process.env.ZENKIT_API_KEY = 'test-key';
  const client = makeClient(fetchFn);
  const result = await client.listWorkspaceMembers('10');
  const { url, opts } = getCapture();
  assert.equal(url, 'https://zenkit.com/api/v1/workspaces/10/users');
  assert.equal(opts.method, 'GET');
  assert.equal(result.length, 2);
  assert.equal(result[0].username, 'alice');
});

test('getCurrentUser strips sensitive fields and returns profile', async () => {
  const raw = {
    id: 42, displayname: 'Alice', username: 'alice', initials: 'A',
    fullname: 'Alice Smith', timezone: 'UTC', shortId: 'abc',
    api_key: 'secret-key', settings: { lots: 'of stuff' }, tokens: {}, emails: [],
  };
  const { fetchFn, getCapture } = captureFetch(raw);
  process.env.ZENKIT_API_KEY = 'test-key';
  const client = makeClient(fetchFn);
  const result = await client.getCurrentUser();
  const { url, opts } = getCapture();
  assert.equal(url, 'https://zenkit.com/api/v1/auth/currentuser');
  assert.equal(opts.method, 'GET');
  assert.equal(result.id, 42);
  assert.equal(result.displayname, 'Alice');
  assert.equal(result.api_key, undefined);
  assert.equal(result.settings, undefined);
  assert.equal(result.tokens, undefined);
  assert.equal(result.emails, undefined);
});

test('listMyItems filters items by current user ID in _persons fields', async () => {
  const meRaw = { id: 99, displayname: 'Me', username: 'me', initials: 'M', fullname: 'Me', timezone: 'UTC', shortId: 'x' };
  const entries = [
    { id: 1, displayString: 'mine',     'abc_persons': [99, 5] },
    { id: 2, displayString: 'not mine', 'abc_persons': [5] },
    { id: 3, displayString: 'also mine','abc_persons': [99] },
    { id: 4, displayString: 'no field' },
  ];

  let callCount = 0;
  const fetchFn = async (url, opts) => {
    callCount++;
    const body = url.includes('currentuser') ? meRaw : { listEntries: entries };
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  };
  process.env.ZENKIT_API_KEY = 'test-key';
  const client = makeClient(fetchFn);
  const result = await client.listMyItems('42');
  assert.equal(result.length, 2);
  assert.equal(result[0].displayString, 'mine');
  assert.equal(result[1].displayString, 'also mine');
});

// --- File I/O helpers ---

test('readLocalConfig returns {} when file not found', () => {
  const result = readLocalConfig('/nonexistent/path/zenkit.local.json');
  assert.deepEqual(result, {});
});

test('readLocalConfig returns parsed config from file', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'zenkit-'));
  const p = join(tmp, 'zenkit.local.json');
  writeFileSync(p, JSON.stringify({ userId: 42, displayname: 'Alice' }));
  const result = readLocalConfig(p);
  assert.equal(result.userId, 42);
  assert.equal(result.displayname, 'Alice');
});

test('writeLocalConfig writes JSON to file', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'zenkit-'));
  const p = join(tmp, 'zenkit.local.json');
  writeLocalConfig({ userId: 99, apiKey: 'k' }, p);
  const result = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(result.userId, 99);
  assert.equal(result.apiKey, 'k');
});

test('readProjectConfig returns null when no .zenkit exists', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'zenkit-'));
  assert.equal(readProjectConfig(tmp), null);
});

test('readProjectConfig returns parsed config', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'zenkit-'));
  writeFileSync(join(tmp, '.zenkit'), JSON.stringify({ listId: '123', listName: 'Test' }));
  const result = readProjectConfig(tmp);
  assert.equal(result.listId, '123');
  assert.equal(result.listName, 'Test');
});

test('writeProjectConfig writes .zenkit file', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'zenkit-'));
  writeProjectConfig(tmp, { listId: '456', listName: 'My List' });
  const result = JSON.parse(readFileSync(join(tmp, '.zenkit'), 'utf8'));
  assert.equal(result.listId, '456');
});

test('getHeaders reads apiKey from local config file', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'zenkit-'));
  const configPath = join(tmp, 'zenkit.local.json');
  writeFileSync(configPath, JSON.stringify({ apiKey: 'from-file' }));
  delete process.env.ZENKIT_API_KEY;
  const { fetchFn, getCapture } = captureFetch([]);
  const client = makeClient(fetchFn, configPath);
  await client.listWorkspaces();
  assert.equal(getCapture().opts.headers['Zenkit-API-Key'], 'from-file');
  process.env.ZENKIT_API_KEY = 'test-key'; // restore for subsequent tests
});

test('getCurrentUser returns cached profile from local config without API call', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'zenkit-'));
  const configPath = join(tmp, 'zenkit.local.json');
  writeFileSync(configPath, JSON.stringify({ apiKey: 'k', userId: 42, displayname: 'Cached', username: 'cached' }));
  let fetchCalled = false;
  const fetchFn = async () => { fetchCalled = true; return {}; };
  const client = makeClient(fetchFn, configPath);
  const result = await client.getCurrentUser();
  assert.equal(fetchCalled, false);
  assert.equal(result.id, 42);
  assert.equal(result.displayname, 'Cached');
});

test('listMyItems uses cached userId from local config without extra API call', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'zenkit-'));
  const configPath = join(tmp, 'zenkit.local.json');
  writeFileSync(configPath, JSON.stringify({ apiKey: 'k', userId: 7 }));
  const entries = [
    { id: 1, displayString: 'mine', 'x_persons': [7] },
    { id: 2, displayString: 'not mine', 'x_persons': [5] },
  ];
  const client = makeClient(mockFetch({ listEntries: entries }), configPath);
  const result = await client.listMyItems('42');
  assert.equal(result.length, 1);
  assert.equal(result[0].displayString, 'mine');
});

test('getListElements GETs elements for a list', async () => {
  const elements = [{ uuid: 'abc', name: 'Assigned To', elementcategory: 14 }];
  const { fetchFn, getCapture } = captureFetch(elements);
  process.env.ZENKIT_API_KEY = 'test-key';
  const client = makeClient(fetchFn);
  const result = await client.getListElements('42');
  assert.equal(getCapture().url, 'https://zenkit.com/api/v1/lists/42/elements');
  assert.equal(result.length, 1);
  assert.equal(result[0].elementcategory, 14);
});
