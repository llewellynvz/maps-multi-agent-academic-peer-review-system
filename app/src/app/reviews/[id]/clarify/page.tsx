'use client';

import { useParams, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { api, type Question, type QuestionsResponse } from '@/lib/api';
import { Icon, Meter, Pill, Spinner } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';

const PRESET_DELTA: Record<string, { cost: string; time: string }> = {
  fast: { cost: 'cost -60%', time: 'time -55%' },
  balanced: { cost: 'baseline', time: 'baseline' },
  thorough: { cost: 'cost +150%', time: 'time +120%' },
};

const FOCUS_OPTIONS = ['Statistics', 'Methods', 'Theory', 'Writing', 'Ethics'];

export default function ClarifyPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [data, setData] = useState<QuestionsResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [journal, setJournal] = useState('');
  const [preset, setPreset] = useState('balanced');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = setInterval(async () => {
      try {
        const result = await api.getQuestions(id);
        if (cancelled) {
          return;
        }
        setData(result);
        const presetQ = result.questions.find((q) => q.id === 'preset');
        if (presetQ !== undefined) {
          setPreset((current) => (current === 'balanced' ? presetQ.default : current));
        }
        clearInterval(poll);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== 'parse_incomplete' && !cancelled) {
          setError(err instanceof Error ? err.message : 'The manuscript could not be read.');
          clearInterval(poll);
        }
      }
    }, 2000);
    return () => { cancelled = true; clearInterval(poll); };
  }, [id]);

  const submit = async (useDefaults: boolean): Promise<void> => {
    setSubmitting(true);
    try {
      const payload: Array<{ questionId: string; value: string | string[] }> = [];
      if (!useDefaults && data !== null) {
        for (const question of data.questions) {
          if (question.id === 'preset') {
            payload.push({ questionId: 'preset', value: preset });
          } else if (question.id === 'journal') {
            payload.push({ questionId: 'journal', value: journal.length > 0 ? journal : 'None' });
          } else if (answers[question.id] !== undefined) {
            payload.push({ questionId: question.id, value: answers[question.id] ?? '' });
          }
        }
        payload.push({ questionId: 'feedback_focus', value: focus });
        if (notes.length > 0) {
          payload.push({ questionId: 'notes', value: notes });
        }
      }
      await api.submitAnswers(id, { answers: payload, useDefaults });
      router.push(`/reviews/${id}/run`);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : 'The answers could not be submitted.');
    }
  };

  if (error !== null) {
    return (
      <div className="card" style={{ maxWidth: 640, margin: '40px auto' }}>
        <Pill tone="fail" label={error} />
        <p className="sub" style={{ marginTop: 12 }}>You can retry the upload from the new review screen.</p>
      </div>
    );
  }

  if (data === null) {
    return (
      <div style={{ maxWidth: 640, margin: '60px auto', textAlign: 'center' }}>
        <p className="eyebrow">Reading your manuscript</p>
        <h1 className="h2">This takes a minute or two</h1>
        <div style={{ margin: '24px 0' }}><Meter indeterminate /></div>
        <p className="sub muted" style={{ margin: '0 auto' }}>Parsing structure, checking for hidden instructions, and classifying the study.</p>
      </div>
    );
  }

  const blockA = data.questions.filter((q) => q.kind === 'confirm' || (q.kind === 'choice' && q.id !== 'preset'));

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <PageHeader
        eyebrow="Clarifying questions"
        title="Confirm what we detected"
        sub="Everything here is optional. Skip with defaults to proceed using the detected values."
      />

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 className="h3">What we read</h2>
        {blockA.map((question: Question) => (
          <div key={question.id} className="field">
            <label>{question.prompt}</label>
            {question.options !== undefined ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {question.options.map((option) => (
                  <button key={option} className="chip" aria-pressed={(answers[question.id] ?? question.default) === option}
                    onClick={() => setAnswers((prev) => ({ ...prev, [question.id]: option }))}>{option}</button>
                ))}
              </div>
            ) : (
              <input value={answers[question.id] ?? question.detectedValue ?? ''} onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))} />
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="h3">Shape the review</h2>
        <div className="field">
          <label>Target journal</label>
          <input value={journal} onChange={(event) => setJournal(event.target.value)} placeholder="None" />
        </div>
        <div className="field">
          <label>Review preset</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['fast', 'balanced', 'thorough'].map((option) => (
              <button key={option} className="chip" aria-pressed={preset === option} onClick={() => setPreset(option)}>
                {option}
                <span className="mono" style={{ fontSize: 11, color: 'var(--fg-4)' }}>{PRESET_DELTA[option]?.cost}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Feedback focus</label>
          <p className="sub muted" style={{ margin: '0 0 8px', fontSize: 13 }}>This adjusts emphasis only. It never turns a review lens off.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {FOCUS_OPTIONS.map((option) => (
              <button key={option} className="chip" aria-pressed={focus.includes(option)}
                onClick={() => setFocus((prev) => (prev.includes(option) ? prev.filter((f) => f !== option) : [...prev, option]))}>{option}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Anything the reviewer should know</label>
          <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button className="btn btn-primary" onClick={() => submit(false)} disabled={submitting}>
          {submitting ? <Spinner /> : <Icon name="play" />} Start review
        </button>
        <button className="btn btn-ghost" onClick={() => submit(true)} disabled={submitting}>Skip with defaults</button>
      </div>
    </div>
  );
}
