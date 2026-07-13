export function normalizeInline(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function collapseBlankLines(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const HEADING_KEYWORDS =
  /^(abstract|introduction|background|related work|literature review|method(s|ology)?|materials and methods|participants|measures|procedure|results|findings|analysis|discussion|general discussion|limitations|conclusion(s)?|future directions|references|bibliography|acknowledg(e)?ments?|funding|conflict of interest|disclosure statement|appendix|supplementary material)/i;

export function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 90 || /[.!?]$/.test(trimmed)) {
    return false;
  }
  const wordCount = trimmed.split(/\s+/).length;
  if (/^\d+(\.\d+)*\.?\s+\S/.test(trimmed) && wordCount <= 12) {
    return true;
  }
  if (HEADING_KEYWORDS.test(trimmed) && wordCount <= 8) {
    return true;
  }
  const withoutTrailingColon = trimmed.replace(/:$/, '');
  return /^[A-Z0-9]/.test(withoutTrailingColon) && wordCount <= 8;
}
