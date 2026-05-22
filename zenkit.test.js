import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from './zenkit.js';

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
  assert.deepEqual(JSON.parse(opts.body), {});
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
