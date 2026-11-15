import type { MutableRefObject } from 'react';
import type { WorkspacePanel } from './useWorkspacePanels';

/** The rail at the right edge: one toggle button per slide-out. */
export function ToolRail({
  statusLabel,
  showActions,
  openPanel,
  railButtons,
  onToggle,
}: {
  statusLabel: string;
  showActions: boolean;
  openPanel: WorkspacePanel | null;
  railButtons: MutableRefObject<Partial<Record<WorkspacePanel, HTMLButtonElement | null>>>;
  onToggle: (key: WorkspacePanel) => void;
}) {
  const railItems: { key: WorkspacePanel; label: string; icon: string; show: boolean }[] = [
    { key: 'actions', label: 'Actions', icon: '▶', show: showActions },
    { key: 'status', label: statusLabel, icon: '✎', show: true },
    { key: 'history', label: 'History', icon: '↺', show: true },
    { key: 'letter', label: 'Letter', icon: '✉', show: true },
  ];
  return (
    <nav className="ws-rail" aria-label="Job tools">
      {railItems
        .filter(item => item.show)
        .map(item => (
          <button
            key={item.key}
            type="button"
            ref={element => {
              railButtons.current[item.key] = element;
            }}
            className="ws-rail-button"
            aria-expanded={openPanel === item.key}
            aria-controls={`ws-panel-${item.key}`}
            onClick={() => onToggle(item.key)}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
    </nav>
  );
}
