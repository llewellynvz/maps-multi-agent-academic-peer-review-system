import { describe, expect, it } from 'vitest';
import { ApiError, hostRefusal } from '../api';

describe('hostRefusal', () => {
  it('returns the server message for a 403, so the run screen can show why the stream stopped', () => {
    const message = 'Open MAPS on localhost and set a passphrase in Settings to use it on any other address.';
    expect(hostRefusal(new ApiError(403, 'forbidden', message))).toBe(message);
  });

  it('ignores every other failure, which the stream retries on its own', () => {
    expect(hostRefusal(new ApiError(502, 'error', 'Request failed (502).'))).toBeNull();
    expect(hostRefusal(new ApiError(401, 'unauthorized', 'A session is required.'))).toBeNull();
    expect(hostRefusal(new Error('network down'))).toBeNull();
    expect(hostRefusal(undefined)).toBeNull();
  });
});
