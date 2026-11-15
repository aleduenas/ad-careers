import { useEffect, useState } from 'react';
import {
  ApiFailure,
  type DetailJob,
  type EndpointState,
  type JobDetailJd,
  type JobDetailResponse,
} from '../../api';
import { api } from '../../lib/client';
import type { DetailData } from '../../lib/materials';

/** Loads one job's detail and offers the three ways the page changes it afterwards. */
export function useJobDetail(id: string) {
  const [state, setState] = useState<EndpointState<JobDetailResponse>>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const refresh = async (): Promise<DetailData | null> => {
    try {
      const fresh = await api.jobDetail(id, new AbortController().signal);
      setState({ kind: 'success', value: fresh });
      return fresh.data;
    } catch {
      return null;
    }
  };
  const applyJob = (job: DetailJob) =>
    setState(previous =>
      previous.kind === 'success'
        ? {
            kind: 'success',
            value: { ...previous.value, data: { ...previous.value.data, job } },
          }
        : previous,
    );
  const applyJd = (job: DetailJob, jd: JobDetailJd) =>
    setState(previous =>
      previous.kind === 'success'
        ? {
            kind: 'success',
            value: { ...previous.value, data: { ...previous.value.data, job, jd } },
          }
        : previous,
    );
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    void api.jobDetail(id, controller.signal).then(
      value => {
        if (!controller.signal.aborted) setState({ kind: 'success', value });
      },
      error => {
        if (!controller.signal.aborted)
          setState({
            kind: 'error',
            error:
              error instanceof ApiFailure
                ? error
                : new ApiFailure('The request failed.', 'REQUEST_FAILED', true),
          });
      },
    );
    return () => controller.abort();
  }, [id, retry]);
  return { state, reload: () => setRetry(value => value + 1), refresh, applyJob, applyJd };
}
