/**
 * Aether Runtime - OpenTelemetry Tracing
 *
 * Thin wrapper around @opentelemetry/api for distributed tracing.
 * Only uses the lightweight API package (no full SDK).
 * Exports helper functions for creating spans around agent operations.
 *
 * In dev mode (no SDK configured), spans are logged to console.
 */

import { trace, Span, SpanStatusCode, Tracer, context } from '@opentelemetry/api';

const TRACER_NAME = 'aether-os';

let _tracer: Tracer | null = null;

function getTracer(): Tracer {
  if (!_tracer) {
    _tracer = trace.getTracer(TRACER_NAME);
  }
  return _tracer;
}

/**
 * Start a new span with optional attributes.
 */
export function startSpan(
  name: string,
  attributes?: Record<string, string | number | boolean>,
): Span {
  const span = getTracer().startSpan(name);
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
  }
  return span;
}

/**
 * End a span, optionally setting a status.
 */
export function endSpan(span: Span, status?: 'ok' | 'error', errorMessage?: string): void {
  if (status === 'error') {
    span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
  } else if (status === 'ok') {
    span.setStatus({ code: SpanStatusCode.OK });
  }
  span.end();
}

/**
 * Execute a function within a new span. The span is automatically ended
 * when the function completes (or rejects).
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const span = startSpan(name, attributes);
  try {
    const result = await fn(span);
    endSpan(span, 'ok');
    return result;
  } catch (err: any) {
    endSpan(span, 'error', err.message || String(err));
    throw err;
  }
}
