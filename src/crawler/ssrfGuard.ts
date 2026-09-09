import ipaddr from 'ipaddr.js';
import dns from 'dns/promises';
import { URL } from 'url';
import { config } from '../config/index.js';

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSRFError';
  }
}

/**
 * Validates a target URL against SSRF rules.
 * In production (`NODE_ENV === 'production'`), private, loopback, link-local, and reserved ranges are blocked.
 * In development or testing, loopback / localhost is permitted to support test cases like http://localhost:8099/acme/.
 */
export async function validateUrlForSSRF(targetUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new SSRFError(`Invalid URL provided: ${targetUrl}`);
  }

  // Only allow http and https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SSRFError(`Forbidden protocol: ${parsed.protocol}. Only http: and https: are allowed.`);
  }

  const hostname = parsed.hostname;

  // In non-production (dev/test), permit localhost and 127.0.0.1 for local test fixtures
  if (config.nodeEnv !== 'production') {
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return parsed;
    }
  }

  // If in production, reject localhost directly
  if (hostname === 'localhost') {
    throw new SSRFError(`Access to localhost is blocked in production.`);
  }

  // If it's already an IP address, validate directly
  if (ipaddr.isValid(hostname)) {
    checkIpAddress(hostname);
    return parsed;
  }

  // Resolve hostname via DNS
  try {
    const lookupResult = await dns.lookup(hostname, { all: true });
    for (const record of lookupResult) {
      checkIpAddress(record.address);
    }
  } catch (err: any) {
    if (err instanceof SSRFError) throw err;
    throw new SSRFError(`DNS resolution failed for hostname: ${hostname}`);
  }

  return parsed;
}

function checkIpAddress(ipStr: string) {
  try {
    const addr = ipaddr.parse(ipStr);
    const range = addr.range();

    // Block private, loopback, linkLocal, carrierGradeNat, etc. in production
    const blockedRanges = [
      'loopback',
      'private',
      'linkLocal',
      'carrierGradeNat',
      'broadcast',
      'reserved',
      'unspecified',
    ];

    if (config.nodeEnv === 'production' && blockedRanges.includes(range)) {
      throw new SSRFError(`Access to IP address ${ipStr} (${range}) is blocked.`);
    }
  } catch (err) {
    if (err instanceof SSRFError) throw err;
    throw new SSRFError(`Invalid IP address resolved: ${ipStr}`);
  }
}
