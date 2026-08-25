import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = {
  DB: {
    prepare(sql) {
      return { bind() { return this; }, all: async () => ({ results: sql.includes('video_sources') ? [{ id: 1, url: 'https://cms.example/api.php/provide/vod' }] : [] }), first: async () => ({ id: 1, url: 'https://cms.example/api.php/provide/vod' }) };
    },
  },
};

test('CMS video search returns normalized remote results', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/videos/search?keyword=测试&source_id=1'), {
    ...env,
    fetch: async () => new Response(JSON.stringify({ list: [{ vod_id: '7', vod_name: '测试片', vod_pic: 'https://img.example/7.jpg' }], page: 1, pagecount: 1, total: 1 }), { headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data[0].vod_name, '测试片');
});

test('CMS categories return normalized class entries', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/categories?source_id=1'), {
    ...env,
    fetch: async () => new Response(JSON.stringify({ class: [{ type_id: 1, type_name: '电影', type_pid: 0 }] }), { headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data[0].name, '电影');
});

test('CMS detail route returns playable episode structure', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/videos/7?source_id=1'), {
    ...env,
    fetch: async () => new Response(JSON.stringify({ list: [{
      vod_id: '7', vod_name: '测试片', vod_play_from: '线路一',
      vod_play_url: '第1集$https://media.example/episode-1.m3u8',
    }] }), { headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.vod_id, '7');
  assert.equal(payload.data.episodes[0].list[0].url, 'https://media.example/episode-1.m3u8');
});
