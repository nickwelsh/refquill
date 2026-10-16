import type { Component, JSX } from 'solid-js';

export interface SolidBadgeProps {
  /** Text displayed by the badge. */
  label: string;
  /** Nested JSX content. */
  children?: JSX.Element;
  /** Report the chosen label. */
  onSelect?: (label: string) => void;
}

/** A SolidJS component, distinguished using its JSX import source. */
export const SolidBadge: Component<SolidBadgeProps> = props => <button onClick={() => props.onSelect?.(props.label)}>{props.label}{props.children}</button>;
