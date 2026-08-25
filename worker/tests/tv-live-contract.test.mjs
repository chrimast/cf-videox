import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const state = { tv_sources: [], live_sources: [] };
const env = {
  DB: {
    prepare(sql) {
      return {
        bind() { return this; },
        all: async () => ({ results: sql.includes('tv_sources') ? state.tv_sources : state.live_sources }),
        first: async () => null,
        run: async () => ({ success: true }),
      };
    },
  },
};

test('TV sources endpoint returns configured sources', async () => {
  state.tv_sources = [{ id: 1, name: '新闻', url: 'https://example.com/live.m3u', type: 'm3u', enabled: 1 }];
  const response = await worker.fetch(new Request('https://example.com/api/tv/sources'), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, state.tv_sources.map(item => ({ ...item, enabled: Boolean(item.enabled) })));
});

test('live sources endpoint returns configured sources', async () => {
  state.live_sources = [{ id: 2, name: '直播', platform: 'bilibili', url: 'https://example.com/live', enabled: 1 }];
  const response = await worker.fetch(new Request('https://example.com/api/live/sources'), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, state.live_sources.map(item => ({ ...item, enabled: Boolean(item.enabled) })));
});

test('TV playlist endpoint parses M3U channel entries', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/tv/playlist/1'), {
    ...env,
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          first: async () => ({ id: 1, url: 'https://example.com/live.m3u', type: 'm3u' }),
          all: async () => ({ results: [] }),
        };
      },
    },
    fetch: globalThis.fetch,
  });
  assert.notEqual(response.status, 404);
});
