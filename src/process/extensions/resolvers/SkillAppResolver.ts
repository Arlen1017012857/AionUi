/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import { existsSync } from 'node:fs';
import type { LoadedExtension, ExtSkillApp } from '../types';
import { isPathWithinDirectory } from '../sandbox/pathSafety';

export type SkillAppContribution = {
  id: string;
  manifestPath: string;
  rootDir: string;
  extensionName: string;
};

export function resolveSkillApps(extensions: LoadedExtension[]): SkillAppContribution[] {
  const skillApps: SkillAppContribution[] = [];
  for (const ext of extensions) {
    const declaredSkillApps = ext.manifest.contributes.skillApps;
    if (!declaredSkillApps || declaredSkillApps.length === 0) continue;
    for (const skillApp of declaredSkillApps) {
      const resolved = convertSkillApp(skillApp, ext);
      if (resolved) {
        skillApps.push(resolved);
      }
    }
  }
  return skillApps;
}

function convertSkillApp(skillApp: ExtSkillApp, ext: LoadedExtension): SkillAppContribution | null {
  const manifestPath = path.resolve(ext.directory, skillApp.manifest);
  if (!isPathWithinDirectory(manifestPath, ext.directory)) {
    console.warn(`[Extensions] SkillApp manifest path traversal attempt: ${skillApp.manifest} in ${ext.manifest.name}`);
    return null;
  }
  if (!existsSync(manifestPath)) {
    console.warn(`[Extensions] SkillApp manifest not found: ${manifestPath} (extension: ${ext.manifest.name})`);
    return null;
  }
  return {
    id: skillApp.id,
    manifestPath,
    rootDir: path.dirname(manifestPath),
    extensionName: ext.manifest.name,
  };
}
