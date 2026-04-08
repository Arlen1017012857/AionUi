#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!command || flags.help) {
    printUsage();
    process.exit(flags.help ? 0 : 1);
  }

  const session = readSession(flags.session);

  switch (command) {
    case 'list': {
      const result = await request(session, `/api/collections/${session.todosCollection}/records?perPage=100`);
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const items = Array.isArray(result.items) ? result.items : [];
      if (items.length === 0) {
        console.log('No TODO items.');
        return;
      }
      for (const item of items) {
        console.log(`${item.id}\t${item.status}\t${item.title}${item.notes ? `\t${item.notes}` : ''}`);
      }
      return;
    }

    case 'create': {
      requireFlag(flags, 'title');
      const record = await request(session, `/api/collections/${session.todosCollection}/records`, {
        method: 'POST',
        body: {
          title: flags.title,
          status: flags.status || 'todo',
          notes: flags.notes || '',
        },
      });
      await emitSkillAppEvent(session, 'STATE_DELTA', {
        action: 'todo.created',
        origin: 'agent',
        record,
      });
      console.log(JSON.stringify(record, null, 2));
      return;
    }

    case 'update': {
      const record = await resolveRecord(session, flags);
      const patch = {};
      if (flags.title) patch.title = flags.title;
      if (flags.status) patch.status = flags.status;
      if (flags.notes !== undefined) patch.notes = flags.notes;
      if (Object.keys(patch).length === 0) {
        throw new Error('update requires at least one of --title, --status, or --notes');
      }
      const updated = await request(session, `/api/collections/${session.todosCollection}/records/${record.id}`, {
        method: 'PATCH',
        body: patch,
      });
      await emitSkillAppEvent(session, 'STATE_DELTA', {
        action: 'todo.updated',
        origin: 'agent',
        record: updated,
      });
      console.log(JSON.stringify(updated, null, 2));
      return;
    }

    case 'complete': {
      const record = await resolveRecord(session, flags);
      const updated = await request(session, `/api/collections/${session.todosCollection}/records/${record.id}`, {
        method: 'PATCH',
        body: { status: 'done' },
      });
      await emitSkillAppEvent(session, 'STATE_DELTA', {
        action: 'todo.completed',
        origin: 'agent',
        record: updated,
      });
      console.log(JSON.stringify(updated, null, 2));
      return;
    }

    case 'delete': {
      const record = await resolveRecord(session, flags);
      await request(session, `/api/collections/${session.todosCollection}/records/${record.id}`, { method: 'DELETE' });
      await emitSkillAppEvent(session, 'STATE_DELTA', {
        action: 'todo.deleted',
        origin: 'agent',
        record,
      });
      console.log(JSON.stringify({ deleted: true, id: record.id, title: record.title }, null, 2));
      return;
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return { command, flags };
}

function printUsage() {
  console.log(`Usage:
  node .claude/skills/todo/scripts/todoctl.js list [--json]
  node .claude/skills/todo/scripts/todoctl.js create --title "Task" [--status todo|in_progress|done] [--notes "Notes"]
  node .claude/skills/todo/scripts/todoctl.js update --id <id> [--title "Task"] [--status done] [--notes "Notes"]
  node .claude/skills/todo/scripts/todoctl.js complete --id <id>
  node .claude/skills/todo/scripts/todoctl.js delete --id <id>

Optional:
  --match "title substring"   Resolve the target record by a unique title substring
  --session /abs/path/session.json
  --help`);
}

function readSession(explicitPath) {
  const sessionPath = explicitPath ? path.resolve(explicitPath) : findSessionFile(process.cwd());
  if (!sessionPath) {
    throw new Error('TODO SkillApp session file not found. Expected .aionui/skillapps/todo/session.json');
  }
  const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  if (!session.apiBase || !session.token || !session.todosCollection) {
    throw new Error(`Invalid TODO session file: ${sessionPath}`);
  }
  return session;
}

function findSessionFile(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, '.aionui', 'skillapps', 'todo', 'session.json');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function requireFlag(flags, key) {
  if (!flags[key]) {
    throw new Error(`Missing required flag: --${key}`);
  }
}

async function resolveRecord(session, flags) {
  if (flags.id) {
    const result = await request(session, `/api/collections/${session.todosCollection}/records/${flags.id}`);
    return result;
  }

  if (!flags.match) {
    throw new Error('Expected --id or --match to identify the TODO item');
  }

  const result = await request(session, `/api/collections/${session.todosCollection}/records?perPage=100`);
  const items = Array.isArray(result.items) ? result.items : [];
  const needle = String(flags.match).toLowerCase();
  const matches = items.filter((item) =>
    String(item.title || '')
      .toLowerCase()
      .includes(needle)
  );
  if (matches.length === 0) {
    throw new Error(`No TODO item matched "${flags.match}"`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple TODO items matched "${flags.match}". Use --id instead.`);
  }
  return matches[0];
}

async function request(session, apiPath, options = {}) {
  const headers = {
    'X-SkillApp-Token': session.token,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
  };
  const response = await fetch(new URL(stripLeadingSlash(apiPath), withTrailingSlash(session.apiBase)).toString(), {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${text || response.statusText}`);
  }

  return text ? JSON.parse(text) : null;
}

async function emitSkillAppEvent(session, type, payload) {
  if (!session.eventBase || !session.token) {
    return;
  }

  try {
    await fetch(session.eventBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SkillApp-Token': session.token,
      },
      body: JSON.stringify({
        appId: session.appId || 'todo',
        conversationId: session.conversationId,
        type,
        policy: 'state-only',
        payload,
      }),
    });
  } catch {
    // The TODO write already succeeded. Event delivery is best-effort for UI refresh.
  }
}

function stripLeadingSlash(value) {
  return value.startsWith('/') ? value.slice(1) : value;
}

function withTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
