/**
 * Aether OS — Typed error helpers
 *
 * Replaces `catch (err: any)` with `catch (err: unknown)` across the server
 * package by providing safe accessors for error properties.
 */

/** Extract a human-readable message from an unknown thrown value. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as Record<string, unknown>).message === 'string'
  ) {
    return (err as Record<string, unknown>).message as string;
  }
  return String(err);
}

/** Extract a `.code` property (e.g. `'ENOENT'`) from an unknown thrown value. */
export function getErrorCode(err: unknown): string | undefined {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'string'
  ) {
    return (err as Record<string, unknown>).code as string;
  }
  return undefined;
}

/** Return true when an error looks like a filesystem "not found" (ENOENT). */
export function isNotFoundError(err: unknown): boolean {
  if (getErrorCode(err) === 'ENOENT') return true;
  const msg = getErrorMessage(err);
  return msg.includes('ENOENT');
}
