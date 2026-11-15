import { useState } from 'react';
import { ReportMarkdown } from '../../components/ReportMarkdown';
import './jd-text.css';

/**
 * The stored job description. By default it is shown formatted (Markdown through the same safe
 * renderer as the evaluation report, single newlines kept); "Raw text" shows the stored text
 * unchanged. Nothing is saved from here.
 */
export function JdText({ text }: { text: string }) {
  const [raw, setRaw] = useState(false);
  if (!text)
    return (
      <pre className="doc-text" tabIndex={0} aria-label="Job description text">
        The stored job description is empty.
      </pre>
    );
  return (
    <>
      <div className="jd-view-switch" role="group" aria-label="Job description view">
        <button
          type="button"
          className="quiet-button"
          aria-pressed={!raw}
          onClick={() => setRaw(false)}
        >
          Formatted
        </button>
        <button
          type="button"
          className="quiet-button"
          aria-pressed={raw}
          onClick={() => setRaw(true)}
        >
          Raw text
        </button>
      </div>
      {raw ? (
        <pre className="doc-text" tabIndex={0} aria-label="Job description text">
          {text}
        </pre>
      ) : (
        <ReportMarkdown text={text} label="Job description text" keepLines />
      )}
    </>
  );
}
