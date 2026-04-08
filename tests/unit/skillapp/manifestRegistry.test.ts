/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSkillAppManifest, toPocketBaseCollectionPrefix } from '../../../src/process/services/skillapp/manifest';
import { SkillAppRegistry } from '../../../src/process/services/skillapp/SkillAppRegistry';

let tempDir = '';

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-skillapp-manifest-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function createSkillApp(
  baseDir: string,
  rootName: string,
  manifestOverrides: Record<string, unknown> = {}
): Promise<string> {
  const root = path.join(baseDir, rootName);
  await fs.mkdir(path.join(root, 'skill', 'scripts'), { recursive: true });
  await fs.mkdir(path.join(root, 'frontend'), { recursive: true });
  await fs.writeFile(path.join(root, 'skill', 'SKILL.md'), `# ${rootName}\n`, 'utf-8');
  await fs.writeFile(path.join(root, 'skill', 'scripts', `${rootName}ctl.js`), '#!/usr/bin/env node\n', 'utf-8');
  await fs.writeFile(path.join(root, 'frontend', 'index.html'), '<!doctype html><title>TODO</title>', 'utf-8');
  const manifest = {
    id: rootName,
    displayName: rootName,
    skill: { name: rootName },
    frontend: { entrypoint: 'frontend/index.html', directory: 'frontend' },
    backend: { provider: 'pocketbase', collectionPrefix: toPocketBaseCollectionPrefix(rootName) },
    activation: { openOnLoad: true },
    ...manifestOverrides,
  };
  await fs.writeFile(path.join(root, 'skillapp.json'), JSON.stringify(manifest), 'utf-8');
  return root;
}

describe('SkillApp manifest validation', () => {
  it('registers a valid manifest with normalized frontend paths and activation policy', async () => {
    const root = await createSkillApp(tempDir, 'todo');
    const raw = JSON.parse(await fs.readFile(path.join(root, 'skillapp.json'), 'utf-8')) as unknown;

    const app = parseSkillAppManifest(raw, {
      manifestPath: path.join(root, 'skillapp.json'),
      rootDir: root,
      source: 'template',
    });

    expect(app.id).toBe('todo');
    expect(app.openOnLoad).toBe(true);
    expect(app.skillFilePath).toBe(path.join(root, 'skill', 'SKILL.md'));
    expect(app.skillDirectory).toBe(path.join(root, 'skill'));
    expect(app.frontendEntryPath).toBe(path.join(root, 'frontend', 'index.html'));
  });

  it('rejects invalid ids and unsafe frontend paths', async () => {
    const root = await createSkillApp(tempDir, 'todo');
    const base = JSON.parse(await fs.readFile(path.join(root, 'skillapp.json'), 'utf-8')) as Record<string, unknown>;

    expect(() =>
      parseSkillAppManifest(
        { ...base, id: 'BadId' },
        { manifestPath: 'skillapp.json', rootDir: root, source: 'template' }
      )
    ).toThrow(/SkillApp id/);

    expect(() =>
      parseSkillAppManifest(
        { ...base, frontend: { entrypoint: '../outside.html' } },
        { manifestPath: 'skillapp.json', rootDir: root, source: 'template' }
      )
    ).toThrow(/escapes SkillApp root/);
  });
});

describe('SkillAppRegistry', () => {
  it('discovers valid manifests and finds apps by skill name', async () => {
    await createSkillApp(tempDir, 'todo');
    const registry = new SkillAppRegistry({ templateRoots: [tempDir], managedRoot: path.join(tempDir, 'managed') });

    await registry.discover();

    expect(registry.list().map((app) => app.id)).toEqual(['todo']);
    expect(registry.findBySkillName('todo')?.displayName).toBe('todo');
  });

  it('skips invalid manifests without exposing them', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await createSkillApp(tempDir, 'todo');
    await createSkillApp(tempDir, 'bad-app', { id: 'BadApp' });
    const registry = new SkillAppRegistry({ templateRoots: [tempDir], managedRoot: path.join(tempDir, 'managed') });

    await registry.discover();

    expect(registry.list().map((app) => app.id)).toEqual(['todo']);
    expect(registry.getById('bad-app')).toBeUndefined();
    warnSpy.mockRestore();
  });

  it('prefers managed bundles over starter templates for the same app id', async () => {
    const templateRoot = path.join(tempDir, 'templates');
    const managedRoot = path.join(tempDir, 'managed');
    await createSkillApp(templateRoot, 'todo', { displayName: 'Template TODO' });
    await createSkillApp(managedRoot, 'todo', { displayName: 'Managed TODO' });

    const registry = new SkillAppRegistry({ templateRoots: [templateRoot], managedRoot });
    await registry.discover();

    expect(registry.list()).toEqual([
      expect.objectContaining({
        id: 'todo',
        displayName: 'Managed TODO',
        source: 'managed',
      }),
    ]);
  });

  it('provisions a starter template into the managed root on first use', async () => {
    const templateRoot = path.join(tempDir, 'templates');
    const managedRoot = path.join(tempDir, 'managed');
    const templateAppRoot = await createSkillApp(templateRoot, 'todo', { displayName: 'Template TODO' });

    const registry = new SkillAppRegistry({ templateRoots: [templateRoot], managedRoot });
    await registry.discover();

    const provisioned = await registry.ensureProvisionedApp('todo');

    expect(provisioned).toEqual(
      expect.objectContaining({
        id: 'todo',
        displayName: 'Template TODO',
        source: 'managed',
        rootDir: path.join(managedRoot, 'todo'),
        skillDirectory: path.join(managedRoot, 'todo', 'skill'),
      })
    );
    expect(await fs.readFile(path.join(managedRoot, 'todo', 'skill', 'SKILL.md'), 'utf-8')).toBe('# todo\n');
    expect(await fs.readFile(path.join(templateAppRoot, 'skill', 'SKILL.md'), 'utf-8')).toBe('# todo\n');
  });
});
