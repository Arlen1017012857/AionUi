/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { SkillAppAguiEvent, SkillAppEventInput, SkillAppEventPolicy } from '@/common/types/skillapp';
import type { IWorkerTaskManager } from '@process/task/IWorkerTaskManager';
import { normalizeSkillAppEvent } from './aguiEvents';

type QueuedConversationEvents = Map<string, SkillAppAguiEvent[]>;

export class AgentEventRouter {
  private workerTaskManager: IWorkerTaskManager | undefined;
  private readonly eventLog: SkillAppAguiEvent[] = [];
  private readonly nextTurnEvents: QueuedConversationEvents = new Map();
  private readonly pendingImmediateEvents: QueuedConversationEvents = new Map();

  setWorkerTaskManager(workerTaskManager: IWorkerTaskManager): void {
    this.workerTaskManager = workerTaskManager;
  }

  async route(
    input: SkillAppEventInput,
    fallbackPolicy: SkillAppEventPolicy = 'state-only'
  ): Promise<SkillAppAguiEvent> {
    const event = normalizeSkillAppEvent(input);
    const policy = input.policy ?? fallbackPolicy;
    this.record(event);

    if (!event.conversationId) {
      return event;
    }

    if (policy === 'next-turn') {
      this.queue(this.nextTurnEvents, event.conversationId, event);
      return event;
    }

    if (policy === 'immediate') {
      const delivered = await this.deliverImmediate(event);
      if (!delivered) {
        this.queue(this.pendingImmediateEvents, event.conversationId, event);
      }
    }

    return event;
  }

  consumeNextTurnSummary(conversationId: string): string {
    const nextTurn = this.nextTurnEvents.get(conversationId) ?? [];
    const queuedImmediate = this.pendingImmediateEvents.get(conversationId) ?? [];
    const events = [...nextTurn, ...queuedImmediate];
    this.nextTurnEvents.delete(conversationId);
    this.pendingImmediateEvents.delete(conversationId);

    return summarizeEvents(events);
  }

  async flushQueuedImmediate(conversationId: string): Promise<number> {
    const events = this.pendingImmediateEvents.get(conversationId) ?? [];
    if (events.length === 0) return 0;

    const deliveryResults = await Promise.all(events.map((event) => this.deliverImmediate(event)));
    const remaining = events.filter((_event, index) => !deliveryResults[index]);
    const deliveredCount = deliveryResults.filter(Boolean).length;

    if (remaining.length > 0) {
      this.pendingImmediateEvents.set(conversationId, remaining);
    } else {
      this.pendingImmediateEvents.delete(conversationId);
    }

    return deliveredCount;
  }

  getEventLog(): SkillAppAguiEvent[] {
    return [...this.eventLog];
  }

  clear(): void {
    this.eventLog.splice(0, this.eventLog.length);
    this.nextTurnEvents.clear();
    this.pendingImmediateEvents.clear();
  }

  private record(event: SkillAppAguiEvent): void {
    this.eventLog.push(event);
    if (this.eventLog.length > 500) {
      this.eventLog.splice(0, this.eventLog.length - 500);
    }
  }

  private queue(store: QueuedConversationEvents, conversationId: string, event: SkillAppAguiEvent): void {
    const events = store.get(conversationId) ?? [];
    events.push(event);
    store.set(conversationId, events.slice(-20));
  }

  private async deliverImmediate(event: SkillAppAguiEvent): Promise<boolean> {
    if (!event.conversationId || !this.workerTaskManager) return false;
    const task = this.workerTaskManager.getTask(event.conversationId);
    if (!task || task.status === 'running') return false;

    const content = `[SkillApp Event]\n${summarizeEvents([event])}`;
    try {
      await task.sendMessage({
        input: content,
        content,
        msg_id: randomUUID(),
        hidden: true,
        silent: true,
      });
      return true;
    } catch (error) {
      console.warn('[AgentEventRouter] Failed to deliver immediate SkillApp event:', error);
      return false;
    }
  }
}

export function summarizeEvents(events: SkillAppAguiEvent[]): string {
  if (events.length === 0) return '';
  return events
    .map((event) => {
      const base = event.summary || `${event.appId}: ${event.type}`;
      return `- ${base}`;
    })
    .join('\n');
}

export const agentEventRouter = new AgentEventRouter();
