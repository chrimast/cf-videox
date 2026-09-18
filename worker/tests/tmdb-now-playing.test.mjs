import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = {
  DB: {
    prepare(sql) {
      return {
        bind() { return this; },
        first: async () => sql.includes('tmdb_api_key') ? { value: 'tmdb-test-key' } : null,
        all: async () => ({ results: [] }),
      };
    },
  },
  fetch: async (url) => {
    const href = String(url);
    if (href.includes('api.themoviedb.org')) {
      return new Response(JSON.stringify({
        results: [{
          id: 101,
          title: '逃出绝命街',
          original_title: 'Street Escape',
          poster_path: '/poster.jpg',
          release_date: '2026-09-01',
          vote_average: 7.8,
          overview: 'test',
        }],
      }), { headers: { 'content-type': 'application/json' } });
    }
    if (href.includes('image.example/cover.webp')) {
      return new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), { headers: { 'content-type': 'image/webp' } });
    }
    return new Response('missing', { status: 404 });
  },
};

test('TMDB now-playing returns poster urls from configured API key', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/tmdb/now-playing'), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.data[0].vod_name, '逃出绝命街');
  assert.equal(payload.data[0].vod_pic, 'https://image.tmdb.org/t/p/w500/poster.jpg');
});

test('image proxy returns upstream image bytes', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/proxy/image?url=' + encodeURIComponent('https://image.example/cover.webp')), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /image\/webp/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(bytes[0], 0x52);
});
