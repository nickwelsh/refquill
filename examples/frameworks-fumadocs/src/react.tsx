import { forwardRef, memo, useState, type ReactNode, Component } from 'react';

/** Shared badge props, also used by the SolidJS example. */
export interface BadgeProps {
  /** Text displayed inside the badge. */
  label: string;
  /** Visual emphasis. Defaults to neutral. */
  tone?: 'neutral' | 'positive';
  /** Optional content after the label. */
  children?: ReactNode;
  /** Called when the badge is selected. */
  onSelect?: (label: string) => void;
}

/** A React component with documented props, a default, and a callback. */
export function Badge({ label, tone = 'neutral', children, onSelect }: BadgeProps) {
  return <button data-tone={tone} onClick={() => onSelect?.(label)}>{label}{children}</button>;
}

/** Memoization preserves component metadata. */
export const MemoBadge = memo(Badge);

/** An input with a forwarded DOM ref. */
export const SearchInput = forwardRef<HTMLInputElement, { /** Accessible name. */ label: string }>(function SearchInput({ label }, ref) {
  return <input aria-label={label} ref={ref} />;
});

/** A class component uses its declared props type. */
export class ClassBadge extends Component<BadgeProps> {
  render() { return <span>{this.props.label}</span>; }
}

/** Manage a counter using React state.
 * @param initial - Starting count.
 * @returns Current count and an increment callback.
 */
export function useCounter(initial = 0) {
  const [count, setCount] = useState(initial);
  return { count, increment: () => setCount(value => value + 1) };
}

/** A conventional name alone does not make this a React hook. */
export function useIdentifier(value: string) { return value.toLowerCase(); }

/** A capitalized utility alone does not make this a component. */
export function Capitalize(value: string) { return value.toUpperCase(); }
