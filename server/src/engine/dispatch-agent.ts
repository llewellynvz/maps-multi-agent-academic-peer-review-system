import { NoObjectGeneratedError } from 'ai';
import type { z } from 'zod';
import type { DispatchRunner } from '../providers';
import { assemble, type AssembleInput, readManifest, roleFor, schemaFor } from '../prompts';
import { artefactExists, readArtefact, writeArtefact } from './artefacts';

export interface RunAgentDeps {
  runDispatch: DispatchRunner;
}

export interface RunAgentParams {
  reviewId: string;
  phase: string;
  agent: string;
  mode?: string;
  artefactName: string;
  assembleInput: AssembleInput;
  validate?: (value: unknown) => void;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bandFor(confidence: number): 'Green' | 'Yellow' | 'Red' {
  if (confidence >= 0.98) {
    return 'Green';
  }
  if (confidence >= 0.7) {
    return 'Yellow';
  }
  return 'Red';
}

function normalizeBands(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeBands);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = normalizeBands(entry);
    }
    if (typeof out.confidence === 'number' && typeof out.band === 'string') {
      out.band = bandFor(out.confidence);
    }
    return out;
  }
  return value;
}

function salvageObject(error: unknown, schema: z.ZodType): { value?: unknown; defect?: string } {
  if (!NoObjectGeneratedError.isInstance(error) || typeof error.text !== 'string') {
    return {};
  }
  let raw: unknown;
  try {
    raw = JSON.parse(error.text);
  } catch {
    return {};
  }
  const repaired = schema.safeParse(normalizeBands(raw));
  if (repaired.success) {
    return { value: repaired.data };
  }
  const issues = repaired.error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join('.')} ${issue.message}`)
    .join('; ');
  return { defect: `schema validation failed: ${issues}` };
}

const OUTPUT_DISCIPLINE =
  'Output discipline: return one object that satisfies the response schema exactly. Use the exact enum spellings the schema lists for severity, fixability, scope, band, and epistemic status. Set each finding band from its numeric confidence exactly as the governance module confidence-band rule requires; a band inconsistent with its confidence is rejected and wastes a retry. Every finding needs a non-empty manuscript anchor.';

const MAX_ATTEMPTS = 3;

export async function runAgent<T = unknown>(deps: RunAgentDeps, params: RunAgentParams): Promise<T> {
  const schema = schemaFor(params.agent, params.mode);

  if (artefactExists(params.reviewId, params.artefactName)) {
    const cached = readArtefact(params.reviewId, params.artefactName);
    const parsed = schema.safeParse(cached);
    if (parsed.success) {
      let contractSatisfied = true;
      if (params.validate !== undefined) {
        try {
          params.validate(parsed.data);
        } catch {
          contractSatisfied = false;
        }
      }
      if (contractSatisfied) {
        return parsed.data as T;
      }
    }
  }

  const manifest = readManifest(params.agent);
  const role = roleFor(manifest, params.mode);
  const baseNote = params.assembleInput.routingNote ?? '';
  let input: AssembleInput = {
    ...params.assembleInput,
    routingNote: baseNote.length > 0 ? `${baseNote}\n${OUTPUT_DISCIPLINE}` : OUTPUT_DISCIPLINE,
  };
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { system, user } = assemble(params.agent, input);
    try {
      const result = await deps.runDispatch({
        reviewId: params.reviewId,
        phase: params.phase,
        agent: params.agent,
        promptVersion: manifest.promptVersion,
        role,
        parts: { system, prompt: user },
        schema,
      });
      const parsed = schema.safeParse(result.object);
      if (!parsed.success) {
        throw new Error(
          `schema validation failed: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.')} ${issue.message}`)
            .join('; ')}`,
        );
      }
      if (params.validate !== undefined) {
        params.validate(parsed.data);
      }
      writeArtefact(params.reviewId, params.artefactName, parsed.data);
      return parsed.data as T;
    } catch (error) {
      lastError = error;
      let defect = describeError(error);
      const rescue = salvageObject(error, schema);
      if (rescue.value !== undefined) {
        try {
          params.validate?.(rescue.value);
          writeArtefact(params.reviewId, params.artefactName, rescue.value);
          return rescue.value as T;
        } catch (contractError) {
          defect = describeError(contractError);
        }
      } else if (rescue.defect !== undefined) {
        defect = rescue.defect;
      }
      const priorNote = input.routingNote ?? '';
      input = {
        ...input,
        routingNote: `${priorNote}\nThe previous attempt was rejected. Return a schema-valid object that also satisfies the contract. The exact defect was: ${defect}`,
      };
    }
  }

  throw new Error(`Agent ${params.agent} (${params.phase}) failed after ${MAX_ATTEMPTS} attempts: ${describeError(lastError)}`);
}
