'use client';

import { useParams, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { api, type QuestionsResponse } from '@/lib/api';
import { buildAnswersPayload, detectedTitle, humanizeOption, resolveAnswer, resolveIntake } from '@/lib/intake';
import { Icon, Meter, Pill, Spinner } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { Section } from '@/components/Section';
import { ChoiceChips } from '@/components/ChoiceChips';
import { CheckCard } from '@/components/CheckCard';
import { DetectedSummary } from '@/components/DetectedSummary';

const PRESET_TIME: Record<string, string> = {
  fast: '~7 min',
  balanced: '~12-16 min',
  thorough: '~20-28 min',
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
      const payload = !useDefaults && data !== null
        ? buildAnswersPayload(data.questions, { answers, preset, journal, focus, notes })
        : [];
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

  const layout = resolveIntake(data);
  let running = 2;
  const verificationNum = layout.showVerification ? (running += 1) : 0;
  const assessmentNum = layout.showAssessment ? (running += 1) : 0;
  const notesNum = (running += 1);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <PageHeader
        eyebrow="Clarifying questions"
        title="Confirm what we detected"
        sub="Everything here is optional. Skip with defaults to proceed using the detected values."
      />

      <Section number={1} eyebrow="What we detected" title="Confirm the essentials">
        <div className="stack-16">
          <DetectedSummary detected={data.detected} title={detectedTitle(data)} compact />
          {layout.metadataQuestions.map((question) => (
            <div key={question.id} className="field">
              <label>{question.prompt}</label>
              {question.options !== undefined ? (
                <ChoiceChips
                  options={question.options.map((option) => ({ value: option, label: humanizeOption(option) }))}
                  value={resolveAnswer(question, answers)}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value as string }))}
                />
              ) : (
                <input
                  value={answers[question.id] ?? question.detectedValue ?? ''}
                  onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))}
                />
              )}
            </div>
          ))}
          {layout.reviewTitle !== null ? (
            <div className="field">
              <label>The name this review will carry</label>
              <input
                value={resolveAnswer(layout.reviewTitle, answers)}
                onChange={(event) => setAnswers((prev) => ({ ...prev, [layout.reviewTitle!.id]: event.target.value }))}
              />
            </div>
          ) : null}
        </div>
      </Section>

      <Section number={2} eyebrow="Review scope" title="Shape the review">
        {layout.paperType !== null ? (
          <div className="field">
            <label>Manuscript type</label>
            <ChoiceChips
              options={(layout.paperType.options ?? []).map((option) => ({ value: option, label: humanizeOption(option) }))}
              value={resolveAnswer(layout.paperType, answers)}
              onChange={(value) => setAnswers((prev) => ({ ...prev, [layout.paperType!.id]: value as string }))}
            />
          </div>
        ) : null}
        <div className="field">
          <label>{layout.preset?.prompt ?? 'Review depth'}</label>
          <ChoiceChips
            options={(layout.preset?.options ?? ['fast', 'balanced', 'thorough']).map((option) => ({
              value: option,
              label: humanizeOption(option),
              ...(PRESET_TIME[option] !== undefined ? { hint: PRESET_TIME[option] } : {}),
            }))}
            value={preset}
            onChange={(value) => setPreset(value as string)}
          />
        </div>
        {layout.journal !== null ? (
          <div className="field">
            <label>Target journal</label>
            <input value={journal} onChange={(event) => setJournal(event.target.value)} placeholder="None" />
          </div>
        ) : null}
        <div className="field">
          <label>Feedback focus</label>
          <p className="sub muted" style={{ margin: '0 0 8px', fontSize: 13 }}>This adjusts emphasis only. It never turns a review lens off.</p>
          <ChoiceChips
            multi
            options={FOCUS_OPTIONS.map((option) => ({ value: option, label: option }))}
            value={focus}
            onChange={(value) => setFocus(value as string[])}
          />
        </div>
      </Section>

      {layout.showVerification ? (
        <Section number={verificationNum} eyebrow="Verification options" title="Extra checks before we start">
          <div className="stack-12">
            {layout.referenceAudit !== null ? (
              <CheckCard
                checked={resolveAnswer(layout.referenceAudit, answers) === 'forensic'}
                onChange={(checked) => setAnswers((prev) => ({ ...prev, [layout.referenceAudit!.id]: checked ? 'forensic' : 'standard' }))}
                title="Forensic reference audit"
                description="Every reference is located and checked, with nothing dropped by the standard cap."
                costNote="Slower"
              />
            ) : null}
            {layout.claimCheck !== null ? (
              <CheckCard
                checked={resolveAnswer(layout.claimCheck, answers) === 'yes'}
                onChange={(checked) => setAnswers((prev) => ({ ...prev, [layout.claimCheck!.id]: checked ? 'yes' : 'no' }))}
                title="Claims-vs-citation check"
                description="We fetch the abstracts of the load-bearing sources and check the manuscript's claims against them."
              />
            ) : null}
            {layout.aiDetection !== null ? (
              <CheckCard
                checked={resolveAnswer(layout.aiDetection, answers) === 'yes'}
                onChange={(checked) => setAnswers((prev) => ({ ...prev, [layout.aiDetection!.id]: checked ? 'yes' : 'no' }))}
                title="AI-content screening"
                description="In-context signals with clear false-positive caveats. This stays editor-only and is never phrased as an accusation."
              />
            ) : null}
          </div>
        </Section>
      ) : null}

      {layout.showAssessment && layout.userPrior !== null ? (
        <Section number={assessmentNum} eyebrow="Your assessment" title="Your preliminary view">
          <div className="stack-12">
            <ChoiceChips
              options={(layout.userPrior.options ?? []).map((option) => ({ value: option, label: humanizeOption(option) }))}
              value={resolveAnswer(layout.userPrior, answers)}
              onChange={(value) => setAnswers((prev) => ({ ...prev, [layout.userPrior!.id]: value as string }))}
            />
            <p className="sub" style={{ margin: 0 }}>
              We keep this sealed until the review is done, then stress-test it against the evidence: the strongest case
              for it, the strongest case against it, and whether the findings support it.
            </p>
          </div>
        </Section>
      ) : null}

      <Section number={notesNum} eyebrow="Notes" title="Anything the reviewer should know">
        <div className="field">
          <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </Section>

      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button className="btn btn-primary" onClick={() => submit(false)} disabled={submitting}>
          {submitting ? <Spinner /> : <Icon name="play" />} Start review
        </button>
        <button className="btn btn-ghost" onClick={() => submit(true)} disabled={submitting}>Skip with defaults</button>
      </div>
    </div>
  );
}
