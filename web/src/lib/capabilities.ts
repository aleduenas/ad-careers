import { createContext, useContext } from 'react';

/**
 * What the server lets this session do, as the nonces that authorise it. A component that can
 * start a run or change a job reads this instead of receiving the nonce through every parent.
 * The nonce stays in memory: it is only ever sent as a request header.
 */
export interface Capabilities {
  /** Present when the server can start runs. */
  dispatchNonce: string | null;
  /** Present when the server offers job writes. */
  writerNonce: string | null;
}

export const CapabilitiesContext = createContext<Capabilities>({
  dispatchNonce: null,
  writerNonce: null,
});

export const useCapabilities = () => useContext(CapabilitiesContext);
