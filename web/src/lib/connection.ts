import { useEffect, useState } from 'react';
import { ApiFailure, type EndpointState } from '../api';
import type { HealthResponse, ReadyResponse, SessionResponse } from '../generated/api';
import { api } from './client';

export function useConnection(refreshKey: number) {
  const [health, setHealth] = useState<EndpointState<HealthResponse>>({ kind: 'loading' });
  const [ready, setReady] = useState<EndpointState<ReadyResponse>>({ kind: 'loading' });
  const [session, setSession] = useState<EndpointState<SessionResponse>>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setHealth({ kind: 'loading' });
    setReady({ kind: 'loading' });
    setSession({ kind: 'loading' });
    const load = async <T>(
      request: (signal: AbortSignal) => Promise<T>,
      update: (state: EndpointState<T>) => void,
    ) => {
      try {
        update({ kind: 'success', value: await request(controller.signal) });
      } catch (error) {
        if (!controller.signal.aborted)
          update({
            kind: 'error',
            error:
              error instanceof ApiFailure
                ? error
                : new ApiFailure('The request failed.', 'REQUEST_FAILED', true),
          });
      }
    };
    void load(api.health, setHealth);
    void load(api.ready, setReady);
    void load(api.session, setSession);
    return () => controller.abort();
  }, [refreshKey]);
  return { health, ready, session };
}

export type Connection = {
  health: EndpointState<HealthResponse>;
  ready: EndpointState<ReadyResponse>;
  session: EndpointState<SessionResponse>;
};
