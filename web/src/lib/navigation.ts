import { useEffect, useState } from 'react';

export const pages = [
  { id: 'overview', label: 'Overview', icon: 'O' },
  { id: 'jobs', label: 'Jobs', icon: 'J' },
  { id: 'discover', label: 'Discover', icon: '+' },
  { id: 'tasks', label: 'Tasks', icon: 'T' },
  { id: 'cost', label: 'Cost', icon: '$' },
  { id: 'providers', label: 'Providers', icon: 'P' },
  { id: 'service', label: 'Service', icon: 'S' },
] as const;

export type PageId = (typeof pages)[number]['id'];

export function usePage(): [PageId, string | null, (page: PageId) => void] {
  const parse = (): { page: PageId; jobId: string | null } => {
    const route = location.hash.slice(1).replace(/^\//, '');
    const workspace = /^jobs\/([^/?#]+)$/.exec(route);
    if (workspace) return { page: 'jobs', jobId: workspace[1] };
    return {
      page: pages.some(page => page.id === route) ? (route as PageId) : 'overview',
      jobId: null,
    };
  };
  const [{ page, jobId }, setPage] = useState(parse);
  useEffect(() => {
    const onHash = () => setPage(parse());
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    if (!location.hash) location.hash = '/overview';
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, []);
  return [
    page,
    jobId,
    next => {
      location.hash = `/${next}`;
    },
  ];
}
