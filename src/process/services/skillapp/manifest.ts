/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { SkillAppBackendProvider, SkillAppInfo, SkillAppManifest } from '@/common/types/skillapp';
import { isPathWithinDirectory } from '@process/extensions/sandbox/pathSafety';

export type SkillAppSource = 'template' | 'managed' | 'extension';

export type ResolvedSkillApp = SkillAppInfo & {
  manifest: SkillAppManifest;
  manifestPath: string;
  rootDir: string;
  source: SkillAppSource;
  skillFilePath: string;
  skillDirectory: string;
  frontendEntryPath: string;
  frontendDirectory: string;
  frontendEntryName: string;
  migrationsDir?: string;
  collectionPrefix: string;
  defaultEventPolicy: NonNullable<NonNullable<SkillAppManifest['events']>['defaultPolicy']>;
  idleTimeoutMs: number;
};

type SkillAppManifestParseOptions = {
  manifestPath: string;
  rootDir: string;
  source: SkillAppSource;
};

const SKILL_APP_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const SkillAppManifestSchema = z
  .object({
    id: z.string().regex(SKILL_APP_ID_PATTERN, 'SkillApp id must be kebab-case and start with a letter'),
    displayName: z.string().min(1, 'displayName is required'),
    description: z.string().optional(),
    skill: z.object({
      name: z.string().min(1, 'skill.name is required'),
      file: z.string().optional(),
      description: z.string().optional(),
    }),
    frontend: z
      .object({
        entrypoint: z.string().optional(),
        entry: z.string().optional(),
        directory: z.string().optional(),
      })
      .refine((value) => Boolean(value.entrypoint || value.entry), {
        message: 'frontend.entrypoint is required',
      }),
    backend: z.object({
      provider: z.literal('pocketbase'),
      migrationsDir: z.string().optional(),
      collectionPrefix: z.string().optional(),
    }),
    preview: z
      .object({
        title: z.string().optional(),
      })
      .optional(),
    activation: z
      .object({
        openOnLoad: z.boolean().default(false),
        idleTimeoutMs: z.number().int().positive().default(DEFAULT_IDLE_TIMEOUT_MS),
      })
      .default({ openOnLoad: false, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS }),
    events: z
      .object({
        defaultPolicy: z.enum(['state-only', 'next-turn', 'immediate']).default('state-only'),
      })
      .default({ defaultPolicy: 'state-only' }),
  })
  .strict();

type ParsedSkillAppManifest = z.infer<typeof SkillAppManifestSchema>;

export function toPocketBaseCollectionPrefix(appId: string): string {
  return `app_${appId.replace(/-/g, '_')}_`;
}

export function isCollectionOwnedByApp(collectionName: string, collectionPrefix: string): boolean {
  return collectionName === collectionPrefix.slice(0, -1) || collectionName.startsWith(collectionPrefix);
}

export function parseSkillAppManifest(raw: unknown, options: SkillAppManifestParseOptions): ResolvedSkillApp {
  const parsed = SkillAppManifestSchema.parse(raw);
  const skillFile = parsed.skill.file || 'skill/SKILL.md';
  const skillFilePath = resolveContainedFile(options.rootDir, skillFile, 'skill.file');
  const skillDirectory = path.dirname(skillFilePath);
  const entrypoint = parsed.frontend.entrypoint || parsed.frontend.entry;
  if (!entrypoint) {
    throw new Error('frontend.entrypoint is required');
  }

  const frontendEntryPath = resolveContainedFile(options.rootDir, entrypoint, 'frontend.entrypoint');
  const frontendDirectory = parsed.frontend.directory
    ? resolveContainedDirectory(options.rootDir, parsed.frontend.directory, 'frontend.directory')
    : path.dirname(frontendEntryPath);
  const frontendEntryName = path.relative(frontendDirectory, frontendEntryPath);
  if (frontendEntryName.startsWith('..') || path.isAbsolute(frontendEntryName)) {
    throw new Error('frontend.entrypoint must be inside frontend.directory');
  }

  const migrationsDir = parsed.backend.migrationsDir
    ? resolveContainedDirectory(options.rootDir, parsed.backend.migrationsDir, 'backend.migrationsDir')
    : undefined;
  const collectionPrefix = parsed.backend.collectionPrefix || toPocketBaseCollectionPrefix(parsed.id);
  validateCollectionPrefix(collectionPrefix, parsed.id);

  const manifest = normalizeManifest(parsed, entrypoint);
  return {
    id: parsed.id,
    displayName: parsed.displayName,
    description: parsed.description,
    skillName: parsed.skill.name,
    backendProvider: parsed.backend.provider as SkillAppBackendProvider,
    previewTitle: parsed.preview?.title || parsed.displayName,
    openOnLoad: parsed.activation.openOnLoad,
    manifest,
    manifestPath: options.manifestPath,
    rootDir: options.rootDir,
    source: options.source,
    skillFilePath,
    skillDirectory,
    frontendEntryPath,
    frontendDirectory,
    frontendEntryName,
    migrationsDir,
    collectionPrefix,
    defaultEventPolicy: parsed.events.defaultPolicy,
    idleTimeoutMs: parsed.activation.idleTimeoutMs,
  };
}

function normalizeManifest(parsed: ParsedSkillAppManifest, entrypoint: string): SkillAppManifest {
  return {
    id: parsed.id,
    displayName: parsed.displayName,
    description: parsed.description,
    skill: {
      name: parsed.skill.name,
      file: parsed.skill.file || 'skill/SKILL.md',
      description: parsed.skill.description,
    },
    frontend: {
      entrypoint,
      directory: parsed.frontend.directory,
    },
    backend: {
      provider: parsed.backend.provider,
      migrationsDir: parsed.backend.migrationsDir,
      collectionPrefix: parsed.backend.collectionPrefix,
    },
    preview: parsed.preview,
    activation: parsed.activation,
    events: parsed.events,
  };
}

function resolveContainedFile(rootDir: string, relativePath: string, fieldName: string): string {
  const resolvedPath = resolveContainedPath(rootDir, relativePath, fieldName);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw new Error(`${fieldName} not found: ${relativePath}`);
  }
  return resolvedPath;
}

function resolveContainedDirectory(rootDir: string, relativePath: string, fieldName: string): string {
  const resolvedPath = resolveContainedPath(rootDir, relativePath, fieldName);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    throw new Error(`${fieldName} not found: ${relativePath}`);
  }
  return resolvedPath;
}

function resolveContainedPath(rootDir: string, relativePath: string, fieldName: string): string {
  const resolvedPath = path.resolve(rootDir, relativePath);
  if (!isPathWithinDirectory(resolvedPath, rootDir)) {
    throw new Error(`${fieldName} escapes SkillApp root: ${relativePath}`);
  }
  return resolvedPath;
}

function validateCollectionPrefix(collectionPrefix: string, appId: string): void {
  const safePrefix = toPocketBaseCollectionPrefix(appId);
  if (!/^[a-z][a-z0-9_]*_$/.test(collectionPrefix)) {
    throw new Error('backend.collectionPrefix must be lowercase snake_case and end with underscore');
  }
  if (collectionPrefix !== safePrefix) {
    throw new Error(`backend.collectionPrefix must use the app namespace prefix: ${safePrefix}`);
  }
}
