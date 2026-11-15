import { useEffect, useRef, type ReactNode } from 'react';

// A slide-out panel. It stays mounted while closed (hidden), so unsaved edits, drafts and run state
// inside it survive closing and reopening. While open it takes focus, keeps Tab inside, and closes on
// Escape unless a modal dialog started from inside it is on top.
export function SlidePanel({
  id,
  title,
  open,
  onClose,
  children,
  solo = false,
}: {
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** No tool rail beside it (the Jobs page), so it reaches the right edge. */
  solo?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  // F25: the slide-out starts at the bottom edge of the top bar (which scrolls with the page below
  // 1024 px) and ends at the bottom of the viewport, so the bar stays usable.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const bar = document.querySelector<HTMLElement>('.ws-bar, .topbar');
      const top = bar ? Math.max(0, Math.round(bar.getBoundingClientRect().bottom)) : 0;
      if (ref.current) ref.current.style.top = `${top}px`;
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);
  useEffect(() => {
    if (open && !wasOpen.current)
      ref.current?.querySelector<HTMLElement>('.ws-panel-close')?.focus();
    wasOpen.current = open;
  }, [open]);
  return (
    <section
      ref={ref}
      id={id}
      className={solo ? 'ws-panel ws-panel-solo' : 'ws-panel'}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      hidden={!open}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          if (document.querySelector('dialog[open]')) return;
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(element => element.offsetParent !== null);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className="ws-panel-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <button type="button" className="quiet-button ws-panel-close" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="ws-panel-body">{children}</div>
    </section>
  );
}
