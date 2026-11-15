import { useEffect, useRef, type KeyboardEvent } from 'react';

// Keyboard users keep their place: the editor's first control takes focus when it opens (via
// autoFocus) and the Edit button takes it back when the editor closes.
export function useReturnFocus(open: boolean) {
  const button = useRef<HTMLButtonElement | null>(null);
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !open) button.current?.focus();
    was.current = open;
  }, [open]);
  return button;
}

/** The stored reason: the chosen label, with the typed detail after it (or alone for Other). */

export function useLeaveGuard(dirty: boolean, message: string) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const clicks = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!link || link.getAttribute('target') === '_blank') return;
      const href = link.getAttribute('href') ?? '';
      if (!href.startsWith('#') && !href.startsWith('?') && !href.startsWith('/#')) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', clicks, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', clicks, true);
    };
  }, [dirty, message]);
}

export function trapTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return;
  const controls = event.currentTarget.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  const first = controls.item(0);
  const last = controls.item(controls.length - 1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
