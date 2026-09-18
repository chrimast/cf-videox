import test from 'node:test';
import assert from 'node:assert/strict';
import { pickDatabase, patchToml, resolveDatabaseId, main } from './resolve-d1-id.mjs';

const databases = [
  { name: 'other', uuid: '11111111-1111-1111-1111-111111111111' },
  { name: 'videox', uuid: '8fd98930-58f7-42a8-980e-75a788b307f5' },
];

test('picks D1 database by name', () => {
  const picked = pickDatabase(databases, { name: 'videox' });
  assert.equal(picked.uuid, '8fd98930-58f7-42a8-980e-75a788b307f5');
  assert.equal(picked.name, 'videox');
});

test('uses explicit ID when it exists in the account', () => {
  const picked = pickDatabase(databases, {
    name: 'videox',
    explicitId: '11111111-1111-1111-1111-111111111111',
  });
  assert.equal(picked.uuid, '11111111-1111-1111-1111-111111111111');
});

test('throws when explicit ID is stale', () => {
  assert.throws(
    () => pickDatabase(databases, {
      name: 'videox',
      explicitId: '00000000-0000-0000-0000-000000000000',
    }),
    /D1 database id '00000000-0000-0000-0000-000000000000' was not found/,
  );
});

test('throws when the named database is missing', () => {
  assert.throws(
    () => pickDatabase(databases, { name: 'missing' }),
    /D1 database 'missing' was not found/,
  );
});

test('patches database_id without changing other fields', () => {
  const toml = `name = "cf-videox"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "videox"\ndatabase_id = "00000000-0000-0000-0000-000000000000"\n`;
  const next = patchToml(toml, '8fd98930-58f7-42a8-980e-75a788b307f5');
  assert.match(next, /database_id = "8fd98930-58f7-42a8-980e-75a788b307f5"/);
  assert.match(next, /database_name = "videox"/);
  assert.match(next, /binding = "DB"/);
});

test('resolveDatabaseId prefers live name lookup over committed UUID', async () => {
  const id = await resolveDatabaseId({
    name: 'videox',
    committedId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    listDatabases: async () => [
      { name: 'videox', uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
    ],
  });
  assert.equal(id, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
});

test('main writes the live videox UUID into wrangler files', async () => {
  const files = {
    'wrangler.toml': 'database_id = "00000000-0000-0000-0000-000000000000"\n',
    'worker/wrangler.toml': 'database_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"\n',
  };
  const fs = {
    readFile: async (path) => files[path],
    writeFile: async (path, content) => { files[path] = content; },
  };
  const id = await main(['wrangler.toml', 'worker/wrangler.toml'], {
    fs,
    listDatabases: async () => databases,
  });
  assert.equal(id, '8fd98930-58f7-42a8-980e-75a788b307f5');
  assert.match(files['wrangler.toml'], /8fd98930-58f7-42a8-980e-75a788b307f5/);
  assert.match(files['worker/wrangler.toml'], /8fd98930-58f7-42a8-980e-75a788b307f5/);
});
