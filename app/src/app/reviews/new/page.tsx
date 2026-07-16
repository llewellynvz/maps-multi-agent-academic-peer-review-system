'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api, type Detected } from '@/lib/api';
import { detectedTitle } from '@/lib/intake';
import { Icon, Meter, Pill } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { DetectedSummary } from '@/components/DetectedSummary';
import { EmptyState } from '@/components/EmptyState';

type Phase = 'idle' | 'uploading' | 'parsing' | 'ready' | 'error';

const STAGES = ['Uploading the file', 'Reading the structure', 'Classifying the study'];

const NEXT_STEPS = [
  'Confirm what we detected and give this review a name.',
  'Choose the review depth and any extra verification checks.',
  'We run the full review and return a developmental letter with the evidence behind it.',
];

export default function NewReviewPage(): ReactNode {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const [voiceNames, setVoiceNames] = useState<string[]>([]);
  const [voiceError, setVoiceError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase !== 'uploading' && phase !== 'parsing') {
      setStage(0);
      return;
    }
    const tick = setInterval(() => setStage((current) => Math.min(current + 1, STAGES.length - 1)), 1600);
    return () => clearInterval(tick);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'parsing' || reviewId === null) {
      return;
    }
    const poll = setInterval(async () => {
      try {
        const result = await api.getQuestions(reviewId);
        setDetected(result.detected);
        setTitle(detectedTitle(result));
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

  const acceptVoice = async (file: File): Promise<void> => {
    if (reviewId === null) {
      return;
    }
    if (!/\.(pdf|docx|txt|md)$/i.test(file.name)) {
      setVoiceError('Upload a past review as PDF, DOCX, TXT, or Markdown.');
      return;
    }
    setVoiceError('');
    try {
      await api.uploadVoiceSample(reviewId, file);
      setVoiceNames((current) => (current.includes(file.name) ? current : [...current, file.name]));
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'The voice sample upload failed.');
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

  const working = phase === 'uploading' || phase === 'parsing';

  return (
    <div>
      <PageHeader
        eyebrow="New review"
        title="Bring a manuscript in"
        sub="Upload a PDF or DOCX. We read the structure, then ask a few quick questions before the review starts."
      />
      <div className="grid-2" style={{ gridTemplateColumns: '3fr 2fr' }}>
        <div className="stack-16">
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
            {working ? (
              <div className="stack-12" style={{ marginTop: 20, alignItems: 'stretch', textAlign: 'left' }}>
                <Meter indeterminate />
                <ol className="numbered-list">
                  {STAGES.map((label, index) => (
                    <li key={label} style={index <= stage ? undefined : { color: 'var(--fg-4)' }}>{label}</li>
                  ))}
                </ol>
              </div>
            ) : null}
            {phase === 'error' ? <div style={{ marginTop: 16 }}><Pill tone="fail" label={message} /></div> : null}
          </div>
          {phase === 'ready' && reviewId !== null ? (
            <>
              <div className="card">
                <h2 className="h3" style={{ margin: 0 }}>Write it in your voice (optional)</h2>
                <p className="sub muted" style={{ margin: '4px 0 12px' }}>
                  Add one or two of your own past review letters and the report is written in your register. They stay on this machine, and only the writing style is used, never their content. Without them, the house reviewing voice is used.
                </p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={voiceNames.length >= 2}
                  onClick={() => voiceInputRef.current?.click()}
                >
                  <Icon name="upload" /> {voiceNames.length === 0 ? 'Add a past review' : 'Add another'}
                </button>
                <input
                  ref={voiceInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md"
                  hidden
                  onChange={(event) => { const file = event.target.files?.[0]; if (file !== undefined) void acceptVoice(file); event.target.value = ''; }}
                />
                {voiceNames.length > 0 ? (
                  <ul className="stack-12" style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
                    {voiceNames.map((name) => (
                      <li key={name} className="chip-hint"><Icon name="check" /> {name}</li>
                    ))}
                  </ul>
                ) : null}
                {voiceError.length > 0 ? <div style={{ marginTop: 12 }}><Pill tone="fail" label={voiceError} /></div> : null}
              </div>
              <button className="btn btn-primary" onClick={() => router.push(`/reviews/${reviewId}/clarify`)}>
                Continue to questions <Icon name="arrow" />
              </button>
            </>
          ) : null}
        </div>

        <div className="stack-16">
          {detected === null ? (
            <div className="card">
              <h2 className="h3">Detected metadata</h2>
              <div className="table-scroll">
                <table className="table">
                  <tbody>
                    {['Field', 'Study design', 'Word count', 'Parse quality'].map((label) => (
                      <tr key={label}><td>{label}</td><td className="muted">Awaiting file</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <>
              <DetectedSummary detected={detected} title={title} />
              <EmptyState title="What happens next" steps={NEXT_STEPS} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
