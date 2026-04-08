/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type SkillAppBackendProvider = 'pocketbase';

export type SkillAppEventPolicy = 'state-only' | 'next-turn' | 'immediate';

export type SkillAppRuntimeState = 'starting' | 'ready' | 'stopping' | 'stopped' | 'error';

export type SkillAppAguiEventType =
  | 'STATE_SNAPSHOT'
  | 'STATE_DELTA'
  | 'CUSTOM'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_END'
  | 'RUN_STARTED'
  | 'RUN_FINISHED'
  | 'RUN_ERROR';

export type SkillAppManifest = {
  id: string;
  displayName: string;
  description?: string;
  skill: {
    name: string;
    file?: string;
    description?: string;
  };
  frontend: {
    entrypoint: string;
    directory?: string;
  };
  backend: {
    provider: SkillAppBackendProvider;
    migrationsDir?: string;
    collectionPrefix?: string;
  };
  preview?: {
    title?: string;
  };
  activation?: {
    openOnLoad?: boolean;
    idleTimeoutMs?: number;
  };
  events?: {
    defaultPolicy?: SkillAppEventPolicy;
  };
};

export type SkillAppInfo = {
  id: string;
  displayName: string;
  description?: string;
  skillName: string;
  backendProvider: SkillAppBackendProvider;
  previewTitle: string;
  openOnLoad: boolean;
  runtimeStatus?: SkillAppRuntimeStatus | null;
};

export type SkillAppListRequest = {
  workspace?: string;
  conversationId?: string;
};

export type SkillAppOpenRequest = {
  appId: string;
  conversationId?: string;
  workspace?: string;
};

export type SkillAppResolveBundleRequest = {
  appId: string;
};

export type SkillAppStopRequest = {
  appId: string;
  workspace?: string;
  conversationId?: string;
};

export type SkillAppVisibilityRequest = {
  appId: string;
  workspace?: string;
  conversationId?: string;
  visible: boolean;
};

export type SkillAppOpenResult = {
  success: boolean;
  appId: string;
  url?: string;
  msg?: string;
};

export type SkillAppResolveBundleResult = {
  success: boolean;
  appId: string;
  bundleRoot?: string;
  msg?: string;
};

export type SkillAppRuntimeStatus = {
  appId: string;
  state: SkillAppRuntimeState;
  message?: string;
  url?: string;
  workspace?: string;
  conversationId?: string;
  visible?: boolean;
  updatedAt: number;
};

export type SkillAppAguiEvent = {
  id: string;
  type: SkillAppAguiEventType;
  timestamp: number;
  appId: string;
  conversationId?: string;
  workspace?: string;
  payload: unknown;
  summary?: string;
};

export type SkillAppEventInput = {
  appId: string;
  conversationId?: string;
  workspace?: string;
  type: SkillAppAguiEventType | string;
  policy?: SkillAppEventPolicy;
  payload?: unknown;
  summary?: string;
};
