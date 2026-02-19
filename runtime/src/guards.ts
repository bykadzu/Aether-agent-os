/**
 * Aether Runtime - Prompt Injection Guards
 *
 * Lightweight pattern-based detection for common prompt injection
 * attempts in agent tool arguments. Not a comprehensive security
 * solution, but catches the most common attack patterns including
 * encoded and obfuscated variants.
 */

import type { InjectionCheckResult } from '@aether/shared';

// Re-export for backwards compatibility
export type InjectionResult = InjectionCheckResult;

/**
 * Case-insensitive patterns that indicate prompt injection attempts.
 * Each entry is [regex, human-readable reason].
 *
 * Exported for testability.
 */
export const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  // System prompt extraction / override
  [/ignore\s+(all\s+)?previous\s+instructions/i, 'system prompt override attempt'],
  [/ignore\s+(all\s+)?prior\s+instructions/i, 'system prompt override attempt'],
  [/disregard\s+(all\s+)?previous\s+instructions/i, 'system prompt override attempt'],
  [/forget\s+(all\s+)?(your\s+)?previous\s+instructions/i, 'system prompt override attempt'],
  [/forget\s+everything\s+(you\s+)?(were\s+)?told/i, 'system prompt override attempt'],
  [/override\s+(your\s+)?(system\s+)?instructions/i, 'system prompt override attempt'],
  [/new\s+instructions\s*:/i, 'system prompt override attempt'],

  // Role override
  [/you\s+are\s+now\s+(?:a\s+)?(?:new|different)/i, 'role override attempt'],
  [/from\s+now\s+on\s+you\s+are/i, 'role override attempt'],
  [/you\s+are\s+a\s+helpful\s+assistant/i, 'role override attempt'],
  [/as\s+an?\s+ai\s+(?:language\s+)?model/i, 'role definition override'],
  [/pretend\s+(?:you\s+are|to\s+be)\s+(?:a\s+)?(?:different|new)/i, 'role override attempt'],
  [
    /act\s+as\s+(?:if\s+)?(?:you\s+(?:are|were)\s+)?(?:a\s+)?(?:different|unrestricted)/i,
    'role override attempt',
  ],

  // System prompt injection markers / delimiters
  [/###\s*system\s*(?:prompt|message)?/i, 'system prompt injection marker'],
  [/\[system\]/i, 'system prompt injection marker'],
  [/<\|(?:im_start|system|endoftext)\|>/i, 'chat template injection marker'],
  [/={4,}\s*(?:system|instructions|prompt)/i, 'delimiter-based injection'],
  [/-{4,}\s*(?:system|instructions|prompt)/i, 'delimiter-based injection'],
  [/\*{4,}\s*(?:system|instructions|prompt)/i, 'delimiter-based injection'],

  // Prompt leaking
  [
    /(?:print|output|reveal|show|display|repeat|dump)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions)/i,
    'prompt extraction attempt',
  ],
  [/what\s+(?:are|were)\s+your\s+(?:original\s+)?instructions/i, 'prompt extraction attempt'],
  [
    /(?:give|tell)\s+me\s+your\s+(?:system\s+)?(?:prompt|instructions|rules)/i,
    'prompt extraction attempt',
  ],

  // Jailbreak / DAN-style
  [/\bDAN\b.*mode/i, 'jailbreak attempt (DAN)'],
  [/do\s+anything\s+now/i, 'jailbreak attempt (DAN)'],
  [/(?:enable|activate|enter)\s+(?:developer|debug|god|admin)\s+mode/i, 'jailbreak attempt'],
];

/**
 * Known base64-encoded prefixes of common injection phrases.
 * We check if the input contains suspiciously long base64 blocks
 * and attempt to decode them.
 */
const BASE64_REGEX = /[A-Za-z0-9+/]{32,}={0,2}/g;

/** Hex-encoded content pattern (sequences of hex pairs) */
const HEX_REGEX = /(?:[0-9a-fA-F]{2}\s*){16,}/g;

/** URL-encoded content pattern (sequences of %XX possibly mixed with ASCII) */
const URL_ENCODED_REGEX = /(?:%[0-9a-fA-F]{2}[\w]*){4,}/g;

/** Phrases to look for in decoded content (base64, hex, URL) */
const DECODED_PHRASES = [
  'ignore previous instructions',
  'ignore all previous',
  'disregard previous',
  'you are now',
  'forget everything',
  'system prompt',
  'override instructions',
  'new instructions',
];

/**
 * Unicode confusable character map — maps lookalikes to their ASCII equivalents.
 * Attackers use homoglyphs (e.g. Cyrillic 'а' for Latin 'a') to bypass pattern matching.
 */
const CONFUSABLE_MAP: Record<string, string> = {
  '\u0430': 'a', // Cyrillic а
  '\u0435': 'e', // Cyrillic е
  '\u043E': 'o', // Cyrillic о
  '\u0440': 'p', // Cyrillic р
  '\u0441': 'c', // Cyrillic с
  '\u0443': 'y', // Cyrillic у
  '\u0445': 'x', // Cyrillic х
  '\u0456': 'i', // Cyrillic і
  '\u0501': 'd', // Cyrillic ԁ
  '\u0250': 'a', // Latin ɐ
  '\u1D00': 'a', // Latin small cap A
  '\u1D07': 'e', // Latin small cap E
  '\u026A': 'i', // Latin small cap I
  '\u1D0F': 'o', // Latin small cap O
  '\u1D1C': 'u', // Latin small cap U
  '\uFF41': 'a', // Fullwidth a
  '\uFF45': 'e', // Fullwidth e
  '\uFF49': 'i', // Fullwidth i
  '\uFF4F': 'o', // Fullwidth o
  '\uFF55': 'u', // Fullwidth u
  '\u200B': '', // Zero-width space
  '\u200C': '', // Zero-width non-joiner
  '\u200D': '', // Zero-width joiner
  '\uFEFF': '', // Zero-width no-break space (BOM)
};

/**
 * Normalize Unicode text by replacing confusable characters and stripping
 * zero-width characters. This defeats homoglyph-based evasion.
 */
export function normalizeUnicode(input: string): string {
  // Strip zero-width and control characters used for obfuscation.
  // Build the set from code points to avoid eslint no-misleading-character-class.
  const zeroWidthCodes = [0x200b, 0x200c, 0x200d, 0xfeff, 0x00ad, 0x034f, 0x2060];
  const zeroWidthSet = new Set(zeroWidthCodes);
  let normalized = Array.from(input)
    .filter((ch) => !zeroWidthSet.has(ch.codePointAt(0)!))
    .join('');

  // Replace known confusable characters
  for (const [confusable, replacement] of Object.entries(CONFUSABLE_MAP)) {
    normalized = normalized.replaceAll(confusable, replacement);
  }

  // Normalize using NFC (canonical decomposition + composition)
  return normalized.normalize('NFC');
}

/**
 * Check if a decoded string (from any encoding) contains injection phrases.
 */
function checkDecodedContent(decoded: string): string | null {
  const printableRatio = decoded.replace(/[^\x20-\x7E]/g, '').length / decoded.length;
  if (printableRatio <= 0.8) return null;

  const lower = decoded.toLowerCase();
  for (const phrase of DECODED_PHRASES) {
    if (lower.includes(phrase)) {
      return phrase;
    }
  }
  return null;
}

/**
 * Scan a string for prompt injection patterns.
 * Returns { safe: true } if no injection detected,
 * or { safe: false, reason, encoding } if suspicious content is found.
 */
export function detectInjection(input: string): InjectionCheckResult {
  if (!input || typeof input !== 'string') {
    return { safe: true };
  }

  // Step 1: Normalize Unicode confusables and check patterns
  const normalized = normalizeUnicode(input);

  // Check direct patterns against both original and normalized input
  for (const [pattern, reason] of INJECTION_PATTERNS) {
    if (pattern.test(input) || pattern.test(normalized)) {
      return { safe: false, reason, encoding: 'plaintext' };
    }
  }

  // Step 2: Check for base64-encoded payloads
  const b64Matches = input.match(BASE64_REGEX);
  if (b64Matches) {
    for (const b64 of b64Matches) {
      try {
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        const phrase = checkDecodedContent(decoded);
        if (phrase) {
          return {
            safe: false,
            reason: `base64-encoded injection: "${phrase}"`,
            encoding: 'base64',
          };
        }
      } catch {
        // Not valid base64, skip
      }
    }
  }

  // Step 3: Check for hex-encoded payloads
  const hexMatches = input.match(HEX_REGEX);
  if (hexMatches) {
    for (const hexStr of hexMatches) {
      try {
        const clean = hexStr.replace(/\s+/g, '');
        const decoded = Buffer.from(clean, 'hex').toString('utf-8');
        const phrase = checkDecodedContent(decoded);
        if (phrase) {
          return {
            safe: false,
            reason: `hex-encoded injection: "${phrase}"`,
            encoding: 'hex',
          };
        }
      } catch {
        // Not valid hex, skip
      }
    }
  }

  // Step 4: Check for URL-encoded payloads
  const urlMatches = input.match(URL_ENCODED_REGEX);
  if (urlMatches) {
    for (const urlStr of urlMatches) {
      try {
        const decoded = decodeURIComponent(urlStr);
        const phrase = checkDecodedContent(decoded);
        if (phrase) {
          return {
            safe: false,
            reason: `URL-encoded injection: "${phrase}"`,
            encoding: 'url',
          };
        }
      } catch {
        // Not valid URL encoding, skip
      }
    }
  }

  // Step 5: Check Unicode-normalized content against decoded phrases
  // (catches confusable-char attacks in the raw text)
  if (normalized !== input) {
    const normalizedLower = normalized.toLowerCase();
    for (const phrase of DECODED_PHRASES) {
      if (normalizedLower.includes(phrase)) {
        return {
          safe: false,
          reason: `unicode-obfuscated injection: "${phrase}"`,
          encoding: 'unicode',
        };
      }
    }
  }

  return { safe: true };
}
