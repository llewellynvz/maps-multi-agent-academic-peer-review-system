import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const ID = /REV-[A-Z]{3,4}-\d{4}/g;
const CLUSTER = /REV-[A-Z]{3,4}-\d{4}(?:[,;\s]+REV-[A-Z]{3,4}-\d{4})*/g;

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function collapseFindingIds() {
  return (tree: HastNode): void => {
    const walk = (node: HastNode, parent: HastNode | null): void => {
      if (node.type === 'element' && (node.tagName === 'a' || node.tagName === 'code' || node.tagName === 'pre')) {
        return;
      }
      if (node.type === 'text' && parent !== null && typeof node.value === 'string' && CLUSTER.test(node.value)) {
        CLUSTER.lastIndex = 0;
        const value = node.value;
        const replacement: HastNode[] = [];
        let last = 0;
        for (const match of value.matchAll(CLUSTER)) {
          const index = match.index ?? 0;
          if (index > last) {
            replacement.push({ type: 'text', value: value.slice(last, index) });
          }
          const ids = match[0].match(ID) ?? [];
          replacement.push({ type: 'element', tagName: 'span', properties: { dataFids: ids.join(',') }, children: [] });
          last = index + match[0].length;
        }
        if (last < value.length) {
          replacement.push({ type: 'text', value: value.slice(last) });
        }
        const at = parent.children?.indexOf(node) ?? -1;
        if (at >= 0) {
          parent.children!.splice(at, 1, ...replacement);
        }
        return;
      }
      if (node.children !== undefined) {
        for (const child of [...node.children]) {
          walk(child, node);
        }
      }
    };
    walk(tree, null);
  };
}

export function ReportMarkdown({ text, onFinding }: { text: string; onFinding?: (ids: string[]) => void }): ReactNode {
  return (
    <div className="letter">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={onFinding !== undefined ? [collapseFindingIds] : []}
        components={{
          table: ({ children }) => (
            <div className="table-wrap table-scroll">
              <table className="table">{children}</table>
            </div>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          span: ({ node, children }) => {
            const fids = node?.properties?.dataFids;
            if (onFinding !== undefined && typeof fids === 'string' && fids.length > 0) {
              const ids = fids.split(',');
              return (
                <button type="button" className="fid" onClick={() => onFinding(ids)}>
                  {ids.length === 1 ? ids[0] : `${ids.length} findings`}
                </button>
              );
            }
            return <span>{children}</span>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
