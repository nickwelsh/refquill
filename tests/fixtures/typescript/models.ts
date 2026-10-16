/** An account. */
export interface Account { /** Display name. */ name: string; readonly id: number; }

/** A reusable collection. */
export class Collection<T extends Account> {
  constructor(public readonly items: T[]) {}
  /** Return the first account. */
  first() { return this.items[0]; }
  protected helper(): void {}
  private secret(): void {}
}
