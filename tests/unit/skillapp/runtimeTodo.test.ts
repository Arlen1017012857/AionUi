/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { previewOpenMock, statusEmitMock } = vi.hoisted(() => ({
  previewOpenMock: vi.fn(),
  statusEmitMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    preview: {
      open: { emit: previewOpenMock },
    },
    skillApp: {
      status: { emit: statusEmitMock },
    },
  },
}));

let tempDir = '';

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-skillapp-runtime-'));
  previewOpenMock.mockClear();
  statusEmitMock.mockClear();
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
  vi.useRealTimers();
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

function createPocketBaseSpawnMock() {
  return vi.fn((_command, args: string[]) => createChildProcess(args[0] === 'serve' ? undefined : 0));
}

async function createFakeBinary(): Promise<string> {
  const binary = path.join(tempDir, 'pocketbase');
  await fs.writeFile(binary, '', 'utf-8');
  return binary;
}

describe('TODO SkillApp runtime vertical slice', () => {
  it('opens the TODO preview when the todo skill is loaded', async () => {
    const { SkillAppRegistry, PocketBaseProvider, SkillAppRuntime } =
      await import('../../../src/process/services/skillapp');
    const binary = await createFakeBinary();
    const spawnProcess = createPocketBaseSpawnMock();
    const syncManagedSkillProjection = vi.fn(async () => {});
    const registry = new SkillAppRegistry({
      templateRoots: [path.resolve('src/process/resources/skillapp-templates')],
      managedRoot: path.join(tempDir, 'managed'),
    });
    const provider = new PocketBaseProvider({
      binaryPath: binary,
      cacheDir: tempDir,
      spawnProcess,
      findFreePort: async () => 45678,
      waitForPort: async () => {},
    });
    const runtime = new SkillAppRuntime(registry, provider, {
      resolveWebBaseUrl: async () => 'http://127.0.0.1:25809',
      syncManagedSkillProjection,
      watchBundleRoot: () => ({ close: vi.fn() }),
    });

    await runtime.handleSkillLoaded({
      skillName: 'todo',
      conversationId: 'conv-1',
      workspace: tempDir,
    });

    const sessionFile = path.join(tempDir, '.aionui', 'skillapps', 'todo', 'session.json');
    const managedBundleRoot = path.join(tempDir, 'managed', 'todo');
    expect(previewOpenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('/apps/todo/'),
        contentType: 'url',
        metadata: expect.objectContaining({ skillAppId: 'todo', conversationId: 'conv-1' }),
      })
    );
    expect(fsSync.existsSync(sessionFile)).toBe(true);
    expect(fsSync.existsSync(path.join(managedBundleRoot, 'skill', 'SKILL.md'))).toBe(true);
    expect(syncManagedSkillProjection).toHaveBeenCalledWith('todo', path.join(managedBundleRoot, 'skill'));
    expect(runtime.getAgentContext({ conversationId: 'conv-1', workspace: tempDir })).toContain(
      `Bundle root: ${managedBundleRoot}`
    );
    expect(spawnProcess).toHaveBeenCalledTimes(3);
    expect(fsSync.existsSync(path.join(tempDir, 'skillapps', 'pocketbase-workspaces'))).toBe(true);
    const session = JSON.parse(await fs.readFile(sessionFile, 'utf-8')) as Record<string, string>;
    expect(session.bundleRoot).toBe(managedBundleRoot);
    expect(session.skillRoot).toBe(path.join(managedBundleRoot, 'skill'));
    expect(session.frontendRoot).toBe(path.join(managedBundleRoot, 'frontend'));
    expect(session.helperScript).toBe(path.join(managedBundleRoot, 'skill', 'scripts', 'todoctl.js'));
  });

  it('returns context-aware runtime status snapshots for the workspace panel', async () => {
    const { SkillAppRegistry, PocketBaseProvider, SkillAppRuntime } =
      await import('../../../src/process/services/skillapp');
    const binary = await createFakeBinary();
    const spawnProcess = createPocketBaseSpawnMock();
    const registry = new SkillAppRegistry({
      templateRoots: [path.resolve('src/process/resources/skillapp-templates')],
      managedRoot: path.join(tempDir, 'managed'),
    });
    const provider = new PocketBaseProvider({
      binaryPath: binary,
      cacheDir: tempDir,
      spawnProcess,
      findFreePort: async () => 45678,
      waitForPort: async () => {},
    });
    const runtime = new SkillAppRuntime(registry, provider, {
      resolveWebBaseUrl: async () => 'http://127.0.0.1:25809',
      syncManagedSkillProjection: async () => {},
      watchBundleRoot: () => ({ close: vi.fn() }),
    });

    await runtime.handleSkillLoaded({
      skillName: 'todo',
      conversationId: 'conv-1',
      workspace: tempDir,
    });

    await expect(
      runtime.listApps({
        workspace: tempDir,
        conversationId: 'conv-1',
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'todo',
        runtimeStatus: expect.objectContaining({
          state: 'ready',
          visible: true,
          workspace: tempDir,
          conversationId: 'conv-1',
        }),
      }),
    ]);

    runtime.markVisibility({
      appId: 'todo',
      workspace: tempDir,
      conversationId: 'conv-1',
      visible: false,
    });

    await expect(
      runtime.listApps({
        workspace: tempDir,
        conversationId: 'conv-1',
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'todo',
        runtimeStatus: expect.objectContaining({
          state: 'ready',
          visible: false,
          workspace: tempDir,
          conversationId: 'conv-1',
        }),
      }),
    ]);

    runtime.stopApp('todo', tempDir, 'conv-1');

    await expect(
      runtime.listApps({
        workspace: tempDir,
        conversationId: 'conv-1',
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'todo',
        runtimeStatus: expect.objectContaining({
          state: 'stopped',
          workspace: tempDir,
          conversationId: 'conv-1',
          visible: false,
        }),
      }),
    ]);
  });

  it('does not open a preview for skills without a SkillApp association', async () => {
    const { SkillAppRegistry, PocketBaseProvider, SkillAppRuntime } =
      await import('../../../src/process/services/skillapp');
    const registry = new SkillAppRegistry({
      templateRoots: [path.resolve('src/process/resources/skillapp-templates')],
      managedRoot: path.join(tempDir, 'managed'),
    });
    const runtime = new SkillAppRuntime(registry, new PocketBaseProvider({ cacheDir: tempDir }), {
      resolveWebBaseUrl: async () => 'http://127.0.0.1:25809',
      syncManagedSkillProjection: async () => {},
      watchBundleRoot: () => ({ close: vi.fn() }),
    });

    await runtime.handleSkillLoaded({
      skillName: 'not-todo',
      conversationId: 'conv-1',
      workspace: '/workspace/a',
    });

    expect(previewOpenMock).not.toHaveBeenCalled();
  });

  it('broadcasts matching SkillApp events to active subscribers', async () => {
    const { SkillAppRegistry, PocketBaseProvider, SkillAppRuntime } =
      await import('../../../src/process/services/skillapp');
    const registry = new SkillAppRegistry({
      templateRoots: [path.resolve('src/process/resources/skillapp-templates')],
      managedRoot: path.join(tempDir, 'managed'),
    });
    const runtime = new SkillAppRuntime(registry, new PocketBaseProvider({ cacheDir: tempDir }), {
      resolveWebBaseUrl: async () => 'http://127.0.0.1:25809',
      syncManagedSkillProjection: async () => {},
      watchBundleRoot: () => ({ close: vi.fn() }),
    });
    const listener = vi.fn();
    const unsubscribe = runtime.subscribeToEvents(
      { appId: 'todo', conversationId: 'conv-1', workspace: tempDir },
      listener
    );

    await runtime.emitEvent({
      appId: 'todo',
      conversationId: 'conv-1',
      workspace: tempDir,
      type: 'STATE_DELTA',
      payload: { action: 'todo.updated', origin: 'agent' },
      summary: 'Agent updated TODO',
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'todo',
        conversationId: 'conv-1',
        workspace: tempDir,
        type: 'STATE_DELTA',
      })
    );

    unsubscribe();

    await runtime.emitEvent({
      appId: 'todo',
      conversationId: 'conv-1',
      workspace: tempDir,
      type: 'STATE_DELTA',
      payload: { action: 'todo.updated', origin: 'agent' },
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('resolves the managed bundle root for starter SkillApps', async () => {
    const { SkillAppRegistry, PocketBaseProvider, SkillAppRuntime } =
      await import('../../../src/process/services/skillapp');
    const syncManagedSkillProjection = vi.fn(async () => {});
    const registry = new SkillAppRegistry({
      templateRoots: [path.resolve('src/process/resources/skillapp-templates')],
      managedRoot: path.join(tempDir, 'managed'),
    });
    const runtime = new SkillAppRuntime(registry, new PocketBaseProvider({ cacheDir: tempDir }), {
      resolveWebBaseUrl: async () => 'http://127.0.0.1:25809',
      syncManagedSkillProjection,
      watchBundleRoot: () => ({ close: vi.fn() }),
    });

    const result = await runtime.resolveBundle({ appId: 'todo' });

    expect(result).toEqual({
      success: true,
      appId: 'todo',
      bundleRoot: path.join(tempDir, 'managed', 'todo'),
    });
    expect(syncManagedSkillProjection).toHaveBeenCalledWith('todo', path.join(tempDir, 'managed', 'todo', 'skill'));
    expect(fsSync.existsSync(path.join(tempDir, 'managed', 'todo', 'skill', 'SKILL.md'))).toBe(true);
  });

  it('hot reloads visible managed SkillApps when the managed bundle changes', async () => {
    const { SkillAppRegistry, PocketBaseProvider, SkillAppRuntime } =
      await import('../../../src/process/services/skillapp');
    const binary = await createFakeBinary();
    const spawnProcess = createPocketBaseSpawnMock();
    const syncManagedSkillProjection = vi.fn(async () => {});
    const stopAppSpy = vi.fn();
    let bundleListener: ((eventType: string, filename?: string | Buffer | null) => void) | undefined;
    const registry = new SkillAppRegistry({
      templateRoots: [path.resolve('src/process/resources/skillapp-templates')],
      managedRoot: path.join(tempDir, 'managed'),
    });
    const provider = new PocketBaseProvider({
      binaryPath: binary,
      cacheDir: tempDir,
      spawnProcess,
      findFreePort: async () => 45678,
      waitForPort: async () => {},
    });
    const originalStopApp = provider.stopApp.bind(provider);
    vi.spyOn(provider, 'stopApp').mockImplementation((appId, workspace) => {
      stopAppSpy(appId, workspace);
      originalStopApp(appId, workspace);
    });

    const runtime = new SkillAppRuntime(registry, provider, {
      resolveWebBaseUrl: async () => 'http://127.0.0.1:25809',
      syncManagedSkillProjection,
      watchBundleRoot: (_rootDir, listener) => {
        bundleListener = listener;
        return { close: vi.fn() };
      },
      bundleReloadDebounceMs: 25,
    });

    await runtime.handleSkillLoaded({
      skillName: 'todo',
      conversationId: 'conv-1',
      workspace: tempDir,
    });

    expect(previewOpenMock).toHaveBeenCalledTimes(1);
    expect(bundleListener).toBeTypeOf('function');

    await (runtime as { reloadManagedBundleSessions: (appId: string) => Promise<void> }).reloadManagedBundleSessions(
      'todo'
    );

    expect(stopAppSpy).toHaveBeenCalledWith('todo', tempDir);
    expect(previewOpenMock).toHaveBeenCalledTimes(2);
    expect(syncManagedSkillProjection).toHaveBeenCalledTimes(2);
    expect(runtime.getAgentContext({ conversationId: 'conv-1', workspace: tempDir })).toContain(
      `Bundle root: ${path.join(tempDir, 'managed', 'todo')}`
    );

    provider.stopAll();
  });
});
