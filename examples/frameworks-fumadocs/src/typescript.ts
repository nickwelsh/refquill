/** A regular TypeScript API alongside the framework components. */
export interface GreetingOptions {
  /** The person to greet. */
  name: string;
  /** Optional punctuation. */
  punctuation?: string;
}

/** Format a greeting. */
export function greet({ name, punctuation = '!' }: GreetingOptions): string {
  return `Hello, ${name}${punctuation}`;
}
