import { PasteForm } from './PasteForm';
import { ScanCard } from './ScanCard';
import { PostingCheckCard } from './PostingCheckCard';

// ---- Package 3.3: Discover page (pasted JD intake and scanning). Deterministic: no LLM here.

export interface DiscoverCaps {
  nonce: string;
  intake: boolean;
  taskDispatch: boolean;
}

export function DiscoverPage({ caps }: { caps: DiscoverCaps | null }) {
  if (!caps)
    return (
      <section className="capability-card">
        <div>
          <span className="card-kicker">CURRENT AVAILABILITY</span>
          <h2>Discover is waiting for the local session</h2>
          <p>The page shows its tools once the service reports what this server supports.</p>
        </div>
        <span className="not-enabled">Unavailable</span>
      </section>
    );
  if (!caps.intake && !caps.taskDispatch)
    return (
      <section className="capability-card">
        <div>
          <span className="card-kicker">CURRENT AVAILABILITY</span>
          <h2>Discover is unavailable</h2>
          <p>This server does not offer pasted intake or scanning.</p>
        </div>
        <span className="not-enabled">Unavailable</span>
      </section>
    );
  return (
    <div className="discover-grid">
      {caps.intake && <PasteForm nonce={caps.nonce} />}
      {caps.taskDispatch && <ScanCard nonce={caps.nonce} />}
      {caps.taskDispatch && <PostingCheckCard nonce={caps.nonce} />}
    </div>
  );
}
