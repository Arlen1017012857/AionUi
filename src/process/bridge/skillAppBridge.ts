/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { skillAppRuntime } from '@process/services/skillapp';
import type { IWorkerTaskManager } from '@process/task/IWorkerTaskManager';

export function initSkillAppBridge(workerTaskManager: IWorkerTaskManager): void {
  skillAppRuntime.setWorkerTaskManager(workerTaskManager);

  ipcBridge.skillApp.list.provider(async (request) => {
    return skillAppRuntime.listApps(request ?? {});
  });

  ipcBridge.skillApp.resolveBundle.provider(async (request) => {
    return skillAppRuntime.resolveBundle(request);
  });

  ipcBridge.skillApp.open.provider(async (request) => {
    return skillAppRuntime.openApp(request);
  });

  ipcBridge.skillApp.stop.provider(async ({ appId, workspace, conversationId }) => {
    skillAppRuntime.stopApp(appId, workspace, conversationId);
  });

  ipcBridge.skillApp.setVisibility.provider(async (request) => {
    skillAppRuntime.markVisibility(request);
  });

  ipcBridge.skillApp.emitEvent.provider(async (event) => {
    await skillAppRuntime.emitEvent(event);
  });
}
