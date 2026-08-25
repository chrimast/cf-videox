const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
});

const rows = async (db, sql, ...args) => {
  const statement = db.prepare(sql);
  const bound = args.length ? statement.bind(...args) : statement;
  const result = await bound.all();
  return result.results || [];
};

const first = async (db, sql, ...args) => {
  const statement = db.prepare(sql);
  const bound = args.length ? statement.bind(...args) : statement;
  return bound.first();
};

const body = async (request) => {
  try { return await request.json(); } catch { return {}; }
};

const normalizeSource = (row) => ({
  ...row,
  enabled: Boolean(row.enabled),
  hidden: Boolean(row.hidden),
});

const normalizeToggle = (row) => ({ ...row, enabled: Boolean(row.enabled) });

async function managedSources(request, env, table) {
  if (request.method === 'GET') {
    const data = await rows(env.DB, `SELECT * FROM ${table} ORDER BY sort_order ASC, id ASC`);
    return json({ success: true, data: data.map(normalizeToggle) });
  }
  if (request.method === 'POST') {
    const input = await body(request);
    if (!input.name || !input.url) return json({ success: false, error: 'Name and URL are required' }, 400);
    const sql = table === 'tv_sources'
      ? 'INSERT INTO tv_sources(name,url,type,enabled,sort_order) VALUES(?,?,?,?,?)'
      : 'INSERT INTO live_sources(name,platform,url,enabled,sort_order) VALUES(?,?,?,?,?)';
    const values = table === 'tv_sources'
      ? [input.name, input.url, input.type || 'm3u', input.enabled === false ? 0 : 1, Number(input.sort_order || 0)]
      : [input.name, input.platform || '', input.url, input.enabled === false ? 0 : 1, Number(input.sort_order || 0)];
    const result = await env.DB.prepare(sql).bind(...values).run();
    return json({ success: true, id: result.meta?.last_row_id || null }, 201);
  }
  return json({ success: false, error: 'Method not allowed' }, 405);
}

async function managedSourceById(request, env, table, id) {
  const current = await first(env.DB, `SELECT * FROM ${table} WHERE id = ?`, id);
  if (!current) return json({ success: false, error: 'Not found' }, 404);
  if (request.method === 'DELETE') {
    await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    return json({ success: true });
  }
  if (request.method === 'PUT' || request.method === 'PATCH') {
    const input = { ...current, ...(await body(request)) };
    const sql = table === 'tv_sources'
      ? 'UPDATE tv_sources SET name=?,url=?,type=?,enabled=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
      : 'UPDATE live_sources SET name=?,platform=?,url=?,enabled=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?';
    const values = table === 'tv_sources'
      ? [input.name, input.url, input.type || 'm3u', input.enabled ? 1 : 0, Number(input.sort_order || 0), id]
      : [input.name, input.platform || '', input.url, input.enabled ? 1 : 0, Number(input.sort_order || 0), id];
    await env.DB.prepare(sql).bind(...values).run();
    return json({ success: true });
  }
  return json({ success: false, error: 'Method not allowed' }, 405);
}

const parseM3u = (content) => {
  const result = [];
  let current = null;
  for (const raw of String(content).split(/\\r?\\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      current = { name: line.slice(line.indexOf(',') + 1).trim() || 'Unknown', group: line.match(/group-title="([^"]*)"/)?.[1] || '其他', logo: line.match(/tvg-logo="([^"]*)"/)?.[1] || '' };
    } else if (!line.startsWith('#') && current) {
      result.push({ ...current, url: line });
      current = null;
    }
  }
  return result;
};

async function tvPlaylist(request, env, id) {
  const source = await first(env.DB, 'SELECT * FROM tv_sources WHERE id = ?', id);
  if (!source) return json({ success: false, error: 'TV source not found' }, 404);
  const upstream = await fetch(source.url, { headers: { 'User-Agent': 'VideoX/Cloudflare' } });
  if (!upstream.ok) return json({ success: false, error: `Upstream HTTP ${upstream.status}` }, 502);
  const content = await upstream.text();
  let channels = [];
  if (source.type === 'json' || source.url.toLowerCase().includes('.json')) {
    const data = JSON.parse(content);
    const walk = (items, group = '默认') => (Array.isArray(items) ? items.flatMap(item => item.url && item.name ? [{ name: item.name, url: item.url, group: item.group || group, logo: item.logo || '' }] : walk(item.channels, item.group || item.name || group)) : []);
    channels = walk(data);
  } else channels = parseM3u(content);
  return json({ success: true, data: channels });
}

async function cmsRequest(source, params = {}) {
  const target = new URL(source.url);
  target.searchParams.set('ac', params.ac || 'list');
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
  const response = await (source.fetch || fetch)(target, { headers: { 'User-Agent': 'VideoX/Cloudflare', Accept: 'application/json' } });
  if (!response.ok) throw new Error(`CMS HTTP ${response.status}`);
  return response.json();
}

const normalizeVideo = (item) => ({
  vod_id: String(item.vod_id ?? ''), vod_name: item.vod_name || '', vod_pic: item.vod_pic || '',
  vod_year: item.vod_year || '', vod_area: item.vod_area || '', vod_lang: item.vod_lang || '',
  vod_class: item.vod_class || '', vod_remarks: item.vod_remarks || '', vod_score: item.vod_score || item.vod_douban_score || '',
  type_id: item.type_id, type_name: item.type_name || '', vod_actor: item.vod_actor || ''
});

const parseEpisodes = (playUrl, playFrom) => {
  if (!playUrl) return [];
  const sources = String(playFrom || '').split('$$$');
  return String(playUrl).split('$$$').map((group, index) => {
    const list = group.split('#').map(entry => {
      const [name, url] = entry.split('$');
      return { name: name || '播放', url: url || '' };
    }).filter(item => /^https?:\/\//i.test(item.url) && /(?:\.m3u8|\.mp4|\.flv|\.webm|\/live\/|\/stream\/)/i.test(item.url));
    return { source: sources[index] || `线路${index + 1}`, list };
  }).filter(item => item.list.length > 0);
};

async function cmsSource(env, sourceId) {
  const source = await first(env.DB, 'SELECT * FROM video_sources WHERE id = ? AND enabled = 1', sourceId);
  if (!source) return null;
  if (env.fetch) source.fetch = env.fetch;
  return source;
}

async function cmsCategories(request, env) {
  const sourceId = new URL(request.url).searchParams.get('source_id');
  const source = await cmsSource(env, sourceId);
  if (!source) return json({ success: false, error: 'Source not found' }, 404);
  const data = await cmsRequest(source, { ac: 'list' });
  const categories = (data.class || []).map(item => ({ id: item.type_id, source_id: Number(sourceId), type_id: String(item.type_id), name: item.type_name || '', parent_id: item.type_pid || 0, sort_order: 0, has_content: 1 }));
  return json({ success: true, data: categories });
}

async function cmsVideos(request, env) {
  const url = new URL(request.url);
  const sourceId = url.searchParams.get('source_id');
  const keyword = (url.searchParams.get('keyword') || url.searchParams.get('q') || '').toLowerCase();
  const query = { ac: 'detail', pg: url.searchParams.get('page') || 1, wd: keyword || undefined };
  if (sourceId) {
    const source = await cmsSource(env, sourceId);
    if (!source) return json({ success: false, error: 'Source not found' }, 404);
    const data = await cmsRequest(source, { ...query, t: url.searchParams.get('category_id') || undefined });
    const list = (data.list || []).map(item => ({ ...normalizeVideo(item), source_id: Number(sourceId) }));
    return json({ success: true, data: list, page: data.page || 1, pagecount: data.pagecount || 1, total: data.total || list.length });
  }
  const sourceRows = await rows(env.DB, 'SELECT * FROM video_sources WHERE enabled=1 ORDER BY sort_order,id');
  const settled = await Promise.allSettled(sourceRows.map(async source => {
    if (env.fetch) source.fetch = env.fetch;
    const data = await cmsRequest(source, query);
    return (data.list || []).map(item => ({ ...normalizeVideo(item), source_id: Number(source.id) }));
  }));
  const list = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  return json({ success: true, data: list, page: 1, pagecount: 1, total: list.length });
}

async function cmsDetail(request, env, pathVodId = null) {
  const url = new URL(request.url);
  const source = await cmsSource(env, url.searchParams.get('source_id'));
  if (!source) return json({ success: false, error: 'Source not found' }, 404);
  const data = await cmsRequest(source, { ac: 'detail', ids: pathVodId || url.searchParams.get('vod_id') });
  const item = data.list?.[0];
  if (!item) return json({ success: false, error: 'Video not found' }, 404);
  return json({ success: true, data: { ...normalizeVideo(item), vod_content: String(item.vod_content || item.vod_blurb || '').replace(/<[^>]*>/g, '').trim(), vod_director: item.vod_director || '', vod_play_from: item.vod_play_from || '', vod_play_url: item.vod_play_url || '', episodes: parseEpisodes(item.vod_play_url, item.vod_play_from) } });
}

async function sources(request, env) {
  if (request.method === 'GET') {
    const data = await rows(env.DB, 'SELECT * FROM video_sources ORDER BY sort_order ASC, id ASC');
    return json({ success: true, data: data.map(normalizeSource) });
  }
  if (request.method === 'POST') {
    const input = await body(request);
    if (!input.name || !input.url) return json({ success: false, error: 'Name and URL are required' }, 400);
    await env.DB.prepare(`INSERT INTO video_sources
      (name, url, type, api_key, enabled, hidden, tags, remark, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(input.name, input.url, input.type || 'cms_api', input.api_key || '', input.enabled === false ? 0 : 1,
        input.hidden ? 1 : 0, input.tags || '', input.remark || '', Number(input.sort_order || 0)).run();
    return json({ success: true });
  }
  return json({ success: false, error: 'Method not allowed' }, 405);
}

async function managedBatch(request, env, table, action) {
  const input = await body(request);
  if (!Array.isArray(input.ids) || !input.ids.length) return json({ success: false, error: 'IDs are required' }, 400);
  if (action === 'delete') {
    await env.DB.batch(input.ids.map(id => env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(Number(id))));
    return json({ success: true });
  }
  const updates = input.updates || {};
  await env.DB.batch(input.ids.map(id => env.DB.prepare(`UPDATE ${table} SET enabled=? WHERE id=?`).bind(updates.enabled === undefined ? 1 : (updates.enabled ? 1 : 0), Number(id))));
  return json({ success: true });
}

const parseSourceImport = (input) => Array.isArray(input.sources) ? input.sources : [];

async function sourceExtras(request, env, action) {
  if (action === 'export') return json({ success: true, data: await rows(env.DB, 'SELECT name,url,type,api_key,enabled,hidden,tags,remark,sort_order FROM video_sources ORDER BY sort_order,id') });
  const input = await body(request);
  const imported = parseSourceImport(input);
  if (!imported.length) return json({ success: false, error: 'Sources array is required' }, 400);
  if (input.mode === 'replace') await env.DB.prepare('DELETE FROM video_sources').run();
  await env.DB.batch(imported.map(source => env.DB.prepare('INSERT INTO video_sources(name,url,type,api_key,enabled,hidden,tags,remark,sort_order) VALUES(?,?,?,?,?,?,?,?,?)').bind(source.name, source.url, source.type || 'cms_api', source.api_key || '', source.enabled === false ? 0 : 1, source.hidden ? 1 : 0, source.tags || '', source.remark || '', Number(source.sort_order || 0))));
  return json({ success: true, data: await rows(env.DB, 'SELECT * FROM video_sources ORDER BY sort_order,id'), imported: imported.length });
}

async function sourceById(request, env, id) {
  if (request.method === 'GET') {
    const item = await first(env.DB, 'SELECT * FROM video_sources WHERE id = ?', id);
    return item ? json({ success: true, data: normalizeSource(item) }) : json({ success: false, error: 'Not found' }, 404);
  }
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM video_sources WHERE id = ?').bind(id).run();
    return json({ success: true });
  }
  if (request.method === 'PUT' || request.method === 'PATCH') {
    const input = await body(request);
    const current = await first(env.DB, 'SELECT * FROM video_sources WHERE id = ?', id);
    if (!current) return json({ success: false, error: 'Not found' }, 404);
    const next = { ...current, ...input };
    await env.DB.prepare(`UPDATE video_sources SET name=?, url=?, type=?, api_key=?, enabled=?, hidden=?, tags=?, remark=?, sort_order=? WHERE id=?`)
      .bind(next.name, next.url, next.type || 'cms_api', next.api_key || '', next.enabled ? 1 : 0, next.hidden ? 1 : 0,
        next.tags || '', next.remark || '', Number(next.sort_order || 0), id).run();
    return json({ success: true });
  }
  return json({ success: false, error: 'Method not allowed' }, 405);
}

async function settings(request, env) {
  const keyMatch = new URL(request.url).pathname.match(/^\/api\/settings\/([^/]+)$/);
  if (keyMatch && request.method === 'GET') {
    const item = await first(env.DB, 'SELECT key,value FROM settings WHERE key=?', keyMatch[1]);
    if (!item) return json({ success: false, error: 'Setting not found' }, 404);
    let value = item.value;
    try { value = JSON.parse(value); } catch {}
    return json({ success: true, data: { key: item.key, value } });
  }
  if (keyMatch && request.method === 'PUT') {
    const input = await body(request);
    const value = typeof input.value === 'string' ? input.value : JSON.stringify(input.value);
    await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(keyMatch[1], value).run();
    return json({ success: true, data: { key: keyMatch[1], value: input.value } });
  }
  if (request.method === 'GET') {
    const result = {};
    for (const row of await rows(env.DB, 'SELECT key,value FROM settings')) {
      try { result[row.key] = JSON.parse(row.value); } catch { result[row.key] = row.value; }
    }
    return json({ success: true, data: result });
  }
  if (request.method === 'PUT') {
    const input = await body(request);
    const statements = Object.entries(input || {}).map(([key, value]) => env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, typeof value === 'string' ? value : JSON.stringify(value)));
    if (statements.length) await env.DB.batch(statements);
    return json({ success: true });
  }
  return json({ success: false, error: 'Method not allowed' }, 405);
}

async function verifyPassword(request, env, key) {
  const input = await body(request);
  const found = await rows(env.DB, 'SELECT key,value FROM settings WHERE key IN (?,?)', `${key}_enabled`, key);
  const values = Object.fromEntries(found.map(row => [row.key, row.value]));
  const enabled = values[`${key}_enabled`] === 'true' || values[`${key}_enabled`] === true;
  const valid = !enabled || String(input.password || '') === String(values[key] || '');
  return json({ success: true, valid, message: valid ? 'Password correct' : 'Password incorrect' });
}

async function testTmdb(request) {
  const input = await body(request);
  if (!input.api_key) return json({ success: false, error: 'API key required' }, 400);
  try {
    const response = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(input.api_key)}`);
    if (!response.ok) return json({ success: true, valid: false, message: `HTTP ${response.status}` });
    const data = await response.json();
    return json({ success: true, valid: true, message: 'TMDB API connection successful', images_base_url: data.images?.secure_base_url });
  } catch (error) {
    return json({ success: true, valid: false, message: error.message });
  }
}

async function testProxy(request) {
  const input = await body(request);
  if (!input.proxy_host || !input.proxy_port) return json({ success: false, error: 'Proxy host and port required' }, 400);
  return json({ success: true, valid: false, message: 'Worker 不支持直接建立 SOCKS/HTTP 代理 Socket 连接' });
}

async function favorites(request, env) {
  const url = new URL(request.url);
  if (request.method === 'GET' && (url.pathname === '/api/favorites/check' || url.pathname === '/api/videos/favorites/check')) {
    const item = await first(env.DB, 'SELECT id FROM app_favorites WHERE source_id=? AND source_type=? AND vod_id=?', Number(url.searchParams.get('source_id')), url.searchParams.get('source_type') || 'cms', String(url.searchParams.get('vod_id') || ''));
    return json({ success: true, data: { isFavorite: Boolean(item) } });
  }
  if (request.method === 'GET') return json({ success: true, data: await rows(env.DB, 'SELECT * FROM app_favorites ORDER BY created_at DESC') });
  if (request.method === 'POST') {
    const x = await body(request);
    await env.DB.prepare('INSERT OR IGNORE INTO app_favorites(source_id,source_type,vod_id,title,cover,year) VALUES(?,?,?,?,?,?)').bind(Number(x.source_id), x.source_type || 'cms', String(x.vod_id), x.title || '', x.cover || '', x.year || '').run();
    return json({ success: true });
  }
  if (request.method === 'DELETE' && /^\/api\/favorites\/[^/]+$/.test(url.pathname)) {
    await env.DB.prepare('DELETE FROM app_favorites WHERE id=?').bind(Number(url.pathname.split('/').pop())).run();
    return json({ success: true });
  }
  if (request.method === 'DELETE') {
    const sourceId = url.searchParams.get('source_id');
    const vodId = url.searchParams.get('vod_id');
    if (sourceId && vodId) await env.DB.prepare('DELETE FROM app_favorites WHERE source_id=? AND source_type=? AND vod_id=?').bind(Number(sourceId), url.searchParams.get('source_type') || 'cms', vodId).run();
    else await env.DB.prepare('DELETE FROM app_favorites').run();
    return json({ success: true });
  }
  return json({ success: false, error: 'Method not allowed' }, 405);
}

async function history(request, env) {
  if (request.method === 'GET') return json({ success: true, data: await rows(env.DB, 'SELECT * FROM play_history ORDER BY updated_at DESC LIMIT 100') });
  if (request.method === 'POST') {
    const x = await body(request);
    await env.DB.prepare(`INSERT INTO play_history(source_id,source_type,vod_id,title,cover,episode,episode_name,progress,duration) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,source_type,vod_id) DO UPDATE SET title=excluded.title,cover=excluded.cover,episode=excluded.episode,episode_name=excluded.episode_name,progress=excluded.progress,duration=excluded.duration,updated_at=CURRENT_TIMESTAMP`).bind(Number(x.source_id), x.source_type || 'cms', String(x.vod_id), x.title || '', x.cover || '', Number(x.episode || 0), x.episode_name || '', Number(x.progress || 0), Number(x.duration || 0)).run();
    return json({ success: true });
  }
  if (request.method === 'DELETE' && /^\/api\/history\/[^/]+$/.test(new URL(request.url).pathname)) {
    await env.DB.prepare('DELETE FROM play_history WHERE id=?').bind(Number(new URL(request.url).pathname.split('/').pop())).run();
    return json({ success: true });
  }
  if (request.method === 'DELETE') { await env.DB.prepare('DELETE FROM play_history').run(); return json({ success: true }); }
  return json({ success: false, error: 'Method not allowed' }, 405);
}
async function homeData(request, env) {
  const cacheRows = await rows(env.DB, 'SELECT key,data,updated_at FROM home_cache ORDER BY key');
  const data = { hot: [], movie: {}, tv: {}, anime: {}, variety: {} };
  let lastUpdated = null;
  for (const row of cacheRows) {
    let value = [];
    try { value = JSON.parse(row.data); } catch { value = []; }
    if (row.key === 'home_hot') data.hot = value;
    else if (row.key.startsWith('home_')) {
      const [, section, sub] = row.key.split('_');
      if (!data[section]) data[section] = {};
      data[section][sub] = value;
    }
    if (row.updated_at && (!lastUpdated || row.updated_at < lastUpdated)) lastUpdated = row.updated_at;
  }
  return json({ success: true, data, lastUpdated });
}

async function refreshHomeSection(request, env) {
  const input = await body(request);
  const valid = ['hot', 'movie', 'tv', 'anime', 'variety'];
  if (!valid.includes(input.section)) return json({ success: false, error: 'Invalid section' }, 400);
  return json({ success: true, data: [] });
}

async function sourceBatch(request, env, action) {
  const input = await body(request);
  if (!Array.isArray(input.ids) || input.ids.length === 0) return json({ success: false, error: 'IDs are required' }, 400);
  if (action === 'delete') {
    await env.DB.batch(input.ids.map(id => env.DB.prepare('DELETE FROM video_sources WHERE id=?').bind(Number(id))));
    return json({ success: true, message: `Deleted ${input.ids.length} sources` });
  }
  if (action === 'update') {
    const updates = input.updates || {};
    const statements = input.ids.map(id => env.DB.prepare('UPDATE video_sources SET enabled=?,hidden=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(updates.enabled === undefined ? 1 : (updates.enabled ? 1 : 0), updates.hidden === undefined ? 0 : (updates.hidden ? 1 : 0), Number(id)));
    await env.DB.batch(statements);
    return json({ success: true, data: await rows(env.DB, 'SELECT * FROM video_sources ORDER BY sort_order,id') });
  }
  if (action === 'test') {
    const results = [];
    for (const id of input.ids) {
      const source = await first(env.DB, 'SELECT * FROM video_sources WHERE id=?', Number(id));
      if (!source) continue;
      const started = Date.now();
      try { const response = await fetch(new URL(`${source.url}${source.url.includes('?') ? '&' : '?'}ac=list&pg=1`)); results.push({ id: Number(id), success: response.ok, responseTime: Date.now() - started, ...(response.ok ? {} : { error: `HTTP ${response.status}` }) }); }
      catch (error) { results.push({ id: Number(id), success: false, responseTime: Date.now() - started, error: error.message }); }
    }
    return json({ success: true, data: results });
  }
  return json({ success: false, error: 'Unsupported batch action' }, 400);
}

async function proxy(request, env) {
  const url = new URL(request.url).searchParams.get('url');
  if (!url) return json({ success: false, error: 'Missing url' }, 400);
  let target;
  try { target = new URL(url); } catch { return json({ success: false, error: 'Invalid url' }, 400); }
  if (!['http:', 'https:'].includes(target.protocol)) return json({ success: false, error: 'Unsupported protocol' }, 400);
  const upstream = await fetch(target, { headers: { 'User-Agent': 'VideoX/Cloudflare' } });
  const headers = new Headers(upstream.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('cache-control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (path === '/api/health') return json({ status: 'healthy', service: 'videox', mode: 'cloudflare' });
      if (path === '/api/sources') return sources(request, env);
      if (path === '/api/tv/sources') return managedSources(request, env, 'tv_sources');
      if (path === '/api/live/sources') return managedSources(request, env, 'live_sources');
      const tvSourceMatch = path.match(/^\/api\/tv\/sources\/([^/]+)$/);
      if (tvSourceMatch) return managedSourceById(request, env, 'tv_sources', tvSourceMatch[1]);
      const liveSourceMatch = path.match(/^\/api\/live\/sources\/([^/]+)$/);
      if (liveSourceMatch) return managedSourceById(request, env, 'live_sources', liveSourceMatch[1]);
      const playlistMatch = path.match(/^\/api\/tv\/playlist\/([^/]+)$/);
      if (playlistMatch && request.method === 'GET') return tvPlaylist(request, env, playlistMatch[1]);
      if (path === '/api/live/status') return json({ success: true, data: [] });
      if (path === '/api/live/refresh-all' && request.method === 'POST') return json({ success: true, data: [] });
      if (path === '/api/settings') return settings(request, env);
      if (/^\/api\/settings\/[^/]+$/.test(path) && !path.includes('/verify-') && !path.includes('/test-')) return settings(request, env);
      if (path === '/api/settings/verify-password') return verifyPassword(request, env, 'admin_password');
      if (path === '/api/settings/verify-site-password') return verifyPassword(request, env, 'site_password');
      if (path === '/api/settings/test-tmdb') return testTmdb(request);
      if (path === '/api/settings/test-proxy') return testProxy(request);
      if (path === '/api/favorites') return favorites(request, env);
      if ((path === '/api/favorites/check' || path === '/api/videos/favorites/check') && request.method === 'GET') return favorites(request, env);
      if (path === '/api/history') return history(request, env);
      if (path === '/api/home' && request.method === 'GET') return homeData(request, env);
      if (path === '/api/home/refresh-section' && request.method === 'POST') return refreshHomeSection(request, env);
      if (path === '/api/home/refresh' && request.method === 'POST') return json({ success: true, message: 'Refresh started' });
      if (path === '/api/sources/batch-delete' && request.method === 'POST') return sourceBatch(request, env, 'delete');
      if (path === '/api/sources/batch-update' && request.method === 'POST') return sourceBatch(request, env, 'update');
      if (path === '/api/sources/batch-test' && request.method === 'POST') return sourceBatch(request, env, 'test');
      const sourceSyncMatch = path.match(/^\/api\/sources\/([^/]+)\/background-sync$/);
      if (sourceSyncMatch && request.method === 'POST') return json({ success: true, message: 'Background sync queued' });
      if (path === '/api/sources/export' && request.method === 'GET') return sourceExtras(request, env, 'export');
      if (path === '/api/sources/import' && request.method === 'POST') return sourceExtras(request, env, 'import');
      if (path === '/api/tv/sources/batch-delete' && request.method === 'POST') return managedBatch(request, env, 'tv_sources', 'delete');
      if (path === '/api/tv/sources/batch-update' && request.method === 'POST') return managedBatch(request, env, 'tv_sources', 'update');
      if (path === '/api/live/sources/batch-delete' && request.method === 'POST') return managedBatch(request, env, 'live_sources', 'delete');
      if (path === '/api/live/sources/batch-update' && request.method === 'POST') return managedBatch(request, env, 'live_sources', 'update');
      const liveRefreshMatch = path.match(/^\/api\/live\/refresh\/([^/]+)$/);
      if (liveRefreshMatch && request.method === 'POST') return json({ success: true, data: [] });
      if (path === '/api/categories') return cmsCategories(request, env);
      if (path === '/api/videos') return cmsVideos(request, env);
      if (path === '/api/videos/search') return cmsVideos(request, env);
      if (path === '/api/videos/detail') return cmsDetail(request, env);
      const videoMatch = path.match(/^\/api\/videos\/([^/]+)$/);
      if (videoMatch && request.method === 'GET') return cmsDetail(request, env, videoMatch[1]);
      const sourceMatch = path.match(/^\/api\/sources\/([^/]+)$/);
      if (sourceMatch) return sourceById(request, env, sourceMatch[1]);
      if (path === '/api/proxy' || path === '/api/proxy/hls' || path === '/api/proxy/video') return proxy(request, env);
      if (path.startsWith('/api/netdisk') || path.startsWith('/api/transcode') || path.startsWith('/api/media-servers')) {
        return json({ success: false, error: 'This deployment does not support local, WebDAV, AList, transcoding, or media-server sources.' }, 404);
      }
      if (path.startsWith('/api/')) return json({ success: false, error: 'Not implemented in Cloudflare backend' }, 404);
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('VideoX Worker is running', { status: 200 });
    } catch (error) {
      return json({ success: false, error: error?.message || 'Internal error' }, 500);
    }
  },
};

export { rows, first };
