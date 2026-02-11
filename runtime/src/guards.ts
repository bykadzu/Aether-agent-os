/**
 * Aether Runtime - Prompt Injection Guards
 *
 * Lightweight pattern-based detection for common prompt injection
 * attempts in agent tool arguments. Not a comprehensive security
 * solution, but catches the most common attack patterns.
 */

export interface InjectionResult {
  safe: boolean;
  reason?: string;
}

/**
 * Case-insensitive patterns that indicate prompt injection attempts.
 * Each entry is [regex, human-readable reason].
 */
const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  // System prompt extraction / override
  [/ignore\s+(all\s+)?previous\s+instructions/i, 'system prompt override attempt'],
  [/ignore\s+(all\s+)?prior\s+instructions/i, 'system prompt override attempt'],
  [/disregard\s+(all\s+)?previous\s+instructions/i, 'system prompt override attempt'],
  [/forget\s+(all\s+)?(your\s+)?previous\s+instructions/i, 'system prompt override attempt'],
  [/forget\s+everything\s+(you\s+)?(were\s+)?told/i, 'system prompt override attempt'],
  [/you\s+are\s+now\s+(?:a\s+)?(?:new|different)/i, 'role override attempt'],
  [/from\s+now\s+on\s+you\s+are/i, 'role override attempt'],
  [/###\s*system\s*(?:prompt|message)?/i, 'system prompt injection marker'],
  [/\[system\]/i, 'system prompt injection marker'],

  // Role override
  [/you\s+are\s+a\s+helpful\s+assistant/i, 'role override attempt'],
  [/as\s+an?\s+ai\s+(?:language\s+)?model/i, 'role definition override'],

  // Prompt leaking
  [
    /(?:print|output|reveal|show|display)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions)/i,
    'prompt extraction attempt',
  ],
  [/what\s+(?:are|were)\s+your\s+(?:original\s+)?instructions/i, 'prompt extraction attempt'],
];

/**
 * Known base64-encoded prefixes of common injection phrases.
 * We check if the input contains suspiciously long base64 blocks
 * and attempt to decode them.
 */
const BASE64_REGEX = /[A-Za-z0-9+/]{32,}={0,2}/g;

/** Phrases to look for in decoded base64 content */
const DECODED_PHRASES = [
  'ignore previous instructions',
  'ignore all previous',
  'disregard previous',
  'you are now',
  'forget everything',
  'system prompt',
];

/**
 * Scan a string for prompt injection patterns.
 * Returns { safe: true } if no injection detected,
 * or { safe: false, reason } if suspicious content is found.
 */
export function detectInjection(input: string): InjectionResult {
  if (!input || typeof input !== 'string') {
    return { safe: true };
  }

  // Check direct patterns
  for (const [pattern, reason] of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return { safe: false, reason };
    }
  }

  // Check for base64-encoded payloads
  const b64Matches = input.match(BASE64_REGEX);
  if (b64Matches) {
    for (const b64 of b64Matches) {
      try {
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        // Only flag if the decoded content is mostly printable ASCII
        const printableRatio = decoded.replace(/[^\x20-\x7E]/g, '').length / decoded.length;
        if (printableRatio > 0.8) {
          const lower = decoded.toLowerCase();
          for (const phrase of DECODED_PHRASES) {
            if (lower.includes(phrase)) {
              return {
                safe: false,
                reason: `base64-encoded injection: "${phrase}"`,
              };
            }
          }
        }
      } catch {
        // Not valid base64, skip
      }
    }
  }

  return { safe: true };
}
