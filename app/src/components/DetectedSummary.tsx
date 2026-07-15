import type { ReactNode } from 'react';
import type { Detected } from '@/lib/api';
import { parseQualitySentence } from '@/lib/intake';
import { Pill } from './ui';

interface Row {
  label: string;
  value: string;
  mono?: boolean;
}

export function DetectedSummary({
  detected,
  title,
  compact,
}: {
  detected: Detected;
  title?: string | null;
  compact?: boolean;
}): ReactNode {
  const rows: Row[] = [];
  if (title !== undefined && title !== null && title.length > 0) {
    rows.push({ label: 'Title', value: title });
  }
  rows.push({ label: 'Field', value: detected.field });
  rows.push({ label: 'Study design', value: detected.studyDesign });
  rows.push({ label: 'Manuscript type', value: detected.manuscriptType });
  rows.push({ label: 'Language', value: detected.language });
  rows.push({ label: 'Word count', value: detected.wordCount.toLocaleString(), mono: true });
  if (detected.sectionCount !== undefined) {
    rows.push({ label: 'Sections found', value: String(detected.sectionCount), mono: true });
  }
  if (detected.referenceCount !== undefined) {
    rows.push({ label: 'References found', value: String(detected.referenceCount), mono: true });
  }
  if (detected.hasAbstract !== undefined) {
    rows.push({ label: 'Abstract', value: detected.hasAbstract ? 'Present' : 'Not detected' });
  }

  const degraded = detected.parseQuality === 'degraded';

  return (
    <div className={`${compact === true ? 'card-inset' : 'card'} stack-16`}>
      {compact === true ? null : <h2 className="h3" style={{ margin: 0 }}>What we detected</h2>}
      <div className="table-scroll">
        <table className="table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className={row.mono === true ? 'mono' : undefined}>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row wrap">
        <Pill tone={degraded ? 'warn' : 'success'} label={degraded ? 'Degraded parse' : 'Clean parse'} />
      </div>
      <p className="sub" style={{ margin: 0 }}>{parseQualitySentence(detected.parseQuality)}</p>
    </div>
  );
}
