// A job description may be plain text whose single newlines matter, or Markdown. Markdown folds a
// single newline into a space; this plugin turns each single newline inside a paragraph, heading
// or list item into a line break so plain text keeps its shape and Markdown stays readable.
// Code blocks and inline code are untouched. It adds no HTML.
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

function walk(node: MdNode) {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && child.value?.includes('\n')) {
      child.value.split('\n').forEach((part, index) => {
        if (index > 0) next.push({ type: 'break' });
        if (part) next.push({ type: 'text', value: part });
      });
    } else {
      walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

export function remarkLineBreaks() {
  return (tree: MdNode) => walk(tree);
}
