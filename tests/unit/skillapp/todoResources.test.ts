/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('TODO SkillApp resources', () => {
  it('does not sort records by a missing created field in the frontend bootstrap', async () => {
    const htmlPath = path.resolve('src/process/resources/skillapp-templates/todo/frontend/index.html');
    const html = await fs.readFile(htmlPath, 'utf8');

    expect(html).not.toContain('sort=-created');
    expect(html).toContain('/api/collections/${todosCollection}/records?perPage=100');
    expect(html).toContain('new EventSource(streamUrl.toString())');
    expect(html).toContain("if (data?.payload?.origin === 'ui') return;");
  });

  it('declares created and updated autodate fields in the base TODO migration', async () => {
    const migrationPath = path.resolve(
      'src/process/resources/skillapp-templates/todo/backend/pocketbase/migrations/20260408000000_create_todo_collections.js'
    );
    const migration = await fs.readFile(migrationPath, 'utf8');

    expect(migration).toContain("name: 'created'");
    expect(migration).toContain("name: 'updated'");
    expect(migration).toContain("type: 'autodate'");
  });

  it('documents the session file and helper script in the TODO skill', async () => {
    const skillPath = path.resolve('src/process/resources/skillapp-templates/todo/skill/SKILL.md');
    const helperPath = path.resolve('src/process/resources/skillapp-templates/todo/skill/scripts/todoctl.js');
    const [skill, helper] = await Promise.all([fs.readFile(skillPath, 'utf8'), fs.readFile(helperPath, 'utf8')]);

    expect(skill).toContain('.aionui/skillapps/todo/session.json');
    expect(skill).toContain('.claude/skills/todo/scripts/todoctl.js');
    expect(skill).toContain('automatically signal the TODO SkillApp to refresh');
    expect(helper).toContain('Expected .aionui/skillapps/todo/session.json');
    expect(helper).toContain("case 'complete'");
    expect(helper).toContain('session.eventBase');
    expect(helper).toContain("origin: 'agent'");
  });
});
