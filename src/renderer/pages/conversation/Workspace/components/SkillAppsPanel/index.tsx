/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SkillAppInfo, SkillAppRuntimeStatus } from '@/common/types/skillapp';
import { Badge, Button, Empty, Spin } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import type { TFunction } from 'i18next';
import React from 'react';
import type { MessageApi } from '../../types';
import { useSkillAppsState } from './useSkillAppsState';

type SkillAppsPanelProps = {
  t: TFunction;
  workspace: string;
  conversationId: string;
  messageApi?: MessageApi;
  closePreviewByIdentity: (
    type: 'url',
    content?: string,
    metadata?: {
      title?: string;
      fileName?: string;
      skillAppId?: string;
      conversationId?: string;
      workspace?: string;
    }
  ) => void;
};

type SkillAppUiStatus = {
  badgeStatus: 'default' | 'processing' | 'success' | 'warning' | 'error';
  label: string;
  canStop: boolean;
};

function getSkillAppUiStatus(t: TFunction, runtimeStatus?: SkillAppRuntimeStatus | null): SkillAppUiStatus {
  if (!runtimeStatus || runtimeStatus.state === 'stopped') {
    return {
      badgeStatus: 'default',
      label: t('conversation.workspace.skillApps.status.available'),
      canStop: false,
    };
  }

  if (runtimeStatus.state === 'starting') {
    return {
      badgeStatus: 'processing',
      label: t('conversation.workspace.skillApps.status.starting'),
      canStop: true,
    };
  }

  if (runtimeStatus.state === 'error') {
    return {
      badgeStatus: 'error',
      label: t('conversation.workspace.skillApps.status.error'),
      canStop: false,
    };
  }

  if (runtimeStatus.visible) {
    return {
      badgeStatus: 'success',
      label: t('conversation.workspace.skillApps.status.open'),
      canStop: true,
    };
  }

  return {
    badgeStatus: 'warning',
    label: t('conversation.workspace.skillApps.status.running'),
    canStop: true,
  };
}

function SkillAppCard({
  app,
  t,
  opening,
  openingBundle,
  stopping,
  onOpen,
  onOpenBundle,
  onStop,
}: {
  app: SkillAppInfo;
  t: TFunction;
  opening: boolean;
  openingBundle: boolean;
  stopping: boolean;
  onOpen: () => void;
  onOpenBundle: () => void;
  onStop: () => void;
}) {
  const status = getSkillAppUiStatus(t, app.runtimeStatus);

  return (
    <div className='border border-base rounded-10px p-12px bg-bg-2 flex flex-col gap-10px'>
      <div className='min-w-0'>
        <div className='flex items-start gap-8px flex-wrap'>
          <span className='font-semibold text-14px text-t-primary break-words leading-5'>{app.displayName}</span>
          <Badge status={status.badgeStatus} text={status.label} />
        </div>
        {app.description && (
          <div className='text-12px text-t-secondary mt-6px break-words leading-5'>{app.description}</div>
        )}
        <div className='text-12px text-t-tertiary mt-8px flex items-center gap-12px flex-wrap leading-5'>
          <span>
            {t('conversation.workspace.skillApps.skillLabel')}: {app.skillName}
          </span>
          <span>
            {t('conversation.workspace.skillApps.backendLabel')}: {app.backendProvider}
          </span>
        </div>
      </div>
      <div className='flex items-center justify-end gap-8px flex-wrap'>
        <Button
          size='small'
          type='outline'
          loading={openingBundle}
          disabled={opening || stopping}
          onClick={onOpenBundle}
        >
          {t('conversation.workspace.skillApps.openBundle')}
        </Button>
        <Button type='primary' size='small' loading={opening} disabled={stopping} onClick={onOpen}>
          {t('conversation.workspace.skillApps.open')}
        </Button>
        <Button size='small' status='danger' disabled={!status.canStop || opening} loading={stopping} onClick={onStop}>
          {t('conversation.workspace.skillApps.stop')}
        </Button>
      </div>
    </div>
  );
}

const SkillAppsPanel: React.FC<SkillAppsPanelProps> = ({
  t,
  workspace,
  conversationId,
  messageApi,
  closePreviewByIdentity,
}) => {
  const {
    apps,
    loading,
    refreshing,
    openingAppId,
    openingBundleAppId,
    stoppingAppId,
    error,
    refreshApps,
    openSkillApp,
    openSkillAppBundle,
    stopSkillApp,
  } = useSkillAppsState({
    t,
    workspace,
    conversationId,
    messageApi,
    closePreviewByIdentity,
  });

  if (loading) {
    return (
      <div className='flex-1 size-full flex items-center justify-center'>
        <Spin />
      </div>
    );
  }

  if (apps.length === 0) {
    return (
      <div className='flex-1 size-full flex items-center justify-center px-12px'>
        <Empty
          description={
            <div>
              <div className='text-t-secondary font-bold text-14px'>{t('conversation.workspace.skillApps.empty')}</div>
              <div className='text-t-secondary'>{t('conversation.workspace.skillApps.emptyDescription')}</div>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className='flex flex-col size-full'>
      <div className='px-12px py-10px border-b border-b-base flex items-center justify-between gap-12px'>
        <div className='min-w-0'>
          <div className='font-semibold text-14px text-t-primary'>{t('conversation.workspace.skillApps.title')}</div>
          <div className='text-12px text-t-secondary'>{error || t('conversation.workspace.skillApps.description')}</div>
        </div>
        <Button
          size='small'
          type='outline'
          icon={<Refresh size={14} />}
          loading={refreshing}
          onClick={() => void refreshApps()}
        >
          {t('conversation.workspace.skillApps.refresh')}
        </Button>
      </div>

      <div className='flex-1 overflow-y-auto p-12px flex flex-col gap-10px'>
        {apps.map((app) => (
          <SkillAppCard
            key={app.id}
            app={app}
            t={t}
            opening={openingAppId === app.id}
            openingBundle={openingBundleAppId === app.id}
            stopping={stoppingAppId === app.id}
            onOpen={() => void openSkillApp(app)}
            onOpenBundle={() => void openSkillAppBundle(app)}
            onStop={() => void stopSkillApp(app)}
          />
        ))}
      </div>
    </div>
  );
};

export default SkillAppsPanel;
