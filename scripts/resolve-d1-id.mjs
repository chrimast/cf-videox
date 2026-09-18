export function pickDatabase(databases, { name, explicitId } = {}) {
  const list = Array.isArray(databases) ? databases : [];
  if (explicitId) {
    const byId = list.find((item) => (item.uuid || item.id) === explicitId);
    if (byId) return { name: byId.name, uuid: byId.uuid || byId.id };
    throw new Error(`D1 database id '${explicitId}' was not found`);
  }
  const byName = list.find((item) => item.name === name);
  if (!byName) {
    throw new Error(`D1 database '${name}' was not found. Create it first, then redeploy.`);
  }
  return { name: byName.name, uuid: byName.uuid || byName.id };
}

export function patchToml(content, databaseId) {
  if (!/database_id\s*=\s*"[^"]*"/.test(content)) {
    throw new Error('wrangler.toml is missing database_id');
  }
  return content.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${databaseId}"`);
}

export async function resolveDatabaseId({
  name,
  committedId,
  explicitId,
  listDatabases,
} = {}) {
  const databases = await listDatabases();
  if (explicitId) return pickDatabase(databases, { name, explicitId }).uuid;
  const byName = databases.find((item) => item.name === name);
  if (byName) return byName.uuid || byName.id;
  if (committedId) {
    const byId = databases.find((item) => (item.uuid || item.id) === committedId);
    if (byId) return byId.uuid || byId.id;
  }
  throw new Error(`D1 database '${name}' was not found. Create it first, then redeploy.`);
}

function readEnv(name) {
  return String(process.env[name] || '').trim();
}

async function listCloudflareD1({ accountId, token }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const message = payload.errors?.[0]?.message || `Cloudflare D1 list failed (${response.status})`;
    throw new Error(message);
  }
  return payload.result || [];
}

async function listWranglerD1(run) {
  const output = await run();
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : parsed.result || [];
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const files = argv.length ? argv : ['wrangler.toml', 'worker/wrangler.toml'];
  const fs = io.fs || await import('node:fs/promises');
  const name = readEnv('D1_DATABASE_NAME') || 'videox';
  const explicitId = readEnv('D1_DATABASE_ID');
  const accountId = readEnv('CLOUDFLARE_ACCOUNT_ID');
  const token = readEnv('CLOUDFLARE_API_TOKEN');
  const listDatabases = io.listDatabases || (token && accountId
    ? () => listCloudflareD1({ accountId, token })
    : () => listWranglerD1(io.run || (async () => {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync('npx', ['--yes', 'wrangler@4', 'd1', 'list', '--json'], {
        env: process.env,
      });
      return stdout;
    })));
  const first = await fs.readFile(files[0], 'utf8');
  const committed = first.match(/database_id\s*=\s*"([^"]*)"/)?.[1] || '';
  const databaseId = await resolveDatabaseId({
    name,
    committedId: committed,
    explicitId,
    listDatabases,
  });
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, patchToml(content, databaseId));
  }
  console.log(`Resolved D1 ${name} -> ${databaseId}`);
  return databaseId;
}

const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
