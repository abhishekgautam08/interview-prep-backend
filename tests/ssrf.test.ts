import { describe, it, expect } from 'vitest';
import { validateUrlForSSRF, SSRFError } from '../src/crawler/ssrfGuard.js';
import { config } from '../src/config/index.js';

describe('SSRF Guard & URL Validation (Section 11)', () => {
  it('permits valid public URLs', async () => {
    const url = await validateUrlForSSRF('https://example.com');
    expect(url.hostname).toBe('example.com');
  });

  it('permits localhost and 127.0.0.1 in non-production development / test mode', async () => {
    config.nodeEnv = 'development';
    const localUrl = await validateUrlForSSRF('http://localhost:8099/acme/');
    expect(localUrl.hostname).toBe('localhost');
    expect(localUrl.port).toBe('8099');
  });

  it('rejects unsupported protocols (ftp, file, gopher)', async () => {
    await expect(validateUrlForSSRF('file:///etc/passwd')).rejects.toThrow(SSRFError);
    await expect(validateUrlForSSRF('ftp://ftp.example.com')).rejects.toThrow(SSRFError);
  });

  it('blocks localhost in production environment', async () => {
    const prevEnv = config.nodeEnv;
    try {
      config.nodeEnv = 'production';
      await expect(validateUrlForSSRF('http://localhost:8099/acme/')).rejects.toThrow(SSRFError);
    } finally {
      config.nodeEnv = prevEnv;
    }
  });
});
