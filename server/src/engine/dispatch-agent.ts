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

export async function runAgent<T = unknown>(deps: RunAgentDeps, params: RunAgentParams): Promise<T> {
  const schema = schemaFor(params.agent, params.mode);

  if (artefactExists(params.reviewId, params.artefactName)) {
    const cached = readArtefact(params.reviewId, params.artefactName);
    const parsed = schema.safeParse(cached);
    if (parsed.success) {
      if (params.validate !== undefined) {
        params.validate(parsed.data);
      }
      return parsed.data as T;
    }
  }

  const manifest = readManifest(params.agent);
  const role = roleFor(manifest, params.mode);
  let input = params.assembleInput;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
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
      const defect = describeError(error);
      const priorNote = input.routingNote ?? '';
      input = {
        ...input,
        routingNote: `${priorNote}\nThe previous attempt was rejected. Return a schema-valid object that also satisfies the contract. The exact defect was: ${defect}`,
      };
    }
  }

  throw new Error(`Agent ${params.agent} (${params.phase}) failed after 2 attempts: ${describeError(lastError)}`);
}
