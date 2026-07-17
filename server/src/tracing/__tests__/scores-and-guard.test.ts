import { afterEach, describe, expect, it } from 'vitest';
import { contentCaptureAllowed, isLoopbackHost } from '../langfuse';
import { recordRunScores, type ScoreClient, setScoreClientForTest } from '../scores';

afterEach(() => {
  setScoreClientForTest(null);
});

describe('isLoopbackHost', () => {
  it('accepts loopback literals', async () => {
    expect(await isLoopbackHost('http://127.0.0.1:4000')).toBe(true);
    expect(await isLoopbackHost('http://[::1]:4000')).toBe(true);
  });

  it('refuses a private LAN address such as host.docker.internal resolves to', async () => {
    expect(await isLoopbackHost('http://192.168.1.155:4000')).toBe(false);
  });

  it('refuses a public host', async () => {
    expect(await isLoopbackHost('https://cloud.langfuse.com')).toBe(false);
  });

  it('refuses a malformed host', async () => {
    expect(await isLoopbackHost('not a url')).toBe(false);
  });
});

describe('contentCaptureAllowed', () => {
  it('is false when the host is unset', async () => {
    expect(await contentCaptureAllowed({})).toBe(false);
  });

  it('is true only for a loopback host', async () => {
    expect(await contentCaptureAllowed({ LANGFUSE_HOST: 'http://127.0.0.1:4000' })).toBe(true);
    expect(await contentCaptureAllowed({ LANGFUSE_HOST: 'http://192.168.1.155:4000' })).toBe(false);
  });
});

describe('recordRunScores', () => {
  it('is a no-op when there is no active trace, so no client call is made', () => {
    const calls: unknown[] = [];
    const client: ScoreClient = {
      ingestion: {
        batch: async (request) => {
          calls.push(request);
          return undefined;
        },
      },
    };
    setScoreClientForTest(client);

    recordRunScores(
      [{ name: 'rubric_average', value: 3.4, dataType: 'NUMERIC' }],
      { env: { LANGFUSE_HOST: 'http://127.0.0.1:4000' } },
    );

    expect(calls).toHaveLength(0);
  });

  it('does nothing for an empty score list', () => {
    const calls: unknown[] = [];
    const client: ScoreClient = {
      ingestion: {
        batch: async (request) => {
          calls.push(request);
          return undefined;
        },
      },
    };
    setScoreClientForTest(client);
    recordRunScores([]);
    expect(calls).toHaveLength(0);
  });
});
