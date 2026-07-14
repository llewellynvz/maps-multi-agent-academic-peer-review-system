'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api, type Detected } from '@/lib/api';
import { Icon, Meter, Pill } from '@/components/ui';

type Phase = 'idle' | 'uploading' | 'parsing' | 'ready' | 'error';

export default function NewReviewPage(): ReactNode {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [detected, setDetected] = useState<Detected | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase !== 'parsing' || reviewId === null) {
      return;
    }
    const poll = setInterval(async () => {
      try {
        const result = await api.getQuestions(reviewId);
        setDetected(result.detected);
        setPhase('ready');
        clearInterval(poll);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== 'parse_incomplete') {
          setPhase('error');
          setMessage(err instanceof Error ? err.message : 'The manuscript could not be read.');
          clearInterval(poll);
        }
      }
    }, 2500);
    return () => clearInterval(poll);
  }, [phase, reviewId]);

  const accept = async (file: File): Promise<void> => {
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      setPhase('error');
      setMessage('Upload a PDF or DOCX manuscript.');
      return;
    }
    setPhase('uploading');
    setMessage('');
    try {
      const review = await api.createReview({ title: file.name.replace(/\.[^.]+$/, '') });
      setReviewId(review.id);
      await api.uploadManuscript(review.id, file);
      setPhase('parsing');
    } catch (err) {
      setPhase('error');
      setMessage(err instanceof Error ? err.message : 'The upload failed.');
    }
  };

  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) {
      void accept(file);
    }
  };

  const rows: Array<{ label: string; value: string }> = detected === null
    ? []
    : [
        { label: 'Field', value: detected.field },
        { label: 'Study design', value: detected.studyDesign },
        { label: 'Manuscript type', value: detected.manuscriptType },
        { label: 'Language', value: detected.language },
        { label: 'Word count', value: String(detected.wordCount) },
        { label: 'Parse quality', value: detected.parseQuality },
      ];

  return (
    <div>
      <p className="eyebrow">New review</p>
      <h1 className="h1">Bring a manuscript in</h1>
      <div className="grid-2" style={{ marginTop: 24, gridTemplateColumns: '3fr 2fr' }}>
        <div>
          <div
            className={`dropzone ${dragOver ? 'dragover' : ''} ${phase === 'error' ? 'reject' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === 'Enter') inputRef.current?.click(); }}
          >
            <Icon name="upload" className="ico-teal" />
            <h2 className="h3" style={{ marginTop: 12 }}>Drop a manuscript here</h2>
            <p className="sub muted" style={{ margin: '4px auto 0' }}>PDF or DOCX, up to 40 MB</p>
            <input ref={inputRef} type="file" accept=".pdf,.docx" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file !== undefined) void accept(file); }} />
            {phase === 'uploading' || phase === 'parsing' ? (
              <div style={{ marginTop: 20 }}>
                <Meter indeterminate />
                <p className="sub muted" style={{ marginTop: 8 }}>{phase === 'uploading' ? 'Uploading' : 'Reading your manuscript'}</p>
              </div>
            ) : null}
            {phase === 'error' ? <div style={{ marginTop: 16 }}><Pill tone="fail" label={message} /></div> : null}
          </div>
          {phase === 'ready' && reviewId !== null ? (
            <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => router.push(`/reviews/${reviewId}/clarify`)}>
              Continue to questions <Icon name="arrow" />
            </button>
          ) : null}
        </div>

        <div className="card">
          <h2 className="h3">Detected metadata</h2>
          {detected === null ? (
            <div className="table-scroll">
              <table className="table">
                <tbody>
                  {['Field', 'Study design', 'Word count', 'Parse quality'].map((label) => (
                    <tr key={label}><td>{label}</td><td className="num muted">Awaiting file</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label}><td>{row.label}</td><td className="num">{row.value}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {detected?.parseQuality === 'degraded' ? (
            <div style={{ marginTop: 12 }}><Pill tone="warn" label="Degraded parse" /></div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
