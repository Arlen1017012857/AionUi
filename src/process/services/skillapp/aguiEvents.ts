/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { SkillAppAguiEvent, SkillAppAguiEventType, SkillAppEventInput } from '@/common/types/skillapp';

const AGUI_EVENT_TYPES = new Set<SkillAppAguiEventType>([
  'STATE_SNAPSHOT',
  'STATE_DELTA',
  'CUSTOM',
  'TOOL_CALL_START',
  'TOOL_CALL_END',
  'RUN_STARTED',
  'RUN_FINISHED',
  'RUN_ERROR',
]);

export type PocketBaseRealtimeRecordEvent = {
  appId: string;
  conversationId?: string;
  workspace?: string;
  collectionName: string;
  action: 'create' | 'update' | 'delete';
  record?: unknown;
};

export function normalizeSkillAppEvent(input: SkillAppEventInput): SkillAppAguiEvent {
  return {
    id: randomUUID(),
    type: normalizeAguiType(input.type),
    timestamp: Date.now(),
    appId: input.appId,
    conversationId: input.conversationId,
    workspace: input.workspace,
    payload: input.payload ?? {},
    summary: input.summary || createSummary(input),
  };
}

export function normalizePocketBaseRealtimeEvent(input: PocketBaseRealtimeRecordEvent): SkillAppAguiEvent {
  return normalizeSkillAppEvent({
    appId: input.appId,
    conversationId: input.conversationId,
    workspace: input.workspace,
    type: 'STATE_DELTA',
    payload: {
      collectionName: input.collectionName,
      action: input.action,
      record: input.record,
    },
    summary: `${input.collectionName} ${input.action}`,
  });
}

function normalizeAguiType(value: SkillAppAguiEventType | string): SkillAppAguiEventType {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return AGUI_EVENT_TYPES.has(normalized as SkillAppAguiEventType) ? (normalized as SkillAppAguiEventType) : 'CUSTOM';
}

function createSummary(input: SkillAppEventInput): string {
  const type = normalizeAguiType(input.type);
  const payload = input.payload;
  if (payload && typeof payload === 'object' && 'action' in payload && typeof payload.action === 'string') {
    return `${input.appId}: ${payload.action}`;
  }
  return `${input.appId}: ${type}`;
}
