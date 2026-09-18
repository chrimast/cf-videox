import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const sources = [{
  id: 1,
  name: '奇艺',
  url: 'https://cms.example/api.php/provide/vod',
  type: 'cms_api',
  api_key: '',
  enabled: 1,
  hidden: 0,
  tags: '',
  remark: '',
  sort_order: 0,
}];

const updates = [];

const env = {
  DB: {
    prepare(sql) {
      const bound = [];
      const stmt = {
        bind(...args) { bound.push(...args); return stmt; },
        first: async () => sources.find((item) => item.id === Number(bound[0])) || null,
        all: async () => ({ results: sources }),
        run: async () => {
          updates.push({ sql, bound });
          if (sql.includes('response_time')) {
            const source = sources.find((item) => item.id === Number(bound[1]));
            if (source) source.response_time = bound[0];
          }
          return { success: true };
        },
      };
      return stmt;
    },
    batch: async (statements) => Promise.all(statements.map((item) => item.run?.() || item)),
  },
  fetch: async () => new Response(JSON.stringify({
    code: 1,
    class: [{ type_id: 1, type_name: '电影', type_pid: 0 }],
    list: [{ vod_id: '7', vod_name: '测试片', type_name: '电影', vod_year: '2026' }],
  }), { headers: { 'content-type': 'application/json' } }),
};

test('single source test endpoint probes CMS and returns responseTime', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/sources/1/test', { method: 'POST' }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(typeof payload.responseTime, 'number');
  assert.ok(updates.some((item) => item.sql.includes('response_time')));
});

test('source sync endpoint streams category progress', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/sources/1/sync?stream=true', { method: 'POST' }), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
  const body = await response.text();
  assert.match(body, /分类同步完成/);
  assert.match(body, /\[DONE\]/);
});

test('home endpoint loads videos from CMS when cache is empty', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/home'), {
    ...env,
    DB: {
      ...env.DB,
      prepare(sql) {
        const bound = [];
        const stmt = {
          bind(...args) { bound.push(...args); return stmt; },
          first: async () => null,
          all: async () => ({ results: sql.includes('home_cache') ? [] : sources }),
          run: async () => ({ success: true }),
        };
        return stmt;
      },
    },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok((payload.data.hot || []).length > 0 || (payload.data.movie?.latest || []).length > 0);
});
