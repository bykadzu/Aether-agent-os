/**
 * ANSI colors and formatting utilities for CLI output.
 */

// ---------------------------------------------------------------------------
// ANSI colors
// ---------------------------------------------------------------------------

export const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

// ---------------------------------------------------------------------------
// Table formatting
// ---------------------------------------------------------------------------

export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => Math.max(max, (row[i] || '').length), 0);
    return Math.max(h.length, maxRow);
  });

  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');
  const body = rows.map((row) => row.map((cell, i) => (cell || '').padEnd(widths[i])).join('  '));

  return [headerLine, separator, ...body].join('\n');
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

export function printError(message: string): void {
  process.stderr.write(`${colors.red}Error: ${message}${colors.reset}\n`);
}

export function printSuccess(message: string): void {
  process.stdout.write(`${colors.green}${message}${colors.reset}\n`);
}

export function printWarn(message: string): void {
  process.stdout.write(`${colors.yellow}${message}${colors.reset}\n`);
}
