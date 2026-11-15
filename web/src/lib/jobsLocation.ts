import { useEffect, useState } from 'react';
import type { JobsQuery } from '../generated/api';

const defaultJobsQuery: JobsQuery = {
  q: '',
  filter: 'all',
  sort: 'score',
  direction: 'desc',
  grouped: true,
  limit: 50,
};

function readJobsLocation() {
  const params = new URLSearchParams(location.search);
  const filters: JobsQuery['filter'][] = [
    'all',
    'pending',
    'evaluated',
    'applied',
    'interview',
    'ghosted',
    'top',
    'rejected',
    'discarded',
    'offer',
    'any',
  ];
  const sorts: JobsQuery['sort'][] = [
    'score',
    'statusDate',
    'addedDate',
    'company',
    'favorite',
    'yoe',
  ];
  const filter = filters.find(value => value === params.get('filter')) ?? defaultJobsQuery.filter;
  const sort = sorts.find(value => value === params.get('sort')) ?? defaultJobsQuery.sort;
  const direction =
    params.get('direction') === 'asc'
      ? 'asc'
      : params.get('direction') === 'desc'
        ? 'desc'
        : defaultJobsQuery.direction;
  const parsedLimit = Number(params.get('limit'));
  const query: JobsQuery = {
    q: params.get('q') ?? '',
    filter,
    sort,
    direction,
    grouped: params.get('grouped') === 'false' ? false : true,
    limit:
      Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 200 ? parsedLimit : 50,
  };
  const number = (name: string) => {
    const raw = params.get(name);
    if (raw === null || raw.trim() === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 5 ? value : undefined;
  };
  const scoreMin = number('scoreMin');
  const scoreMax = number('scoreMax');
  const addedWeek = params.get('addedWeek');
  if (scoreMin !== undefined) query.scoreMin = scoreMin;
  if (scoreMax !== undefined) query.scoreMax = scoreMax;
  if (addedWeek && /^\d{4}-W\d{2}$/.test(addedWeek)) query.addedWeek = addedWeek;
  if (params.get('favorite') === 'true') query.favorite = true;
  const yoeMax = params.get('yoeMax');
  if (yoeMax && /^[0-9]{1,2}$/.test(yoeMax) && Number(yoeMax) <= 40) {
    query.yoeMax = Number(yoeMax);
    // "Hide jobs with no estimate" only means something while a limit is set.
    if (params.get('yoeUnknown') === 'exclude') query.yoeUnknown = 'exclude';
  }
  const posting = params.get('posting');
  if (posting === 'expired' || posting === 'applied-closed') query.posting = posting;
  return { query, cursor: params.get('cursor') };
}

function writeJobsLocation(query: JobsQuery, cursor: string | null, mode: 'push' | 'replace') {
  const params = new URLSearchParams({
    q: query.q,
    filter: query.filter,
    sort: query.sort,
    direction: query.direction,
    grouped: String(query.grouped),
    limit: String(query.limit),
  });
  if (query.scoreMin !== undefined) params.set('scoreMin', String(query.scoreMin));
  if (query.scoreMax !== undefined) params.set('scoreMax', String(query.scoreMax));
  if (query.addedWeek) params.set('addedWeek', query.addedWeek);
  if (query.favorite) params.set('favorite', 'true');
  if (query.yoeMax !== undefined) params.set('yoeMax', String(query.yoeMax));
  if (query.yoeMax !== undefined && query.yoeUnknown) params.set('yoeUnknown', query.yoeUnknown);
  if (query.posting) params.set('posting', query.posting);
  if (cursor) params.set('cursor', cursor);
  const target = `${location.pathname}?${params.toString()}${location.hash}`;
  if (mode === 'push') history.pushState(null, '', target);
  else history.replaceState(null, '', target);
}

export function useJobsLocation() {
  const [state, setState] = useState(readJobsLocation);
  useEffect(() => {
    const sync = () => setState(readJobsLocation());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const update = (query: JobsQuery, cursor: string | null, mode: 'push' | 'replace' = 'push') => {
    writeJobsLocation(query, cursor, mode);
    setState({ query, cursor });
  };
  return [state, update] as const;
}

export const statusChips: { value: JobsQuery['filter']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'evaluated', label: 'Evaluated' },
  { value: 'applied', label: 'Applied' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'ghosted', label: 'Ghosted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'discarded', label: 'Discarded' },
  { value: 'top', label: 'Top' },
  { value: 'any', label: 'Everything' },
];

// scoreMin is inclusive and scoreMax exclusive, so the label shows the bucket's own range.
export function scoreFilterLabel(min: number | undefined, max: number | undefined) {
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max === undefined) return `Score ${min.toFixed(1)} and above`;
  if (min === undefined && max !== undefined) return `Score below ${max.toFixed(1)}`;
  const top = Number(max) - 0.1;
  return `Score ${Number(min).toFixed(1)}-${top.toFixed(1)}`;
}

// Score buckets and week rows on the overview open the list with the matching filter.
export const bucketFilters: Record<string, { scoreMin?: number; scoreMax?: number }> = {
  '4.5-5.0': { scoreMin: 4.5 },
  '4.0-4.4': { scoreMin: 4, scoreMax: 4.5 },
  '3.5-3.9': { scoreMin: 3.5, scoreMax: 4 },
  '3.0-3.4': { scoreMin: 3, scoreMax: 3.5 },
  '<3.0': { scoreMax: 3 },
};

export function listHref(params: Record<string, string>) {
  const all = new URLSearchParams({
    q: '',
    filter: 'any',
    sort: 'score',
    direction: 'desc',
    grouped: 'true',
    limit: '50',
    ...params,
  });
  return `?${all.toString()}#/jobs`;
}
