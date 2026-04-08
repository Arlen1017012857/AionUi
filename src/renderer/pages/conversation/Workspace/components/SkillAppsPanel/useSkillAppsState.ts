/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { PreviewContentType } from '@/common/types/preview';
import type { SkillAppInfo, SkillAppRuntimeStatus } from '@/common/types/skillapp';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MessageApi } from '../../types';

type ClosePreviewByIdentity = (
  type: PreviewContentType,
  content?: string,
  metadata?: {
    title?: string;
    fileName?: string;
    skillAppId?: string;
    conversationId?: string;
    workspace?: string;
  }
) => void;

type UseSkillAppsStateOptions = {
  t: TFunction;
  workspace: string;
  conversationId: string;
  messageApi?: MessageApi;
  closePreviewByIdentity: ClosePreviewByIdentity;
};

type UseSkillAppsStateResult = {
  apps: SkillAppInfo[];
  loading: boolean;
  refreshing: boolean;
  openingAppId: string | null;
  openingBundleAppId: string | null;
  stoppingAppId: string | null;
  error: string | null;
  refreshApps: () => Promise<void>;
  openSkillApp: (app: SkillAppInfo) => Promise<void>;
  openSkillAppBundle: (app: SkillAppInfo) => Promise<void>;
  stopSkillApp: (app: SkillAppInfo) => Promise<void>;
};

function matchesRuntimeContext(status: SkillAppRuntimeStatus, workspace: string, conversationId: string): boolean {
  return (status.workspace || '') === workspace && (status.conversationId || '') === conversationId;
}

function applyRuntimeStatus(
  apps: SkillAppInfo[],
  status: SkillAppRuntimeStatus,
  workspace: string,
  conversationId: string
): SkillAppInfo[] {
  if (!matchesRuntimeContext(status, workspace, conversationId)) {
    return apps;
  }

  return apps.map((app) => (app.id === status.appId ? { ...app, runtimeStatus: status } : app));
}

export function useSkillAppsState({
  t,
  workspace,
  conversationId,
  messageApi,
  closePreviewByIdentity,
}: UseSkillAppsStateOptions): UseSkillAppsStateResult {
  const [apps, setApps] = useState<SkillAppInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openingAppId, setOpeningAppId] = useState<string | null>(null);
  const [openingBundleAppId, setOpeningBundleAppId] = useState<string | null>(null);
  const [stoppingAppId, setStoppingAppId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadApps = useCallback(
    async (source: 'initial' | 'manual' | 'action' = 'manual') => {
      if (source === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        const result = await ipcBridge.skillApp.list.invoke({ workspace, conversationId });
        setApps(result);
      } catch (loadError) {
        const message =
          loadError instanceof Error ? loadError.message : t('conversation.workspace.skillApps.loadFailed');
        setError(message);
        messageApi?.error(
          source === 'manual' || source === 'action' ? message : t('conversation.workspace.skillApps.loadFailed')
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [conversationId, messageApi, t, workspace]
  );

  useEffect(() => {
    void loadApps('initial');
  }, [loadApps]);

  useEffect(() => {
    return ipcBridge.skillApp.status.on((status) => {
      setApps((prev) => applyRuntimeStatus(prev, status, workspace, conversationId));
    });
  }, [conversationId, workspace]);

  const openSkillApp = useCallback(
    async (app: SkillAppInfo) => {
      setOpeningAppId(app.id);
      try {
        const result = await ipcBridge.skillApp.open.invoke({
          appId: app.id,
          workspace,
          conversationId,
        });
        if (!result.success) {
          messageApi?.error(result.msg || t('conversation.workspace.skillApps.openFailed'));
        }
        await loadApps('action');
      } catch (openError) {
        const message =
          openError instanceof Error ? openError.message : t('conversation.workspace.skillApps.openFailed');
        messageApi?.error(message);
      } finally {
        setOpeningAppId(null);
      }
    },
    [conversationId, loadApps, messageApi, t, workspace]
  );

  const stopSkillApp = useCallback(
    async (app: SkillAppInfo) => {
      setStoppingAppId(app.id);
      try {
        const targetUrl = app.runtimeStatus?.url;
        await ipcBridge.skillApp.stop.invoke({
          appId: app.id,
          workspace,
          conversationId,
        });
        closePreviewByIdentity('url', targetUrl, {
          title: app.previewTitle,
          fileName: app.displayName,
          skillAppId: app.id,
          conversationId,
          workspace,
        });
        await loadApps('action');
      } catch (stopError) {
        const message =
          stopError instanceof Error ? stopError.message : t('conversation.workspace.skillApps.stopFailed');
        messageApi?.error(message);
      } finally {
        setStoppingAppId(null);
      }
    },
    [closePreviewByIdentity, conversationId, loadApps, messageApi, t, workspace]
  );

  const openSkillAppBundle = useCallback(
    async (app: SkillAppInfo) => {
      setOpeningBundleAppId(app.id);
      try {
        const result = await ipcBridge.skillApp.resolveBundle.invoke({ appId: app.id });
        if (!result.success || !result.bundleRoot) {
          messageApi?.error(result.msg || t('conversation.workspace.skillApps.openBundleFailed'));
          return;
        }

        await ipcBridge.shell.openFolderWith.invoke({
          folderPath: result.bundleRoot,
          tool: 'explorer',
        });
      } catch (openError) {
        const message =
          openError instanceof Error ? openError.message : t('conversation.workspace.skillApps.openBundleFailed');
        messageApi?.error(message);
      } finally {
        setOpeningBundleAppId(null);
      }
    },
    [messageApi, t]
  );

  return useMemo(
    () => ({
      apps,
      loading,
      refreshing,
      openingAppId,
      openingBundleAppId,
      stoppingAppId,
      error,
      refreshApps: () => loadApps('manual'),
      openSkillApp,
      openSkillAppBundle,
      stopSkillApp,
    }),
    [
      apps,
      error,
      loadApps,
      loading,
      openSkillApp,
      openSkillAppBundle,
      openingAppId,
      openingBundleAppId,
      refreshing,
      stopSkillApp,
      stoppingAppId,
    ]
  );
}
