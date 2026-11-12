import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// The evaluation report is Markdown written by a worker, so it is rendered as untrusted text:
// no raw HTML passthrough (the react-markdown default), no images, links are limited to http(s) and mailto and always leave the page.
// Headings are pushed below the page's own h1 and the section's h3 so the outline stays valid.
// A paragraph that is a run of bold "Label:" fields (the report header the worker writes) becomes a
// borderless label and value grid. Any other paragraph is returned as null and renders as before.
function labelOf(child: ReactNode): string | null {
  if (!isValidElement(child) || child.type !== 'strong') return null;
  const inner = Children.toArray((child as ReactElement<{ children?: ReactNode }>).props.children);
  if (!inner.every(item => typeof item === 'string')) return null;
  const text = inner.join('').trim();
  return text.endsWith(':') && text.length > 1 ? text.slice(0, -1).trim() : null;
}

function fieldsOf(children: ReactNode): { label: string; value: ReactNode[] }[] | null {
  const nodes = Children.toArray(children);
  if (labelOf(nodes[0]) === null) return null;
  const fields: { label: string; value: ReactNode[] }[] = [];
  for (const node of nodes) {
    const label = labelOf(node);
    if (label !== null) fields.push({ label, value: [] });
    else fields[fields.length - 1].value.push(node);
  }
  if (fields.length < 2) return null;
  for (const field of fields) {
    const first = field.value[0];
    if (typeof first === 'string') field.value[0] = first.trimStart();
    const last = field.value[field.value.length - 1];
    if (typeof last === 'string') field.value[field.value.length - 1] = last.trimEnd();
  }
  return fields;
}

const components: Components = {
  p: ({ node: _node, children, ...rest }) => {
    const fields = fieldsOf(children);
    if (!fields) return <p {...rest}>{children}</p>;
    return (
      <dl className="report-fields">
        {fields.map((field, index) => (
          <div key={index}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
    );
  },
  h1: ({ node: _node, ...rest }) => <h4 className="rp-h1" {...rest} />,
  h2: ({ node: _node, ...rest }) => <h4 className="rp-h2" {...rest} />,
  h3: ({ node: _node, ...rest }) => <h5 className="rp-h3" {...rest} />,
  h4: ({ node: _node, ...rest }) => <h6 className="rp-h4" {...rest} />,
  h5: ({ node: _node, ...rest }) => <h6 className="rp-h4" {...rest} />,
  h6: ({ node: _node, ...rest }) => <h6 className="rp-h4" {...rest} />,
  img: () => null,
  // Only http(s) and mailto links are real links; anything else (javascript:, data:, relative)
  // is shown as its text.
  a: ({ node: _node, children, href, ...rest }) =>
    href && /^(https?:|mailto:)/i.test(href.trim()) ? (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  table: ({ node: _node, children, ...rest }) => (
    <div className="report-table-scroll">
      <table {...rest}>{children}</table>
    </div>
  ),
};

export function ReportMarkdown({ text }: { text: string }) {
  return (
    <div className="report-prose" tabIndex={0} role="region" aria-label="Evaluation report text">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
