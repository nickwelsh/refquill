<script setup lang="ts">
/** A Vue card with typed props, events, slots, and a default. */
interface Props {
  /** Card heading. */
  title: string;
  /** Whether to draw a border. */
  bordered?: boolean;
}
withDefaults(defineProps<Props>(), { bordered: true });
defineEmits<{ /** Emitted when the card is selected. */ select: [id: string] }>();
defineSlots<{ /** Main card content. */ default(props: { title: string }): unknown }>();
/** Focus the card from a parent ref. */
function focus() {}
defineExpose({ focus });
</script>

<template><article><h2>{{ title }}</h2><slot :title="title" /></article></template>
