import { ApiFailure } from '../api';

// The message is what a person reads; the code and request id sit behind a Details toggle.
export function ErrorDetails({ error }: { error: ApiFailure }) {
  return (
    <details className="error-details">
      <summary>Details</summary>
      <span>Code: {error.code}</span>
      {error.requestId && <span>Request ID: {error.requestId}</span>}
    </details>
  );
}
