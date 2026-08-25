import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = {
  DB: {
    prepare() {
      return { bind() { return this; }, first: async () => null, all: async () => ({ results: [] }) };
    },
  },
};

test('health endpoint returns Worker-compatible response', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/health'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'healthy', service: 'videox', mode: 'cloudflare' });
});

test('sources endpoint returns an empty D1-backed collection', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/sources'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: [] });
});

test('unsupported local-media routes are not exposed', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/netdisk/sources'), env);
  assert.equal(response.status, 404);
});

test('unsupported transcode routes are not exposed', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/transcode/detect'), env);
  assert.equal(response.status, 404);
});

test('favorite check and live refresh compatibility routes are available', async () => {
  const favorite = await worker.fetch(new Request('https://example.com/api/videos/favorites/check?source_id=1&vod_id=2'), env);
  assert.equal(favorite.status, 200);
  assert.equal((await favorite.json()).data.isFavorite, false);
  const refresh = await worker.fetch(new Request('https://example.com/api/live/refresh-all', { method: 'POST' }), env);
  assert.equal(refresh.status, 200);
});
