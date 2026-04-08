/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes, createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { getSystemDir } from '@process/utils/initStorage';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import { isCollectionOwnedByApp, type ResolvedSkillApp } from './manifest';

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
type ExtractArchive = (archivePath: string, outputDir: string) => void | Promise<void>;

export type PocketBaseWorkspaceSession = {
  workspaceKey: string;
  workspace: string;
  dataDir: string;
  publicDir: string;
  port: number;
  url: string;
  process: ChildProcess;
  apps: Set<string>;
  stopped: boolean;
};

export type PocketBaseAppSession = {
  appId: string;
  workspace: string;
  workspaceKey: string;
  url: string;
  token: string;
  collectionPrefix: string;
  port: number;
};

type ScopedToken = {
  token: string;
  appId: string;
  workspaceKey: string;
  collectionPrefix: string;
  conversationId?: string;
  createdAt: number;
};

export type PocketBaseProviderOptions = {
  binaryPath?: string;
  archivePath?: string;
  cacheDir?: string;
  spawnProcess?: SpawnProcess;
  extractArchive?: ExtractArchive;
  findFreePort?: () => Promise<number>;
  waitForPort?: (port: number) => Promise<void>;
};

export class PocketBaseProvider {
  private readonly sessions = new Map<string, PocketBaseWorkspaceSession>();
  private readonly scopedTokens = new Map<string, ScopedToken>();
  private readonly options: PocketBaseProviderOptions;

  constructor(options: PocketBaseProviderOptions = {}) {
    this.options = options;
  }

  async startApp(
    app: ResolvedSkillApp,
    workspaceInput?: string,
    options: { conversationId?: string; apiBaseUrl?: string; eventBaseUrl?: string } = {}
  ): Promise<PocketBaseAppSession> {
    const workspace = this.resolveWorkspace(workspaceInput);
    const workspaceKey = this.getWorkspaceKey(workspace);
    await this.copyFrontendAssets(app, workspaceKey);

    let workspaceSession = this.sessions.get(workspaceKey);
    if (!workspaceSession || workspaceSession.stopped || workspaceSession.process.exitCode !== null) {
      if (app.migrationsDir) {
        await this.applyMigrations(app, workspace);
      }
      workspaceSession = await this.startWorkspaceBackend(workspace);
    }

    workspaceSession.apps.add(app.id);
    const token = this.createScopedToken(app, workspaceSession, options.conversationId);
    const url = this.buildAppUrl(app, workspaceSession, token, options);
    return {
      appId: app.id,
      workspace,
      workspaceKey,
      url,
      token,
      collectionPrefix: app.collectionPrefix,
      port: workspaceSession.port,
    };
  }

  stopApp(appId: string, workspaceInput?: string): void {
    const workspace = this.resolveWorkspace(workspaceInput);
    const workspaceKey = this.getWorkspaceKey(workspace);
    const session = this.sessions.get(workspaceKey);
    if (!session) return;

    session.apps.delete(appId);
    for (const [token, scoped] of this.scopedTokens) {
      if (scoped.appId === appId && scoped.workspaceKey === workspaceKey) {
        this.scopedTokens.delete(token);
      }
    }

    if (session.apps.size === 0) {
      this.killWorkspaceSession(session);
    }
  }

  stopAll(): void {
    for (const session of this.sessions.values()) {
      this.killWorkspaceSession(session);
    }
    this.sessions.clear();
    this.scopedTokens.clear();
  }

  getWorkspaceKey(workspaceInput: string): string {
    return createHash('sha256').update(path.resolve(workspaceInput)).digest('hex').slice(0, 16);
  }

  resolveWorkspaceDataDir(workspaceInput: string): string {
    return path.join(this.getPocketBaseWorkspaceRoot(workspaceInput), 'pb_data');
  }

  resolveWorkspacePublicDir(workspaceInput: string): string {
    return path.join(this.getPocketBaseWorkspaceRoot(workspaceInput), 'pb_public');
  }

  resolvePocketBaseBinary(): string | null {
    const binaryName = process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
    const explicit = this.options.binaryPath || process.env.AIONUI_POCKETBASE_BIN || process.env.POCKETBASE_BIN;
    const candidates = [
      explicit,
      findExecutableOnPath(binaryName),
      path.join(process.cwd(), binaryName),
      path.join(process.cwd(), 'bin', 'pocketbase', `${process.platform}-${process.arch}`, binaryName),
      process.resourcesPath
        ? path.join(process.resourcesPath, 'pocketbase', `${process.platform}-${process.arch}`, binaryName)
        : undefined,
    ].filter((candidate): candidate is string => Boolean(candidate));

    return candidates.find((candidate) => isExecutableFile(candidate)) ?? null;
  }

  async ensurePocketBaseBinary(): Promise<string> {
    const binary = this.resolvePocketBaseBinary();
    if (binary) {
      return binary;
    }

    const archivePath = this.resolvePocketBaseArchive();
    if (!archivePath) {
      throw new Error(
        'PocketBase binary was not found. Set AIONUI_POCKETBASE_BIN to a pocketbase binary or zip archive, or place a pocketbase_*.zip file in the workspace root.'
      );
    }

    return this.extractPocketBaseArchive(archivePath);
  }

  getSessionForToken(
    appId: string,
    token: string,
    pocketBasePath?: string
  ): { session: PocketBaseWorkspaceSession; scopedToken: ScopedToken } | null {
    const scopedToken = this.scopedTokens.get(token);
    if (!scopedToken || scopedToken.appId !== appId) return null;

    const collectionName = pocketBasePath ? extractCollectionNameFromPocketBasePath(pocketBasePath) : undefined;
    if (collectionName && !isCollectionOwnedByApp(collectionName, scopedToken.collectionPrefix)) {
      return null;
    }

    const session = this.sessions.get(scopedToken.workspaceKey);
    if (!session || session.stopped || session.process.exitCode !== null) return null;
    return { session, scopedToken };
  }

  getSessionByPort(port: number): PocketBaseWorkspaceSession | null {
    for (const session of this.sessions.values()) {
      if (session.port === port && !session.stopped && session.process.exitCode === null) {
        return session;
      }
    }
    return null;
  }

  private async applyMigrations(app: ResolvedSkillApp, workspaceInput: string): Promise<void> {
    if (!app.migrationsDir) return;
    const binary = await this.ensurePocketBaseBinary();

    const dataDir = this.resolveWorkspaceDataDir(this.resolveWorkspace(workspaceInput));
    await fs.mkdir(dataDir, { recursive: true });
    await this.runPocketBaseCommand(binary, ['migrate', 'up', '--dir', dataDir, '--migrationsDir', app.migrationsDir]);
  }

  private async startWorkspaceBackend(workspaceInput: string): Promise<PocketBaseWorkspaceSession> {
    const workspace = this.resolveWorkspace(workspaceInput);
    const workspaceKey = this.getWorkspaceKey(workspace);
    const existing = this.sessions.get(workspaceKey);
    if (existing && !existing.stopped && existing.process.exitCode === null) {
      return existing;
    }

    const binary = await this.ensurePocketBaseBinary();

    const dataDir = this.resolveWorkspaceDataDir(workspace);
    const publicDir = this.resolveWorkspacePublicDir(workspace);
    await Promise.all([fs.mkdir(dataDir, { recursive: true }), fs.mkdir(publicDir, { recursive: true })]);
    await this.ensureManagedSuperuser(binary, workspaceKey, dataDir);

    const port = await (this.options.findFreePort?.() ?? findFreePort());
    const child = this.spawn(binary, [
      'serve',
      '--http',
      `127.0.0.1:${port}`,
      '--dir',
      dataDir,
      '--publicDir',
      publicDir,
    ]);
    const session: PocketBaseWorkspaceSession = {
      workspaceKey,
      workspace,
      dataDir,
      publicDir,
      port,
      url: `http://127.0.0.1:${port}`,
      process: child,
      apps: new Set(),
      stopped: false,
    };
    this.sessions.set(workspaceKey, session);

    child.once('exit', () => {
      if (!session.stopped) {
        this.sessions.delete(workspaceKey);
      }
    });

    await (this.options.waitForPort?.(port) ?? waitForPort(port));
    return session;
  }

  private async copyFrontendAssets(app: ResolvedSkillApp, workspaceKey: string): Promise<void> {
    const publicDir = path.join(this.getPocketBaseWorkspaceRootByKey(workspaceKey), 'pb_public');
    const appPublicDir = path.join(publicDir, 'apps', app.id);
    await fs.rm(appPublicDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(appPublicDir), { recursive: true });
    await fs.cp(app.frontendDirectory, appPublicDir, { recursive: true });
  }

  private createScopedToken(
    app: ResolvedSkillApp,
    workspaceSession: PocketBaseWorkspaceSession,
    conversationId?: string
  ): string {
    const token = randomBytes(24).toString('base64url');
    this.scopedTokens.set(token, {
      token,
      appId: app.id,
      workspaceKey: workspaceSession.workspaceKey,
      collectionPrefix: app.collectionPrefix,
      conversationId,
      createdAt: Date.now(),
    });
    return token;
  }

  private buildAppUrl(
    app: ResolvedSkillApp,
    session: PocketBaseWorkspaceSession,
    token: string,
    options: { conversationId?: string; apiBaseUrl?: string; eventBaseUrl?: string }
  ): string {
    const entryName = app.frontendEntryName.split(path.sep).join('/');
    const entryPath = entryName === 'index.html' ? `/apps/${app.id}/` : `/apps/${app.id}/${entryName}`;
    const url = new URL(entryPath, session.url);
    url.searchParams.set('appId', app.id);
    url.searchParams.set('token', token);
    url.searchParams.set('collectionPrefix', app.collectionPrefix);
    url.searchParams.set('todosCollection', `${app.collectionPrefix}todos`);
    url.searchParams.set('eventsCollection', `${app.collectionPrefix}events`);
    url.searchParams.set('pbBase', session.url);
    if (options.conversationId) url.searchParams.set('conversationId', options.conversationId);
    if (options.apiBaseUrl) url.searchParams.set('apiBase', options.apiBaseUrl);
    if (options.eventBaseUrl) url.searchParams.set('eventBase', options.eventBaseUrl);
    url.hash = url.searchParams.toString();
    return url.toString();
  }

  private async ensureManagedSuperuser(binary: string, workspaceKey: string, dataDir: string): Promise<void> {
    const email = `skillapp-${workspaceKey}@aionui.local`;
    const password = createHash('sha256')
      .update(`aionui-skillapp-pocketbase:${workspaceKey}`)
      .digest('base64url')
      .slice(0, 32);
    await this.runPocketBaseCommand(binary, ['superuser', 'upsert', email, password, '--dir', dataDir]);
  }

  private getPocketBaseWorkspaceRoot(workspaceInput: string): string {
    const workspace = this.resolveWorkspace(workspaceInput);
    return this.getPocketBaseWorkspaceRootByKey(this.getWorkspaceKey(workspace));
  }

  private getPocketBaseWorkspaceRootByKey(workspaceKey: string): string {
    const cacheDir = this.options.cacheDir ?? getSystemDir().cacheDir;
    return path.join(cacheDir, 'skillapps', 'pocketbase-workspaces', workspaceKey);
  }

  private resolvePocketBaseArchive(): string | null {
    const explicit = this.options.binaryPath || process.env.AIONUI_POCKETBASE_BIN || process.env.POCKETBASE_BIN;
    const resourceArchives = process.resourcesPath ? findPocketBaseArchivesInDirectory(process.resourcesPath) : [];
    const archiveCandidates = [
      this.options.archivePath,
      explicit,
      ...findPocketBaseArchivesInDirectory(process.cwd()),
      ...resourceArchives,
    ].filter((candidate): candidate is string => Boolean(candidate));

    return archiveCandidates.find((candidate) => candidate.endsWith('.zip') && isReadableFile(candidate)) ?? null;
  }

  private async extractPocketBaseArchive(archivePath: string): Promise<string> {
    const binaryName = process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
    const extractRoot = this.getPocketBaseBinaryExtractRoot(archivePath);
    const cachedBinary = findBinaryInDir(extractRoot, binaryName);
    if (cachedBinary) {
      return this.ensureExecutablePermissions(cachedBinary);
    }

    await fs.rm(extractRoot, { recursive: true, force: true });
    await fs.mkdir(extractRoot, { recursive: true });
    await Promise.resolve((this.options.extractArchive ?? extractZipArchive)(archivePath, extractRoot));

    const extractedBinary = findBinaryInDir(extractRoot, binaryName);
    if (!extractedBinary) {
      throw new Error(`PocketBase archive did not contain ${binaryName}: ${path.basename(archivePath)}`);
    }

    return this.ensureExecutablePermissions(extractedBinary);
  }

  private async ensureExecutablePermissions(filePath: string): Promise<string> {
    if (process.platform !== 'win32') {
      await fs.chmod(filePath, 0o755).catch(() => {});
    }
    return filePath;
  }

  private getPocketBaseBinaryExtractRoot(archivePath: string): string {
    const cacheDir = this.options.cacheDir ?? getSystemDir().cacheDir;
    const stat = fsSync.statSync(archivePath);
    const fingerprint = createHash('sha256')
      .update(`${path.resolve(archivePath)}:${stat.size}:${stat.mtimeMs}`)
      .digest('hex')
      .slice(0, 16);
    return path.join(cacheDir, 'skillapps', 'pocketbase-bin', fingerprint);
  }

  private resolveWorkspace(workspaceInput?: string): string {
    return path.resolve(workspaceInput || getSystemDir().workDir);
  }

  private spawn(binary: string, args: string[]): ChildProcess {
    return (this.options.spawnProcess ?? spawn)(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: getEnhancedEnv(),
    });
  }

  private runPocketBaseCommand(binary: string, args: string[], timeoutMs = 30_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.spawn(binary, args);
      const stderr: Buffer[] = [];
      const stdout: Buffer[] = [];
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`PocketBase command timed out: ${args.join(' ')}`));
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
          return;
        }
        const output = Buffer.concat([...stdout, ...stderr])
          .toString('utf8')
          .trim();
        const reason = signal ? `signal ${signal}` : `code ${code}`;
        reject(new Error(`PocketBase command failed with ${reason}${output ? `: ${output}` : ''}`));
      });
    });
  }

  private killWorkspaceSession(session: PocketBaseWorkspaceSession): void {
    session.stopped = true;
    session.process.kill();
    this.sessions.delete(session.workspaceKey);
  }
}

export function extractCollectionNameFromPocketBasePath(pocketBasePath: string): string | undefined {
  const match = pocketBasePath.match(/^\/?api\/collections\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function extractZipArchive(archivePath: string, outputDir: string): void {
  if (process.platform === 'win32') {
    const psScript = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outputDir.replace(/'/g, "''")}' -Force`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], { stdio: 'ignore' });
    return;
  }

  try {
    execFileSync('unzip', ['-o', archivePath, '-d', outputDir], { stdio: 'ignore' });
  } catch {
    execFileSync('tar', ['-xf', archivePath, '-C', outputDir], { stdio: 'ignore' });
  }
}

function findPocketBaseArchivesInDirectory(directoryPath: string): string[] {
  try {
    const entries = fsSync.readdirSync(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^pocketbase_.*\.zip$/i.test(entry.name))
      .map((entry) => path.join(directoryPath, entry.name));
  } catch {
    return [];
  }
}

function findBinaryInDir(directoryPath: string, binaryName: string): string | null {
  if (!fsSync.existsSync(directoryPath)) return null;

  const entries = fsSync.readdirSync(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isFile() && entry.name === binaryName) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const nestedBinary = findBinaryInDir(fullPath, binaryName);
      if (nestedBinary) {
        return nestedBinary;
      }
    }
  }

  return null;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        server.close(() => resolve(address.port));
      } else {
        server.close(() => reject(new Error('Failed to allocate a free port')));
      }
    });
    server.on('error', reject);
  });
}

function waitForPort(port: number, maxRetries = 150, intervalMs = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryConnect = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        attempt++;
        if (attempt >= maxRetries) {
          reject(new Error(`PocketBase port ${port} was not ready after ${maxRetries} attempts`));
        } else {
          setTimeout(tryConnect, intervalMs);
        }
      });
    };
    tryConnect();
  });
}

function findExecutableOnPath(binaryName: string): string | undefined {
  const paths = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const entry of paths) {
    const candidate = path.join(entry, binaryName);
    if (isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fsSync.statSync(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function isReadableFile(filePath: string): boolean {
  try {
    const stat = fsSync.statSync(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export const pocketBaseProvider = new PocketBaseProvider();
