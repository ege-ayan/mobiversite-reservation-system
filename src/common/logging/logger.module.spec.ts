import { requestLogLevel } from './logger.module.js';

describe('requestLogLevel', () => {
  it('skips a successful health probe', () => {
    expect(requestLogLevel('/health', 200)).toBe('silent');
    expect(requestLogLevel('/health/live', 200)).toBe('silent');
    expect(requestLogLevel('/health/ready?ready=1', 204)).toBe('silent');
  });

  it('keeps a failed health probe and every other route', () => {
    expect(requestLogLevel('/health', 503)).toBe('info');
    expect(requestLogLevel('/api/v1/auth/login', 200)).toBe('info');
  });
});
