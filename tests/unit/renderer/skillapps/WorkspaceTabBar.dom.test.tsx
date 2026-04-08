import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@arco-design/web-react', () => ({
  Badge: ({ count }: { count?: number }) => <span>{count}</span>,
  Dropdown: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tabs: Object.assign(
    ({
      children,
      activeTab,
      onChange,
    }: {
      children: React.ReactNode;
      activeTab: string;
      onChange: (key: string) => void;
    }) => (
      <div>
        {React.Children.map(children, (child) =>
          React.isValidElement(child)
            ? React.cloneElement(child as React.ReactElement<{ active?: boolean; onSelect?: () => void }>, {
                active: String(child.key).replace(/^\.\$/, '') === activeTab,
                onSelect: () => onChange(String(child.key).replace(/^\.\$/, '')),
              })
            : child
        )}
      </div>
    ),
    {
      TabPane: ({ title, active, onSelect }: { title: React.ReactNode; active?: boolean; onSelect?: () => void }) => (
        <button aria-pressed={active} onClick={onSelect} type='button'>
          {title}
        </button>
      ),
    }
  ),
}));

vi.mock('@icon-park/react', () => ({
  BranchOne: () => <span />,
  CheckSmall: () => <span />,
  Down: () => <span />,
  Right: () => <span />,
}));

import WorkspaceTabBar from '@/renderer/pages/conversation/Workspace/components/WorkspaceTabBar';

describe('WorkspaceTabBar', () => {
  it('shows the SkillApps tab and switches to it', () => {
    const handleTabChange = vi.fn();
    const t = (key: string) =>
      (
        ({
          'conversation.workspace.changes.filesTab': 'Files',
          'conversation.workspace.changes.tab': 'Changes',
          'conversation.workspace.skillApps.tab': 'SkillApps',
        }) as Record<string, string>
      )[key] || key;

    render(
      <WorkspaceTabBar
        t={t as never}
        activeTab='files'
        onTabChange={handleTabChange}
        changeCount={2}
        branch={null}
        branches={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'SkillApps' }));

    expect(screen.getByRole('button', { name: 'SkillApps' })).toBeInTheDocument();
    expect(handleTabChange).toHaveBeenCalledWith('skillapps');
  });
});
