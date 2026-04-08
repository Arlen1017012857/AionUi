/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export { SkillAppRuntime, skillAppRuntime } from './SkillAppRuntime';
export {
  SkillAppRegistry,
  getDefaultBuiltinSkillAppRoots,
  getDefaultManagedSkillAppsRoot,
  getDefaultTemplateSkillAppRoots,
} from './SkillAppRegistry';
export { PocketBaseProvider, pocketBaseProvider, extractCollectionNameFromPocketBasePath } from './PocketBaseProvider';
export { AgentEventRouter, agentEventRouter, summarizeEvents } from './AgentEventRouter';
export {
  parseSkillAppManifest,
  toPocketBaseCollectionPrefix,
  isCollectionOwnedByApp,
  type ResolvedSkillApp,
  type SkillAppSource,
} from './manifest';
export { normalizeSkillAppEvent, normalizePocketBaseRealtimeEvent } from './aguiEvents';
