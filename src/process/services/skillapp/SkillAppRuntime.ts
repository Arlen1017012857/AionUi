/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { ipcBridge } from '@/common';
import type {
  SkillAppAguiEvent,
  SkillAppEventInput,
  SkillAppInfo,
  SkillAppListRequest,
  SkillAppOpenRequest,
  SkillAppOpenResult,
  SkillAppResolveBundleRequest,
  SkillAppResolveBundleResult,
  SkillAppRuntimeStatus,
  SkillAppVisibilityRequest,
} from '@/common/types/skillapp';
import { syncManagedSkillAppProjection } from '@process/utils/initStorage';
import { SERVER_CONFIG } from '@process/webserver/config/constants';
import type { IWorkerTaskManager } from '@process/task/IWorkerTaskManager';
import { agentEventRouter } from './AgentEventRouter';
import { pocketBaseProvider, type PocketBaseAppSession, type PocketBaseProvider } from './PocketBaseProvider';
import { SkillAppRegistry } from './SkillAppRegistry';
import type { ResolvedSkillApp } from './manifest';

type SkillAppRuntimeOptions = {
  resolveWebBaseUrl?: () => Promise<string>;
  syncManagedSkillProjection?: (skillName: string, skillDirectory: string) => Promise<void>;
  watchBundleRoot?: (
    rootDir: string,
    listener: (eventType: string, filename?: string | Buffer | null) => void
  ) => { close: () => void };
  bundleReloadDebounceMs?: number;
};

type SkillAppRuntimeSession = {
  app: ResolvedSkillApp;
  pocketBaseSession: PocketBaseAppSession;
  conversationId?: string;
  workspace?: string;
  visible: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
};

type SkillAppEventSubscription = {
  appId: string;
  conversationId?: string;
  workspace?: string;
  listener: (event: SkillAppAguiEvent) => void;
};

type SkillAppBundleWatcher = {
  appId: string;
  rootDir: string;
  watcher: { close: () => void };
  debounceTimer?: ReturnType<typeof setTimeout>;
  sessionKeys: Set<string>;
};

const DEFAULT_BUNDLE_RELOAD_DEBOUNCE_MS = 500;

export class SkillAppRuntime {
  private readonly registry: SkillAppRegistry;
  private readonly pocketBaseProvider: PocketBaseProvider;
  private readonly options: SkillAppRuntimeOptions;
  private readonly sessions = new Map<string, SkillAppRuntimeSession>();
  private readonly eventSubscriptions = new Set<SkillAppEventSubscription>();
  private readonly statusSnapshots = new Map<string, SkillAppRuntimeStatus>();
  private readonly bundleWatchers = new Map<string, SkillAppBundleWatcher>();
  private initialized = false;

  constructor(registry = new SkillAppRegistry(), provider = pocketBaseProvider, options: SkillAppRuntimeOptions = {}) {
    this.registry = registry;
    this.pocketBaseProvider = provider;
    this.options = options;
  }

  setWorkerTaskManager(workerTaskManager: IWorkerTaskManager): void {
    agentEventRouter.setWorkerTaskManager(workerTaskManager);
  }

  async listApps(request: SkillAppListRequest = {}): Promise<SkillAppInfo[]> {
    await this.ensureInitialized();
    return this.registry.list().map((app) => ({
      id: app.id,
      displayName: app.displayName,
      description: app.description,
      skillName: app.skillName,
      backendProvider: app.backendProvider,
      previewTitle: app.previewTitle,
      openOnLoad: app.openOnLoad,
      runtimeStatus: this.getRuntimeStatusSnapshot(app.id, request),
    }));
  }

  async resolveBundle(request: SkillAppResolveBundleRequest): Promise<SkillAppResolveBundleResult> {
    await this.ensureInitialized();
    try {
      const app = (await this.registry.ensureProvisionedApp(request.appId)) ?? this.registry.getById(request.appId);
      if (!app) {
        return { success: false, appId: request.appId, msg: 'SkillApp not found' };
      }

      if (app.source === 'managed') {
        await (this.options.syncManagedSkillProjection ?? syncManagedSkillAppProjection)(
          app.skillName,
          app.skillDirectory
        );
      }

      return {
        success: true,
        appId: app.id,
        bundleRoot: app.rootDir,
      };
    } catch (error) {
      return {
        success: false,
        appId: request.appId,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async openApp(request: SkillAppOpenRequest): Promise<SkillAppOpenResult> {
    await this.ensureInitialized();
    try {
      const app = (await this.registry.ensureProvisionedApp(request.appId)) ?? this.registry.getById(request.appId);
      if (!app) {
        return { success: false, appId: request.appId, msg: 'SkillApp not found' };
      }

      if (app.source === 'managed') {
        await (this.options.syncManagedSkillProjection ?? syncManagedSkillAppProjection)(
          app.skillName,
          app.skillDirectory
        );
      }
      const session = await this.ensureStarted(app, {
        conversationId: request.conversationId,
        workspace: request.workspace,
        visible: true,
      });
      ipcBridge.preview.open.emit({
        content: session.pocketBaseSession.url,
        contentType: 'url',
        metadata: {
          title: app.previewTitle,
          fileName: app.displayName,
          skillAppId: app.id,
          conversationId: request.conversationId,
          workspace: session.workspace,
        },
      });
      return { success: true, appId: app.id, url: session.pocketBaseSession.url };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const app = this.registry.getById(request.appId);
      this.emitStatus({
        appId: request.appId,
        state: 'error',
        message,
        workspace: request.workspace,
        conversationId: request.conversationId,
        updatedAt: Date.now(),
      });
      if (app) {
        this.openStartupErrorPreview(app, message);
      }
      return { success: false, appId: request.appId, msg: message };
    }
  }

  stopApp(appId: string, workspace?: string, conversationId?: string): void {
    for (const [key, session] of this.sessions) {
      if (session.app.id !== appId) continue;
      if (workspace && session.workspace && session.workspace !== workspace) continue;
      if (conversationId && session.conversationId !== conversationId) continue;
      if (session.idleTimer) clearTimeout(session.idleTimer);
      this.pocketBaseProvider.stopApp(appId, session.workspace);
      void this.removeAgentSessionFile(session.workspace, appId);
      this.sessions.delete(key);
      this.unregisterBundleWatcherSession(appId, key);
      this.emitStatus({
        appId,
        state: 'stopped',
        workspace: session.workspace,
        conversationId: session.conversationId,
        visible: false,
        updatedAt: Date.now(),
      });
    }
  }

  markVisibility(request: SkillAppVisibilityRequest): void {
    for (const session of this.sessions.values()) {
      if (session.app.id !== request.appId) continue;
      if (request.workspace && session.workspace && session.workspace !== request.workspace) continue;
      if (request.conversationId && session.conversationId !== request.conversationId) continue;
      session.visible = request.visible;
      if (session.idleTimer) {
        clearTimeout(session.idleTimer);
        session.idleTimer = undefined;
      }
      if (!request.visible) {
        session.idleTimer = setTimeout(() => {
          this.stopApp(session.app.id, session.workspace, session.conversationId);
        }, session.app.idleTimeoutMs);
      }
      this.emitStatus({
        appId: session.app.id,
        state: 'ready',
        workspace: session.workspace,
        conversationId: session.conversationId,
        visible: request.visible,
        url: session.pocketBaseSession.url,
        updatedAt: Date.now(),
      });
    }
  }

  async handleSkillLoaded(input: { skillName: string; conversationId?: string; workspace?: string }): Promise<void> {
    await this.ensureInitialized();
    const app = this.registry.findBySkillName(input.skillName);
    if (!app || !app.openOnLoad) return;
    await this.openApp({
      appId: app.id,
      conversationId: input.conversationId,
      workspace: input.workspace,
    });
  }

  async emitEvent(input: SkillAppEventInput): Promise<void> {
    await this.ensureInitialized();
    const app = this.registry.getById(input.appId);
    const event = await agentEventRouter.route(input, app?.defaultEventPolicy ?? 'state-only');
    this.broadcastEvent(event);
  }

  subscribeToEvents(
    input: { appId: string; conversationId?: string; workspace?: string },
    listener: (event: SkillAppAguiEvent) => void
  ): () => void {
    const subscription: SkillAppEventSubscription = { ...input, listener };
    this.eventSubscriptions.add(subscription);
    return () => {
      this.eventSubscriptions.delete(subscription);
    };
  }

  getAgentContext(input: { conversationId?: string; workspace?: string }): string {
    const lines: string[] = [];
    for (const session of this.sessions.values()) {
      if (input.conversationId && session.conversationId && session.conversationId !== input.conversationId) continue;
      if (input.workspace && session.workspace && session.workspace !== input.workspace) continue;

      const sessionFile = this.getAgentSessionFilePath(session.workspace, session.app.id);
      const helperScript = this.resolveHelperScript(session.workspace, session.app);
      lines.push(`Active SkillApp: ${session.app.previewTitle} (${session.app.id})`);
      lines.push(`Session file: ${sessionFile}`);
      lines.push(`Bundle root: ${session.app.rootDir}`);
      lines.push(`Skill source root: ${session.app.skillDirectory}`);
      lines.push(`Frontend root: ${session.app.frontendDirectory}`);
      const backendRoot = this.resolveBackendRoot(session.app);
      if (backendRoot) {
        lines.push(`Backend root: ${backendRoot}`);
      }
      if (helperScript) {
        lines.push(`Helper script: ${helperScript}`);
        lines.push(
          `Use \`node ${helperScript} list --json\` to inspect current items, and \`create\`, \`update\`, \`complete\`, or \`delete\` to modify them.`
        );
      }
      lines.push('Modify SkillApp source files under the bundle root when changing the app.');
      lines.push('Do not edit .claude/.gemini/.codex skills projections directly; they are runtime views only.');
      lines.push('Do not search for TODO.md or other workspace files when a SkillApp session file is available.');
    }
    return lines.join('\n');
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.registry.discover();
    this.initialized = true;
  }

  private async ensureStarted(
    app: ResolvedSkillApp,
    input: { conversationId?: string; workspace?: string; visible: boolean }
  ): Promise<SkillAppRuntimeSession> {
    const sessionKey = `${app.id}:${input.workspace || 'default'}:${input.conversationId || 'global'}`;
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      existing.visible = input.visible;
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = undefined;
      }
      this.ensureBundleWatcher(sessionKey, existing.app);
      this.emitStatus({
        appId: app.id,
        state: 'ready',
        workspace: existing.workspace,
        conversationId: existing.conversationId,
        visible: existing.visible,
        url: existing.pocketBaseSession.url,
        updatedAt: Date.now(),
      });
      return existing;
    }

    this.emitStatus({
      appId: app.id,
      state: 'starting',
      workspace: input.workspace,
      conversationId: input.conversationId,
      visible: input.visible,
      updatedAt: Date.now(),
    });

    const webBaseUrl = await this.resolveWebBaseUrl();
    const apiBaseUrl = `${webBaseUrl}/api/skillapps/${app.id}/pb`;
    const eventBaseUrl = `${webBaseUrl}/api/skillapps/${app.id}/events`;
    const pocketBaseSession = await this.pocketBaseProvider.startApp(app, input.workspace, {
      conversationId: input.conversationId,
      apiBaseUrl,
      eventBaseUrl,
    });
    const session: SkillAppRuntimeSession = {
      app,
      pocketBaseSession,
      conversationId: input.conversationId,
      workspace: pocketBaseSession.workspace,
      visible: input.visible,
    };
    await this.writeAgentSessionFile(session);
    this.sessions.set(sessionKey, session);
    this.ensureBundleWatcher(sessionKey, app);
    this.emitStatus({
      appId: app.id,
      state: 'ready',
      workspace: pocketBaseSession.workspace,
      conversationId: input.conversationId,
      visible: input.visible,
      url: pocketBaseSession.url,
      updatedAt: Date.now(),
    });
    return session;
  }

  private emitStatus(status: SkillAppRuntimeStatus): void {
    this.statusSnapshots.set(this.getRuntimeScopeKey(status.appId, status.workspace, status.conversationId), status);
    ipcBridge.skillApp.status.emit(status);
  }

  private getRuntimeStatusSnapshot(appId: string, request: SkillAppListRequest): SkillAppRuntimeStatus | null {
    const snapshot =
      this.statusSnapshots.get(this.getRuntimeScopeKey(appId, request.workspace, request.conversationId)) ?? null;
    if (snapshot) {
      return snapshot;
    }

    const session = Array.from(this.sessions.values()).find((item) => {
      if (item.app.id !== appId) return false;
      if (request.workspace && item.workspace && item.workspace !== request.workspace) return false;
      if (request.conversationId && item.conversationId !== request.conversationId) return false;
      return true;
    });

    if (!session) return null;
    return {
      appId,
      state: 'ready',
      workspace: session.workspace,
      conversationId: session.conversationId,
      visible: session.visible,
      url: session.pocketBaseSession.url,
      updatedAt: Date.now(),
    };
  }

  private getRuntimeScopeKey(appId: string, workspace?: string, conversationId?: string): string {
    return `${appId}:${workspace || 'default'}:${conversationId || 'global'}`;
  }

  private broadcastEvent(event: SkillAppAguiEvent): void {
    for (const subscription of this.eventSubscriptions) {
      if (subscription.appId !== event.appId) continue;
      if (subscription.conversationId && subscription.conversationId !== event.conversationId) continue;
      if (subscription.workspace && subscription.workspace !== event.workspace) continue;
      try {
        subscription.listener(event);
      } catch (error) {
        console.warn('[SkillAppRuntime] Failed to notify SkillApp event subscriber:', error);
      }
    }
  }

  private ensureBundleWatcher(sessionKey: string, app: ResolvedSkillApp): void {
    if (app.source !== 'managed') return;

    const existing = this.bundleWatchers.get(app.id);
    if (existing && existing.rootDir === app.rootDir) {
      existing.sessionKeys.add(sessionKey);
      return;
    }

    if (existing) {
      this.teardownBundleWatcher(app.id);
    }

    try {
      const watcherFactory =
        this.options.watchBundleRoot ??
        ((rootDir: string, listener: (eventType: string, filename?: string | Buffer | null) => void) =>
          fsSync.watch(rootDir, { recursive: true }, listener));
      const watcher = watcherFactory(app.rootDir, (_eventType, filename) => {
        const changedFile = typeof filename === 'string' ? filename : filename?.toString() || '';
        if (changedFile.endsWith('.DS_Store')) return;
        this.scheduleBundleReload(app.id);
      });

      this.bundleWatchers.set(app.id, {
        appId: app.id,
        rootDir: app.rootDir,
        watcher,
        sessionKeys: new Set([sessionKey]),
      });
    } catch (error) {
      console.warn(`[SkillAppRuntime] Failed to watch managed bundle for ${app.id}:`, error);
    }
  }

  private unregisterBundleWatcherSession(appId: string, sessionKey: string): void {
    const entry = this.bundleWatchers.get(appId);
    if (!entry) return;
    entry.sessionKeys.delete(sessionKey);
    if (entry.sessionKeys.size === 0) {
      this.teardownBundleWatcher(appId);
    }
  }

  private teardownBundleWatcher(appId: string): void {
    const entry = this.bundleWatchers.get(appId);
    if (!entry) return;
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
    }
    entry.watcher.close();
    this.bundleWatchers.delete(appId);
  }

  private scheduleBundleReload(appId: string): void {
    const watcher = this.bundleWatchers.get(appId);
    if (!watcher) return;
    if (watcher.debounceTimer) {
      clearTimeout(watcher.debounceTimer);
    }
    watcher.debounceTimer = setTimeout(() => {
      watcher.debounceTimer = undefined;
      void this.reloadManagedBundleSessions(appId);
    }, this.options.bundleReloadDebounceMs ?? DEFAULT_BUNDLE_RELOAD_DEBOUNCE_MS);
  }

  private async reloadManagedBundleSessions(appId: string): Promise<void> {
    const sessionSnapshots = Array.from(this.sessions.entries())
      .filter(([, session]) => session.app.id === appId && session.app.source === 'managed')
      .map(([sessionKey, session]) => ({
        sessionKey,
        workspace: session.workspace,
        conversationId: session.conversationId,
        visible: session.visible,
      }));

    if (sessionSnapshots.length === 0) {
      this.teardownBundleWatcher(appId);
      return;
    }

    this.teardownBundleWatcher(appId);

    await this.registry.discover(true);
    const updatedApp = (await this.registry.ensureProvisionedApp(appId)) ?? this.registry.getById(appId);
    if (!updatedApp) {
      console.warn(`[SkillAppRuntime] SkillApp disappeared during managed bundle reload: ${appId}`);
      return;
    }

    if (updatedApp.source === 'managed') {
      await (this.options.syncManagedSkillProjection ?? syncManagedSkillAppProjection)(
        updatedApp.skillName,
        updatedApp.skillDirectory
      );
    }

    for (const snapshot of sessionSnapshots) {
      const session = this.sessions.get(snapshot.sessionKey);
      if (session?.idleTimer) {
        clearTimeout(session.idleTimer);
      }
      this.sessions.delete(snapshot.sessionKey);
      await this.removeAgentSessionFile(snapshot.workspace, appId);
    }

    const stoppedWorkspaces = new Set(sessionSnapshots.map((snapshot) => snapshot.workspace ?? 'default'));
    for (const workspaceKey of stoppedWorkspaces) {
      const workspace = workspaceKey === 'default' ? undefined : workspaceKey;
      this.pocketBaseProvider.stopApp(appId, workspace);
    }

    for (const snapshot of sessionSnapshots) {
      try {
        const restartedSession = await this.ensureStarted(updatedApp, {
          conversationId: snapshot.conversationId,
          workspace: snapshot.workspace,
          visible: snapshot.visible,
        });

        if (snapshot.visible) {
          ipcBridge.preview.open.emit({
            content: restartedSession.pocketBaseSession.url,
            contentType: 'url',
            metadata: {
              title: updatedApp.previewTitle,
              fileName: updatedApp.displayName,
              skillAppId: updatedApp.id,
              conversationId: snapshot.conversationId,
              workspace: restartedSession.workspace,
            },
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.emitStatus({
          appId,
          state: 'error',
          message,
          workspace: snapshot.workspace,
          conversationId: snapshot.conversationId,
          updatedAt: Date.now(),
        });
        if (snapshot.visible) {
          this.openStartupErrorPreview(updatedApp, message);
        }
      }
    }
  }

  private async writeAgentSessionFile(session: SkillAppRuntimeSession): Promise<void> {
    const sessionFile = this.getAgentSessionFilePath(session.workspace, session.app.id);
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    const helperScript = this.resolveHelperScript(session.workspace, session.app);
    const payload = {
      appId: session.app.id,
      skillName: session.app.skillName,
      conversationId: session.conversationId,
      workspace: session.workspace,
      bundleRoot: session.app.rootDir,
      skillRoot: session.app.skillDirectory,
      frontendRoot: session.app.frontendDirectory,
      backendRoot: this.resolveBackendRoot(session.app),
      appUrl: session.pocketBaseSession.url,
      apiBase: this.extractUrlParam(session.pocketBaseSession.url, 'apiBase'),
      eventBase: this.extractUrlParam(session.pocketBaseSession.url, 'eventBase'),
      token: session.pocketBaseSession.token,
      collectionPrefix: session.pocketBaseSession.collectionPrefix,
      todosCollection: `${session.pocketBaseSession.collectionPrefix}todos`,
      eventsCollection: `${session.pocketBaseSession.collectionPrefix}events`,
      helperScript,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(sessionFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  private async removeAgentSessionFile(workspace: string | undefined, appId: string): Promise<void> {
    if (!workspace) return;
    await fs.rm(this.getAgentSessionFilePath(workspace, appId), { force: true });
  }

  private getAgentSessionFilePath(workspace: string | undefined, appId: string): string {
    return path.join(path.resolve(workspace || process.cwd()), '.aionui', 'skillapps', appId, 'session.json');
  }

  private resolveHelperScript(workspace: string | undefined, app: ResolvedSkillApp): string | null {
    if (workspace) {
      const workspaceHelperPath = path.join(
        workspace,
        '.claude',
        'skills',
        app.skillName,
        'scripts',
        `${app.id}ctl.js`
      );
      if (fsSync.existsSync(workspaceHelperPath)) {
        return workspaceHelperPath;
      }
    }

    const bundleHelperPath = path.join(app.skillDirectory, 'scripts', `${app.id}ctl.js`);
    return fsSync.existsSync(bundleHelperPath) ? bundleHelperPath : null;
  }

  private resolveBackendRoot(app: ResolvedSkillApp): string | null {
    const backendRoot = path.join(app.rootDir, 'backend');
    if (fsSync.existsSync(backendRoot)) {
      return backendRoot;
    }

    if (app.migrationsDir) {
      return path.dirname(path.dirname(app.migrationsDir));
    }

    return null;
  }

  private extractUrlParam(urlString: string, key: string): string | undefined {
    try {
      const url = new URL(urlString);
      return url.searchParams.get(key) || new URLSearchParams(url.hash.replace(/^#\??/, '')).get(key) || undefined;
    } catch {
      return undefined;
    }
  }

  private async resolveWebBaseUrl(): Promise<string> {
    if (this.options.resolveWebBaseUrl) {
      return this.options.resolveWebBaseUrl();
    }

    const { getWebServerInstance, setWebServerInstance } = await import('@process/bridge/webuiBridge');
    const existing = getWebServerInstance();
    if (existing) {
      return `http://127.0.0.1:${existing.port}`;
    }

    const { startWebServerWithInstance } = await import('@process/webserver/index');
    const instance = await startWebServerWithInstance(SERVER_CONFIG.DEFAULT_PORT, false);
    setWebServerInstance(instance);
    console.log(`[SkillAppRuntime] Started local WebUI server for SkillApp proxy on port ${instance.port}`);
    return `http://127.0.0.1:${instance.port}`;
  }

  private openStartupErrorPreview(app: ResolvedSkillApp, message: string): void {
    ipcBridge.preview.open.emit({
      content: renderStartupErrorHtml(app, message),
      contentType: 'html',
      metadata: {
        title: `${app.previewTitle} startup error`,
        fileName: `${app.id}-startup-error.html`,
        skillAppId: app.id,
      },
    });
  }
}

function renderStartupErrorHtml(app: ResolvedSkillApp, message: string): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(app.previewTitle)} startup error</title></head>
<body style="font-family: system-ui, sans-serif; padding: 24px;">
  <h2>${escapeHtml(app.previewTitle)} startup error</h2>
  <p>${escapeHtml(message)}</p>
  <p>Please verify the PocketBase binary path with AIONUI_POCKETBASE_BIN, or place a PocketBase zip archive in the workspace root.</p>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const skillAppRuntime = new SkillAppRuntime();
