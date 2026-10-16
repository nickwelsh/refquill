<!-- @component A Svelte 5 card with typed rune props and a default. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props {
    /** Card heading. */
    title: string;
    /** Whether to draw a border. */
    bordered?: boolean;
    /** Main card content. */
    children?: Snippet;
    /** Called when the card is selected. */
    onselect?: (id: string) => void;
  }
  let { title, bordered = true, children, onselect }: Props = $props();
  /** Focus the card from a parent binding. */
  export function focus() {}
</script>

<article class:bordered><h2>{title}</h2>{@render children?.()}</article>
