import { useEffect, useRef, useState } from 'react';

export type WorkspacePanel = 'actions' | 'status' | 'history' | 'letter';

/** Which slide-out is open, the rail buttons that focus returns to, and the outside-press close. */
export function useWorkspacePanels() {
  const [openPanel, setOpenPanel] = useState<WorkspacePanel | null>(null);
  const railButtons = useRef<Partial<Record<WorkspacePanel, HTMLButtonElement | null>>>({});
  // F26: a primary-button press anywhere outside the open slide-out closes it. The panel, the rail
  // (its buttons toggle themselves), the divider and any dialog opened from the panel are inside.
  useEffect(() => {
    if (!openPanel) return;
    const key = openPanel;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest('.ws-panel, .ws-rail, .ws-divider, dialog')) return;
      // Focus goes back to the rail button unless the press landed on something interactive.
      const interactive = event.target.closest(
        'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), dialog',
      );
      setOpenPanel(null);
      if (!interactive) window.requestAnimationFrame(() => railButtons.current[key]?.focus());
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [openPanel]);
  const toggle = (key: WorkspacePanel) => setOpenPanel(openPanel === key ? null : key);
  const closePanel = (key: WorkspacePanel) => {
    railButtons.current[key]?.focus();
    setOpenPanel(null);
  };
  return { openPanel, setOpenPanel, railButtons, toggle, closePanel };
}
