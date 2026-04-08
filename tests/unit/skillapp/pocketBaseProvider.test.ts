/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PocketBaseProvider, extractCollectionNameFromPocketBasePath } from '../../../src/process/services/skillapp';
import { parseSkillAppManifest, isCollectionOwnedByApp } from '../../../src/process/services/skillapp/manifest';

let tempDir = '';

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-skillapp-pb-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

function createChildProcess(exitCode?: number) {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = Object.assign(emitter, {
    stdout,
    stderr,
    kill: vi.fn(),
    exitCode: exitCode ?? null,
    pid: 12345,
  });
  if (exitCode !== undefined) {
    queueMicrotask(() => emitter.emit('exit', exitCode, null));
  }
  return child;
}

function createPocketBaseSpawnProcess(overrides?: (args: string[]) => number | undefined) {
  return vi.fn((_command, args: string[]) => {
    const exitCode = overrides?.(args) ?? (args[0] === 'serve' ? undefined : 0);
    return createChildProcess(exitCode);
  });
}

async function createResolvedApp(withMigrations = false) {
  const root = path.join(tempDir, withMigrations ? 'with-migrations' : 'todo');
  await fs.mkdir(path.join(root, 'skill'), { recursive: true });
  await fs.mkdir(path.join(root, 'frontend'), { recursive: true });
  await fs.writeFile(path.join(root, 'skill', 'SKILL.md'), '# TODO\n', 'utf-8');
  await fs.writeFile(path.join(root, 'frontend', 'index.html'), '<!doctype html><title>TODO</title>', 'utf-8');
  if (withMigrations) {
    await fs.mkdir(path.join(root, 'backend', 'pocketbase', 'migrations'), { recursive: true });
  }
  const manifest = {
    id: 'todo',
    displayName: 'TODO',
    skill: { name: 'todo' },
    frontend: { entrypoint: 'frontend/index.html', directory: 'frontend' },
    backend: {
      provider: 'pocketbase',
      collectionPrefix: 'app_todo_',
      ...(withMigrations ? { migrationsDir: 'backend/pocketbase/migrations' } : {}),
    },
  };
  return parseSkillAppManifest(manifest, {
    manifestPath: path.join(root, 'skillapp.json'),
    rootDir: root,
    source: 'template',
  });
}

async function createFakeBinary(): Promise<string> {
  const binary = path.join(tempDir, 'pocketbase');
  await fs.writeFile(binary, '', 'utf-8');
  return binary;
}

describe('PocketBaseProvider path and scope helpers', () => {
  it('uses separate workspace data directories for different workspace roots', () => {
    const provider = new PocketBaseProvider({ cacheDir: tempDir });
    const first = provider.resolveWorkspaceDataDir('/workspace/a');
    const second = provider.resolveWorkspaceDataDir('/workspace/b');

    expect(first).not.toBe(second);
    expect(first).toContain(path.join('skillapps', 'pocketbase-workspaces'));
  });

  it('extracts and validates app-owned collection names', () => {
    expect(extractCollectionNameFromPocketBasePath('/api/collections/app_todo_todos/records')).toBe('app_todo_todos');
    expect(isCollectionOwnedByApp('app_todo_todos', 'app_todo_')).toBe(true);
    expect(isCollectionOwnedByApp('app_other_todos', 'app_todo_')).toBe(false);
  });
});

describe('PocketBaseProvider sessions', () => {
  it('reuses one workspace PocketBase process for repeated starts in the same workspace', async () => {
    const app = await createResolvedApp();
    const binary = await createFakeBinary();
    const spawnProcess = createPocketBaseSpawnProcess();
    const provider = new PocketBaseProvider({
      binaryPath: binary,
      cacheDir: tempDir,
      spawnProcess,
      findFreePort: async () => 34567,
      waitForPort: async () => {},
    });

    const first = await provider.startApp(app, '/workspace/a');
    const second = await provider.startApp(app, '/workspace/a');

    expect(first.port).toBe(34567);
    expect(second.port).toBe(34567);
    expect(first.url).toContain('/apps/todo/');
    expect(first.url).toContain('#appId=todo');
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(spawnProcess.mock.calls[0]?.[1]).toEqual([
      'superuser',
      'upsert',
      expect.stringMatching(/^skillapp-[a-f0-9]+@aionui\.local$/),
      expect.any(String),
      '--dir',
      expect.stringContaining(path.join('skillapps', 'pocketbase-workspaces')),
    ]);
  });

  it('extracts a local PocketBase zip archive when no binary is configured', async () => {
    const app = await createResolvedApp();
    const archivePath = path.join(tempDir, 'pocketbase_0.36.8_darwin_arm64.zip');
    await fs.writeFile(archivePath, 'fake-archive', 'utf-8');
    const extractArchive = vi.fn(async (_zipPath: string, outputDir: string) => {
      await fs.writeFile(path.join(outputDir, 'pocketbase'), '', 'utf-8');
    });
    const spawnProcess = createPocketBaseSpawnProcess();
    const provider = new PocketBaseProvider({
      archivePath,
      cacheDir: tempDir,
      extractArchive,
      spawnProcess,
      findFreePort: async () => 34567,
      waitForPort: async () => {},
    });

    const result = await provider.startApp(app, '/workspace/a');

    expect(result.port).toBe(34567);
    expect(extractArchive).toHaveBeenCalledWith(
      archivePath,
      expect.stringContaining(path.join('skillapps', 'pocketbase-bin'))
    );
    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });

  it('fails closed when a migration command fails', async () => {
    const app = await createResolvedApp(true);
    const binary = await createFakeBinary();
    const provider = new PocketBaseProvider({
      binaryPath: binary,
      cacheDir: tempDir,
      spawnProcess: createPocketBaseSpawnProcess((args) => {
        if (args[0] === 'migrate') return 1;
        return args[0] === 'serve' ? undefined : 0;
      }),
      findFreePort: async () => 34567,
      waitForPort: async () => {},
    });

    await expect(provider.startApp(app, '/workspace/a')).rejects.toThrow(/PocketBase command failed/);
  });
});
