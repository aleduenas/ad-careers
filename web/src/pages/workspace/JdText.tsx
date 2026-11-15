import { useState } from 'react';
import { ReportMarkdown } from '../../components/ReportMarkdown';

// Cached job descriptions start with a front-matter block between two --- lines. Markdown would turn
// its last line into a big heading, so for the formatted view it is shown as a plain block.
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;
const KEY_VALUE_LINE = /^[A-Za-z0-9_-]+[ \t]*:/;

// Only a block whose every line is blank or looks like `key: value` is front matter; a --- rule
// after real prose is just a rule.
function withFrontMatterShown(text: string): string {
  return text.replace(FRONT_MATTER, (all, block: string) =>
    block.split(/\r?\n/).every((line: string) => line.trim() === '' || KEY_VALUE_LINE.test(line))
      ? '```\n' + block + '\n```\n'
      : all,
  );
}

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
        <ReportMarkdown text={withFrontMatterShown(text)} label="Job description text" keepLines />
      )}
    </>
  );
}
