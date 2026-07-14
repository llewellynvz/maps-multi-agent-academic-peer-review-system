import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ReportMarkdown({ text }: { text: string }): ReactNode {
  return (
    <div className="report-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h2>{children}</h2>,
          h2: ({ children }) => <h2>{children}</h2>,
          h3: ({ children }) => <h3>{children}</h3>,
          table: ({ children }) => (
            <div className="card-inset table-scroll">
              <table className="table">{children}</table>
            </div>
          ),
          blockquote: ({ children }) => <blockquote className="report-primer">{children}</blockquote>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
