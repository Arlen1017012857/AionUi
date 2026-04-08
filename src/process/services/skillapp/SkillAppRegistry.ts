/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { ExtensionRegistry } from '@process/extensions';
import { copyDirectoryRecursively } from '@process/utils';
import { getManagedSkillAppsRoot, getSkillAppTemplateRoots } from '@process/utils/initStorage';
import { type ResolvedSkillApp } from './manifest';
import { loadResolvedSkillApp, loadResolvedSkillAppsFromRoot } from './source';

type SkillAppContribution = {
  manifestPath: string;
  rootDir: string;
  extensionName?: string;
};

export type SkillAppRegistryOptions = {
  templateRoots?: string[];
  builtinRoots?: string[];
  managedRoot?: string;
  extensionContributions?: SkillAppContribution[];
};

export class SkillAppRegistry {
  private apps = new Map<string, ResolvedSkillApp>();
  private initialized = false;
  private readonly templateRoots?: string[];
  private readonly builtinRoots?: string[];
  private readonly managedRoot?: string;
  private readonly extensionContributions?: SkillAppContribution[];

  constructor(options: SkillAppRegistryOptions = {}) {
    this.templateRoots = options.templateRoots;
    this.builtinRoots = options.builtinRoots;
    this.managedRoot = options.managedRoot;
    this.extensionContributions = options.extensionContributions;
  }

  async discover(force = false): Promise<void> {
    if (this.initialized && !force) return;

    const nextApps = new Map<string, ResolvedSkillApp>();
    for (const app of await this.collectApps()) {
      if (nextApps.has(app.id)) {
        console.warn(`[SkillAppRegistry] Duplicate SkillApp id "${app.id}" skipped: ${app.manifestPath}`);
        continue;
      }
      nextApps.set(app.id, app);
    }

    this.apps = nextApps;
    this.initialized = true;
  }

  list(): ResolvedSkillApp[] {
    return Array.from(this.apps.values()).toSorted((a, b) => a.displayName.localeCompare(b.displayName));
  }

  getById(appId: string): ResolvedSkillApp | undefined {
    return this.apps.get(appId);
  }

  findBySkillName(skillName: string): ResolvedSkillApp | undefined {
    return this.list().find((app) => app.skillName === skillName);
  }

  async ensureProvisionedApp(appId: string): Promise<ResolvedSkillApp | undefined> {
    await this.discover();
    const app = this.apps.get(appId);
    if (!app) return undefined;
    if (app.source !== 'template') return app;

    const managedRoot = this.managedRoot ?? getManagedSkillAppsRoot();
    const managedBundleRoot = path.join(managedRoot, app.id);
    const managedManifestPath = path.join(managedBundleRoot, 'skillapp.json');

    await fs.mkdir(managedRoot, { recursive: true });
    if (!fsSync.existsSync(managedManifestPath)) {
      await copyDirectoryRecursively(app.rootDir, managedBundleRoot, { overwrite: false });
    }

    await this.discover(true);
    return this.apps.get(appId);
  }

  private async collectApps(): Promise<ResolvedSkillApp[]> {
    const apps: ResolvedSkillApp[] = [];
    const dedupe = new Set<string>();

    const managedRoot = this.managedRoot ?? getManagedSkillAppsRoot();
    for (const app of await loadResolvedSkillAppsFromRoot(managedRoot, 'managed')) {
      if (dedupe.has(app.id)) continue;
      dedupe.add(app.id);
      apps.push(app);
    }

    const extensionContributions = this.extensionContributions ?? getExtensionSkillAppContributions();
    const extensionApps = await Promise.all(
      extensionContributions.map((contribution) =>
        loadResolvedSkillApp({
          manifestPath: contribution.manifestPath,
          rootDir: contribution.rootDir,
          source: 'extension',
          extensionName: contribution.extensionName,
        })
      )
    );
    for (const app of extensionApps) {
      if (!app || dedupe.has(app.id)) continue;
      dedupe.add(app.id);
      apps.push(app);
    }

    const templateRoots = this.templateRoots ?? this.builtinRoots ?? getDefaultTemplateSkillAppRoots();
    const templateApps = await Promise.all(
      templateRoots.map((root) => loadResolvedSkillAppsFromRoot(root, 'template'))
    );
    for (const app of templateApps.flat()) {
      if (dedupe.has(app.id)) continue;
      dedupe.add(app.id);
      apps.push(app);
    }

    return apps;
  }
}

export function getDefaultManagedSkillAppsRoot(): string {
  return getManagedSkillAppsRoot();
}

export function getDefaultTemplateSkillAppRoots(): string[] {
  return getSkillAppTemplateRoots();
}

export function getDefaultBuiltinSkillAppRoots(): string[] {
  return getDefaultTemplateSkillAppRoots();
}

function getExtensionSkillAppContributions(): SkillAppContribution[] {
  try {
    return ExtensionRegistry.getInstance().getSkillAppContributions();
  } catch {
    return [];
  }
}
