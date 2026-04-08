import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListInvoke,
  mockResolveBundleInvoke,
  mockOpenInvoke,
  mockStopInvoke,
  mockOpenFolderWithInvoke,
  mockStatusOn,
  mockStatusOff,
} = vi.hoisted(() => ({
  mockListInvoke: vi.fn(),
  mockResolveBundleInvoke: vi.fn(),
  mockOpenInvoke: vi.fn(),
  mockStopInvoke: vi.fn(),
  mockOpenFolderWithInvoke: vi.fn(),
  mockStatusOn: vi.fn(),
  mockStatusOff: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    skillApp: {
      list: {
        invoke: (...args: unknown[]) => mockListInvoke(...args),
      },
      resolveBundle: {
        invoke: (...args: unknown[]) => mockResolveBundleInvoke(...args),
      },
      open: {
        invoke: (...args: unknown[]) => mockOpenInvoke(...args),
      },
      stop: {
        invoke: (...args: unknown[]) => mockStopInvoke(...args),
      },
      status: {
        on: (listener: (...args: unknown[]) => void) => {
          mockStatusOn(listener);
          return () => mockStatusOff();
        },
      },
    },
    shell: {
      openFolderWith: {
        invoke: (...args: unknown[]) => mockOpenFolderWithInvoke(...args),
      },
    },
  },
}));

vi.mock('@arco-design/web-react', () => ({
  Badge: ({ text }: { text: React.ReactNode }) => <span>{text}</span>,
  Button: ({
    children,
    onClick,
    disabled,
    loading,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
  }) => (
    <button type='button' disabled={disabled || loading} onClick={onClick}>
      {children}
    </button>
  ),
  Empty: ({ description }: { description: React.ReactNode }) => <div>{description}</div>,
  Spin: () => <div>Loading</div>,
}));

vi.mock('@icon-park/react', () => ({
  Refresh: () => <span />,
}));

import SkillAppsPanel from '@/renderer/pages/conversation/Workspace/components/SkillAppsPanel';

const translations: Record<string, string> = {
  'conversation.workspace.skillApps.title': 'SkillApps',
  'conversation.workspace.skillApps.description': 'Open and manage SkillApps for this workspace.',
  'conversation.workspace.skillApps.empty': 'No SkillApps available',
  'conversation.workspace.skillApps.emptyDescription': 'Discovered SkillApps will appear here.',
  'conversation.workspace.skillApps.refresh': 'Refresh',
  'conversation.workspace.skillApps.openBundle': 'Open Bundle',
  'conversation.workspace.skillApps.open': 'Open',
  'conversation.workspace.skillApps.stop': 'Stop',
  'conversation.workspace.skillApps.skillLabel': 'Skill',
  'conversation.workspace.skillApps.backendLabel': 'Backend',
  'conversation.workspace.skillApps.loadFailed': 'Failed to load SkillApps',
  'conversation.workspace.skillApps.openBundleFailed': 'Failed to open SkillApp bundle',
  'conversation.workspace.skillApps.openFailed': 'Failed to open SkillApp',
  'conversation.workspace.skillApps.stopFailed': 'Failed to stop SkillApp',
  'conversation.workspace.skillApps.status.available': 'Available',
  'conversation.workspace.skillApps.status.starting': 'Starting',
  'conversation.workspace.skillApps.status.open': 'Open',
  'conversation.workspace.skillApps.status.running': 'Running',
  'conversation.workspace.skillApps.status.error': 'Error',
};

const t = (key: string) => translations[key] || key;

describe('SkillAppsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads apps, opens them with workspace context, and closes preview on stop', async () => {
    const closePreviewByIdentity = vi.fn();
    mockListInvoke.mockResolvedValue([
      {
        id: 'todo',
        displayName: 'TODO',
        description: 'Manage tasks',
        skillName: 'todo',
        backendProvider: 'pocketbase',
        previewTitle: 'TODO',
        openOnLoad: true,
        runtimeStatus: {
          appId: 'todo',
          state: 'ready',
          workspace: '/workspace/demo',
          conversationId: 'conv-1',
          visible: false,
          url: 'http://127.0.0.1:53598/apps/todo/',
          updatedAt: 1,
        },
      },
    ]);
    mockResolveBundleInvoke.mockResolvedValue({
      success: true,
      appId: 'todo',
      bundleRoot: '/managed/apps/todo',
    });
    mockOpenInvoke.mockResolvedValue({ success: true, appId: 'todo', url: 'http://127.0.0.1:53598/apps/todo/' });
    mockStopInvoke.mockResolvedValue(undefined);
    mockOpenFolderWithInvoke.mockResolvedValue(undefined);

    render(
      <SkillAppsPanel
        t={t as never}
        workspace='/workspace/demo'
        conversationId='conv-1'
        messageApi={{ error: vi.fn() } as never}
        closePreviewByIdentity={closePreviewByIdentity}
      />
    );

    await waitFor(() => {
      expect(mockListInvoke).toHaveBeenCalledWith({
        workspace: '/workspace/demo',
        conversationId: 'conv-1',
      });
    });

    expect(screen.getByText('TODO')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Bundle' }));

    await waitFor(() => {
      expect(mockResolveBundleInvoke).toHaveBeenCalledWith({ appId: 'todo' });
      expect(mockOpenFolderWithInvoke).toHaveBeenCalledWith({
        folderPath: '/managed/apps/todo',
        tool: 'explorer',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(mockOpenInvoke).toHaveBeenCalledWith({
        appId: 'todo',
        workspace: '/workspace/demo',
        conversationId: 'conv-1',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => {
      expect(mockStopInvoke).toHaveBeenCalledWith({
        appId: 'todo',
        workspace: '/workspace/demo',
        conversationId: 'conv-1',
      });
      expect(closePreviewByIdentity).toHaveBeenCalledWith('url', 'http://127.0.0.1:53598/apps/todo/', {
        title: 'TODO',
        fileName: 'TODO',
        skillAppId: 'todo',
        conversationId: 'conv-1',
        workspace: '/workspace/demo',
      });
    });
  });

  it('reacts to live status updates from the runtime emitter', async () => {
    let statusListener: ((status: Record<string, unknown>) => void) | undefined;
    mockStatusOn.mockImplementation((listener) => {
      statusListener = listener as typeof statusListener;
    });
    mockListInvoke.mockResolvedValue([
      {
        id: 'todo',
        displayName: 'TODO',
        description: 'Manage tasks',
        skillName: 'todo',
        backendProvider: 'pocketbase',
        previewTitle: 'TODO',
        openOnLoad: true,
        runtimeStatus: null,
      },
    ]);

    render(
      <SkillAppsPanel
        t={t as never}
        workspace='/workspace/demo'
        conversationId='conv-1'
        messageApi={{ error: vi.fn() } as never}
        closePreviewByIdentity={vi.fn()}
      />
    );

    await screen.findByText('Available');

    statusListener?.({
      appId: 'todo',
      state: 'ready',
      workspace: '/workspace/demo',
      conversationId: 'conv-1',
      visible: true,
      updatedAt: Date.now(),
    });

    await waitFor(() => {
      expect(screen.getByText('Open')).toBeInTheDocument();
    });
  });
});
