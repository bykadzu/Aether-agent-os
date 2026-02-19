/**
 * Aether Kernel - Structured Logger
 *
 * Lightweight structured logging for the kernel. Replaces bare console.log
 * calls with leveled, component-tagged output.
 *
 * - In development (default): pretty-printed console output
 * - In production (NODE_ENV=production): JSON-lines for log aggregators
 *
 * No external dependencies. This can be swapped for pino/winston later
 * by changing the transport in createLogger().
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const minLevel: LogLevel = (process.env.AETHER_LOG_LEVEL as LogLevel) || 'info';

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  /** Raw console.log pass-through for banners / formatted output */
  raw(msg: string): void;
  child(component: string): Logger;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

const isProduction = process.env.NODE_ENV === 'production';

function formatJson(
  level: LogLevel,
  component: string,
  msg: string,
  ctx?: Record<string, unknown>,
): string {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    component,
    msg,
  };
  if (ctx && Object.keys(ctx).length > 0) {
    Object.assign(entry, ctx);
  }
  return JSON.stringify(entry);
}

function formatPretty(
  level: LogLevel,
  component: string,
  msg: string,
  ctx?: Record<string, unknown>,
): string {
  const ctxStr =
    ctx && Object.keys(ctx).length > 0
      ? ' ' +
        Object.entries(ctx)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(' ')
      : '';
  return `[${component}] ${msg}${ctxStr}`;
}

function makeLogger(component: string): Logger {
  const format = isProduction ? formatJson : formatPretty;

  return {
    debug(msg: string, ctx?: Record<string, unknown>) {
      if (!shouldLog('debug')) return;
      console.debug(format('debug', component, msg, ctx));
    },
    info(msg: string, ctx?: Record<string, unknown>) {
      if (!shouldLog('info')) return;
      console.log(format('info', component, msg, ctx));
    },
    warn(msg: string, ctx?: Record<string, unknown>) {
      if (!shouldLog('warn')) return;
      console.warn(format('warn', component, msg, ctx));
    },
    error(msg: string, ctx?: Record<string, unknown>) {
      if (!shouldLog('error')) return;
      console.error(format('error', component, msg, ctx));
    },
    raw(msg: string) {
      console.log(msg);
    },
    child(childComponent: string) {
      return makeLogger(childComponent);
    },
  };
}

/**
 * Create a logger for a kernel component.
 *
 * @example
 * const log = createLogger('Kernel');
 * log.info('Booting', { version: '0.5.1' });
 * // dev:  [Kernel] Booting version="0.5.1"
 * // prod: {"ts":"...","level":"info","component":"Kernel","msg":"Booting","version":"0.5.1"}
 */
export function createLogger(component: string): Logger {
  return makeLogger(component);
}

/**
 * Safely extract an error message from an unknown catch value.
 * Use this instead of `(err as any).message` in catch blocks.
 */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}
