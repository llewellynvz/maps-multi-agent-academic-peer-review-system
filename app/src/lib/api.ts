export type ReviewStatus =
  | 'created'
  | 'queued'
  | 'sanitizing'
  | 'running'
  | 'paused'
  | 'awaiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Review {
  id: string;
  slug: string;
  title: string | null;
  status: ReviewStatus;
  currentPhase: string | null;
  recommendation: string | null;
  recommendationConfidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSummary {
  id: string;
  slug: string;
  title: string | null;
  status: ReviewStatus;
  currentPhase: string | null;
  createdAt: string;
  findingsCount: number;
  recommendation: string | null;
  rubricAverage: number | null;
}

export interface ReviewDetail extends Review {
  severityCounts: Record<string, number>;
  checkpoints: Array<{ phase: string; status: string; gateVerdict: string | null; fixCycleCount: number }>;
}

export interface Detected {
  field: string;
  subfield?: string;
  studyDesign: string;
  manuscriptType: string;
  language: string;
  wordCount: number;
  parseQuality: 'good' | 'degraded';
}

export interface Question {
  id: string;
  kind: 'confirm' | 'choice' | 'text' | 'multi';
  prompt: string;
  detectedValue?: string;
  options?: string[];
  default: string;
}

export interface QuestionsResponse {
  detected: Detected;
  questions: Question[];
}

export interface DeliverableView {
  kind: string;
  format: string;
  released: boolean;
  byteSize: number;
  checksum: string;
}

export interface RunStats {
  costUsd: number;
  costByPhase: Record<string, number>;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  retryRate: number;
  timeToFirstReviewMs: number | null;
}

export interface InstanceStats {
  costPerRun: number;
  completionRate: number;
  retryRate: number;
  timeToFirstReviewMs: number | null;
  runCount: number;
}

export interface ProviderKeyView {
  id: string;
  provider: string;
  label: string | null;
  maskedKey: string;
  baseUrl: string | null;
  persist: 'disk' | 'session';
}

export interface PublicSettings {
  telemetry: boolean;
  presetDefault: string;
  providerProfile: string;
  dataLocation: string;
  passphraseSet: boolean;
}

export interface HealthReport {
  status: string;
  version: string;
  worker: 'up' | 'down';
  db: 'ok' | 'error';
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 401 && typeof window !== 'undefined') {
    window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiError(401, 'unauthorized', 'A session is required.');
  }
  const text = await response.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!response.ok) {
    const error = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(response.status, error?.code ?? 'error', error?.message ?? `Request failed (${response.status}).`);
  }
  return json as T;
}

export const api = {
  health: () => request<HealthReport>('GET', '/api/health'),
  login: (passphrase: string) => request<{ token: string; expiresAt: string }>('POST', '/api/session', { passphrase }),

  listReviews: () => request<{ reviews: ReviewSummary[] }>('GET', '/api/reviews'),
  createReview: (body: { title?: string; providerProfile?: string; options?: Record<string, unknown> }) =>
    request<Review>('POST', '/api/reviews', body),
  getReview: (id: string) => request<ReviewDetail>('GET', `/api/reviews/${id}`),
  deleteReview: (id: string) => request<{ purged: boolean }>('DELETE', `/api/reviews/${id}`),

  uploadManuscript: async (id: string, file: File): Promise<{ manuscriptId: string; sha256: string; byteSize: number }> => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`/api/reviews/${id}/manuscript`, { method: 'POST', body: form, credentials: 'include' });
    const json = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | Record<string, unknown> | null;
    if (!response.ok) {
      const error = (json as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiError(response.status, error?.code ?? 'error', error?.message ?? 'Upload failed.');
    }
    return json as { manuscriptId: string; sha256: string; byteSize: number };
  },

  getQuestions: (id: string) => request<QuestionsResponse>('GET', `/api/reviews/${id}/questions`),
  submitAnswers: (id: string, body: { answers: Array<{ questionId: string; value: string | string[] }>; useDefaults?: boolean }) =>
    request<{ accepted: boolean }>('POST', `/api/reviews/${id}/answers`, body),

  run: (id: string) => request<{ accepted: boolean }>('POST', `/api/reviews/${id}/run`),
  pause: (id: string) => request<{ accepted: boolean }>('POST', `/api/reviews/${id}/pause`),
  resume: (id: string) => request<{ accepted: boolean }>('POST', `/api/reviews/${id}/resume`),
  cancel: (id: string) => request<{ accepted: boolean }>('POST', `/api/reviews/${id}/cancel`),
  retryPhase: (id: string, phase: string) => request<{ accepted: boolean }>('POST', `/api/reviews/${id}/retry-phase`, { phase }),

  listDeliverables: (id: string) => request<{ deliverables: DeliverableView[] }>('GET', `/api/reviews/${id}/deliverables`),
  deliverableUrl: (id: string, kind: string, format?: string) =>
    `/api/reviews/${id}/deliverables/${kind}${format !== undefined ? `?format=${format}` : ''}`,

  getRunStats: (id: string) => request<RunStats>('GET', `/api/reviews/${id}/stats`),
  getInstanceStats: () => request<InstanceStats>('GET', '/api/stats'),

  getSettings: () => request<PublicSettings>('GET', '/api/settings'),
  putSettings: (body: Partial<{ telemetry: boolean; presetDefault: string; providerProfile: string; passphrase: string | null }>) =>
    request<PublicSettings>('PUT', '/api/settings', body),

  listKeys: () => request<{ keys: ProviderKeyView[] }>('GET', '/api/keys'),
  addKey: (body: { provider: string; label?: string; apiKey: string; baseUrl?: string; persist: 'disk' | 'session' }) =>
    request<ProviderKeyView>('POST', '/api/keys', body),
  deleteKey: (id: string) => request<{ deleted: boolean }>('DELETE', `/api/keys/${id}`),
};
