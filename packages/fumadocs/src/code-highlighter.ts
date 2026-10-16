import { createHighlighter } from 'shiki';

/** One shared highlighter for the adapters and React rendering surface. */
export const highlighter = await createHighlighter({
  themes: ['github-light', 'github-dark'],
  langs: ['php', 'typescript', 'rust', 'json'],
});
