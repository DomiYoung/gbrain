import type { BrainEngine } from '../engine.ts';
import { opError } from '../ops/contract.ts';

/**
 * `cycle.lint_fix` (default on): only an explicit falsy value makes the
 * cycle's lint phase report-only; a config read failure keeps the default.
 * `gbrain lint --fix` is unaffected. Its own module so the cycle reads the
 * setting without depending on the lint command's export surface.
 */
export async function cycleLintFixEnabled(engine?: BrainEngine | null): Promise<boolean> {
  return !/^\s*(false|0|off|no)\s*$/i.test(await engine?.getConfig('cycle.lint_fix').catch(() => null) ?? '');
}

export const CYCLE_LINT_ENABLED_KEY = 'cycle.lint.enabled';

/**
 * `cycle.lint.enabled` (default on): the off switch for the cycle's lint
 * phase. Only an explicit falsy value skips the phase (the `cycle.lint_fix`
 * parse); unset, a truthy value and a config read failure keep it on.
 * `gbrain dream --phase lint --once` bypasses it for one run; `gbrain lint`
 * never reads it. Contributed by @dovstern (#6369).
 */
export async function cycleLintPhaseEnabled(engine?: BrainEngine | null): Promise<boolean> {
  return !/^\s*(false|0|off|no)\s*$/i.test(await engine?.getConfig(CYCLE_LINT_ENABLED_KEY).catch(() => null) ?? '');
}

export const CYCLE_LINT_EXCLUDE_KEY = 'cycle.lint_exclude';

/**
 * #6134: `cycle.lint_exclude` is a comma-separated list of directory or file
 * basenames the cycle's lint phase and the minion lint handlers skip, matched
 * like `gbrain lint --exclude`. Whitespace is trimmed and blank entries are
 * dropped; unset excludes nothing. `config set` refuses a path, which a
 * basename match would never apply.
 */
export function parseCycleLintExclude(raw: string): string[] {
  const names = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!names.some(name => /[\\/]/.test(name))) return names;
  throw opError('invalid_params', `Invalid ${CYCLE_LINT_EXCLUDE_KEY}: expected comma-separated basenames, not paths.`,
    `Set ${CYCLE_LINT_EXCLUDE_KEY} to directory or file names without a slash, for example: gbrain config set ${CYCLE_LINT_EXCLUDE_KEY} attachments,drafts.md`, {
      why: 'Lint matches each entry against one directory or file name at a time, so an entry with a slash would never apply. Nothing was written.',
      fix: {
        argv: ['gbrain', 'config', 'set', CYCLE_LINT_EXCLUDE_KEY, '<NAMES>'],
        inputs: [{ name: 'NAMES', how: 'Comma-separated directory or file basenames to skip (the last part of each path); ask the user when unclear.' }],
        consent: [], actor: 'agent', requires_exclusive: false,
        why: 'The next lint phase skips the named directories and files.',
        verify: { argv: ['gbrain', 'config', 'get', CYCLE_LINT_EXCLUDE_KEY] },
      },
    });
}

/** The cycle's lint excludes; an unreadable setting or an entry with a slash (written with --force) contributes nothing. */
export async function cycleLintExcludes(engine?: BrainEngine | null): Promise<string[]> {
  const raw = await engine?.getConfig(CYCLE_LINT_EXCLUDE_KEY).catch(() => null) ?? '';
  return raw.split(',').map(s => s.trim()).filter(name => name && !/[\\/]/.test(name));
}

export const CYCLE_LINT_SUPPRESS_KEY = 'cycle.lint_suppress';

/** The suppression key for one lint finding: `slug|rule`. */
export function lintSuppressionKey(slug: string, rule: string): string {
  return `${slug}|${rule}`;
}

const LINT_SUPPRESS_RULE = /^[a-z0-9-]+$/;

function parseLintSuppressEntry(entry: string): string | null {
  const parts = entry.split('|');
  if (parts.length !== 2) return null;
  const [slug, rule] = parts;
  if (!slug || /[\s,]/.test(slug) || !LINT_SUPPRESS_RULE.test(rule)) return null;
  return lintSuppressionKey(slug, rule);
}

/**
 * `cycle.lint_suppress` is a comma-separated list of `slug|rule` pairs naming
 * individual lint findings the operator has reviewed and acknowledged. The
 * cycle's lint phase scans and fixes exactly as upstream; a finding whose
 * pair is listed counts as suppressed instead of remaining, so an
 * acknowledged finding does not hold the phase at warn forever. `config set`
 * refuses a malformed entry (not exactly one `|`, an empty slug or one with
 * whitespace, or a rule outside [a-z0-9-]).
 */
export function parseCycleLintSuppress(raw: string): string[] {
  const entries = raw.split(',').map(s => s.trim()).filter(Boolean);
  const keys: string[] = [];
  for (const entry of entries) {
    const key = parseLintSuppressEntry(entry);
    if (key === null) {
      throw opError('invalid_params', `Invalid ${CYCLE_LINT_SUPPRESS_KEY}: expected comma-separated slug|rule pairs.`,
        `Set ${CYCLE_LINT_SUPPRESS_KEY} to findings to acknowledge, for example: gbrain config set ${CYCLE_LINT_SUPPRESS_KEY} 'concepts/example|empty-section'`, {
          why: 'The lint phase matches each entry against one finding at a time, so a malformed entry would never apply. Nothing was written.',
          fix: {
            argv: ['gbrain', 'config', 'set', CYCLE_LINT_SUPPRESS_KEY, '<PAIRS>'],
            inputs: [{ name: 'PAIRS', how: 'Comma-separated slug|rule pairs; the slug is the page slug and the rule is the lint rule id (lowercase letters, digits, dashes); ask the user when unclear.' }],
            consent: [], actor: 'agent', requires_exclusive: false,
            why: 'The next lint phase counts the listed findings as acknowledged instead of remaining.',
            verify: { argv: ['gbrain', 'config', 'get', CYCLE_LINT_SUPPRESS_KEY] },
          },
        });
    }
    keys.push(key);
  }
  return keys;
}

/** The acknowledged lint findings; an unreadable setting or a malformed entry (written with --force) contributes nothing (fail-open to upstream behavior). */
export async function cycleLintSuppressions(engine?: BrainEngine | null): Promise<Set<string>> {
  const raw = await engine?.getConfig(CYCLE_LINT_SUPPRESS_KEY).catch(() => null) ?? '';
  const keys = new Set<string>();
  for (const entry of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const key = parseLintSuppressEntry(entry);
    if (key !== null) keys.add(key);
  }
  return keys;
}
