export { Collection, Collection as Accounts } from './models.js';
export type { Account } from './models.js';

/** Read an account identifier. */
export function identifier(account: import('./models.js').Account): number;
/** Parse a string identifier. */
export function identifier(value: string): number;
export function identifier(value: import('./models.js').Account | string) { return typeof value === 'string' ? Number(value) : value.id; }

/** An inferred result. */
export const defaults = { active: true, count: 0 };
/** A generic result. */
export type Result<T> = { data: T; error?: string };
export type Mode = 'read' | 'write';
export type AccountsByMode = Partial<Record<Mode, import('./models.js').Account>>;
/** @deprecated Use identifier. */
export const legacy = 1;
/** @internal */
export const internal = 'hidden';
/** Destructured parameters retain their names. */
export function format({ name }: import('./models.js').Account) { return `Hello ${name}`; }
/** Configure a request. */
export function configure({ retry, connection }: {
  /** Number of retry attempts. */
  retry?: number;
  connection: {
    /** Destination hostname. */
    host: string;
    port?: number;
  };
}): void {}
/** Callback rendering options. */
export interface RenderOptions {
  /**
   * Render a value.
   * @param value Text to render.
   * @param options Rendering settings.
   * @returns Rendered text.
   */
  render?: (value: string, options: { /** Use compact output. */ compact?: boolean }) => string;
}
/** Configure a renderer. */
export function renderWith({ render }: RenderOptions): void {}
/** A documented generic.
 * @typeParam Value - The stored value.
 */
export type Box<Value> = { value: Value };
export type AccountBox = Box<import('./models.js').Account>;
export namespace Utilities { export const version = '1'; }

/** A project client. */
export class ProjectClient {
  /**
   * List projects, optionally filtering by status.
   * @param status Filter by project status.
   * @returns Matching project identifiers.
   */
  list(status?: string): string[] { return []; }
}

throw new Error('Source modules must never execute during analysis');
