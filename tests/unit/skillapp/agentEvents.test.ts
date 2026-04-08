/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  AgentEventRouter,
  normalizeSkillAppEvent,
  normalizePocketBaseRealtimeEvent,
} from '../../../src/process/services/skillapp';
import type { IWorkerTaskManager } from '../../../src/process/task/IWorkerTaskManager';

function createTask(status: 'pending' | 'running' | 'finished' = 'finished') {
  return {
    type: 'acp',
    status,
    workspace: '/workspace',
    conversation_id: 'conv-1',
    lastActivityAt: Date.now(),
    sendMessage: vi.fn(async () => ({ success: true })),
    stop: vi.fn(),
    confirm: vi.fn(),
    getConfirmations: vi.fn(() => []),
    kill: vi.fn(),
  };
}

function createTaskManager(task: ReturnType<typeof createTask>): IWorkerTaskManager {
  return {
    getTask: vi.fn(() => task),
    getOrBuildTask: vi.fn(),
    addTask: vi.fn(),
    kill: vi.fn(),
    clear: vi.fn(),
    listTasks: vi.fn(() => [{ id: 'conv-1', type: 'acp' }]),
  } as unknown as IWorkerTaskManager;
}

describe('SkillApp AG-UI event normalization', () => {
  it('normalizes custom UI actions into AG-UI-compatible events', () => {
    const event = normalizeSkillAppEvent({
      appId: 'todo',
      conversationId: 'conv-1',
      type: 'plan.reschedule_requested',
      payload: { action: 'plan.reschedule_requested' },
    });

    expect(event.type).toBe('CUSTOM');
    expect(event.summary).toBe('todo: plan.reschedule_requested');
  });

  it('normalizes PocketBase realtime record updates as state deltas', () => {
    const event = normalizePocketBaseRealtimeEvent({
      appId: 'todo',
      collectionName: 'app_todo_todos',
      action: 'update',
      record: { id: 'task-1' },
    });

    expect(event.type).toBe('STATE_DELTA');
    expect(event.summary).toBe('app_todo_todos update');
  });
});

describe('AgentEventRouter policies', () => {
  it('records state-only events without notifying the agent', async () => {
    const task = createTask();
    const router = new AgentEventRouter();
    router.setWorkerTaskManager(createTaskManager(task));

    await router.route({ appId: 'todo', conversationId: 'conv-1', type: 'STATE_DELTA' }, 'state-only');

    expect(router.getEventLog()).toHaveLength(1);
    expect(task.sendMessage).not.toHaveBeenCalled();
  });

  it('queues next-turn summaries and clears them after consumption', async () => {
    const router = new AgentEventRouter();
    await router.route(
      { appId: 'todo', conversationId: 'conv-1', type: 'CUSTOM', summary: 'TODO created' },
      'next-turn'
    );

    expect(router.consumeNextTurnSummary('conv-1')).toContain('TODO created');
    expect(router.consumeNextTurnSummary('conv-1')).toBe('');
  });

  it('sends immediate events as hidden silent agent messages when the agent is idle', async () => {
    const task = createTask('finished');
    const router = new AgentEventRouter();
    router.setWorkerTaskManager(createTaskManager(task));

    await router.route(
      { appId: 'todo', conversationId: 'conv-1', type: 'CUSTOM', summary: 'User requested replanning' },
      'immediate'
    );

    expect(task.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        hidden: true,
        silent: true,
      })
    );
  });

  it('coalesces immediate events into the next turn when the agent is busy', async () => {
    const task = createTask('running');
    const router = new AgentEventRouter();
    router.setWorkerTaskManager(createTaskManager(task));

    await router.route({ appId: 'todo', conversationId: 'conv-1', type: 'CUSTOM', summary: 'Busy event' }, 'immediate');

    expect(task.sendMessage).not.toHaveBeenCalled();
    expect(router.consumeNextTurnSummary('conv-1')).toContain('Busy event');
  });
});
