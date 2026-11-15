import { useEffect, useState } from 'react';

export type HeaderAction = 'cv' | 'letter' | 'publish';

/**
 * The draft and publish buttons in the header bar do not start runs themselves: they send a
 * request to the Actions panel, which owns the dialogs, and show "Drafting…" until the run is seen.
 */
export function useHeaderActions() {
  const [request, setRequest] = useState<{ key: HeaderAction; n: number }>({ key: 'cv', n: 0 });
  const [issue, setIssue] = useState<string | null>(null);
  const [active, setActive] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    if (pending === null) return;
    const timer = window.setTimeout(() => setPending(null), 4000);
    return () => window.clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (pending !== null && active.includes(pending)) setPending(null);
  }, [active, pending]);
  const ask = (key: HeaderAction) => {
    setIssue(null);
    if (key !== 'publish') setPending(key);
    setRequest(previous => ({ key, n: previous.n + 1 }));
  };
  return { request, issue, setIssue, active, setActive, pending, setPending, ask };
}

export type HeaderActions = ReturnType<typeof useHeaderActions>;
