/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { parseSkillAppManifest, type ResolvedSkillApp, type SkillAppSource } from './manifest';

export type SkillAppManifestInput = {
  manifestPath: string;
  rootDir: string;
  source: SkillAppSource;
  extensionName?: string;
};

export async function loadResolvedSkillApp(input: SkillAppManifestInput): Promise<ResolvedSkillApp | null> {
  try {
    const raw = JSON.parse(await fs.readFile(input.manifestPath, 'utf-8')) as unknown;
    return parseSkillAppManifest(raw, input);
  } catch (error) {
    console.warn(
      `[SkillAppSource] Failed to load SkillApp manifest ${input.manifestPath}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

export async function loadResolvedSkillAppsFromRoot(rootDir: string, source: SkillAppSource): Promise<ResolvedSkillApp[]> {
  const manifestInputs = await discoverSkillAppManifests(rootDir, source);
  const apps = await Promise.all(manifestInputs.map((input) => loadResolvedSkillApp(input)));
  return apps.filter((app): app is ResolvedSkillApp => Boolean(app));
}

export async function discoverSkillAppManifests(
  rootDir: string,
  source: SkillAppSource
): Promise<SkillAppManifestInput[]> {
  if (!fsSync.existsSync(rootDir)) return [];

  const manifests: SkillAppManifestInput[] = [];
  const rootManifest = path.join(rootDir, 'skillapp.json');
  if (fsSync.existsSync(rootManifest)) {
    manifests.push({ manifestPath: rootManifest, rootDir, source });
  }

  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch((): fsSync.Dirent[] => []);
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const appRoot = path.join(rootDir, entry.name);
    const manifestPath = path.join(appRoot, 'skillapp.json');
    if (fsSync.existsSync(manifestPath)) {
      manifests.push({ manifestPath, rootDir: appRoot, source });
    }
  }

  return manifests;
}
