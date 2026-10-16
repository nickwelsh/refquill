'use client';

import React, { useEffect, useRef, type ReactNode } from 'react';

/** Only static rendered children cross this boundary, never the document or
 * resolver functions. Pointer and keyboard focus both control code emphasis. */
export function MemberHighlight({ children, id }: { children: ReactNode; id?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const hovered = useRef<string | undefined>(undefined);
  const focused = useRef<string | undefined>(undefined);
  useEffect(() => {
    const reveal = () => {
      let id: string;
      try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      const target = document.getElementById(id);
      if (!target || !root.current?.contains(target)) return;
      for (let element: Element | null = target; element && element !== root.current; element = element.parentElement) {
        if (element instanceof HTMLDetailsElement) element.open = true;
      }
      target.scrollIntoView({ block: 'start' });
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    return () => window.removeEventListener('hashchange', reveal);
  }, []);
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const viewports = container.querySelectorAll<HTMLElement>('[data-reference-viewport]');
    let frame: number | undefined;
    const measure = () => {
      for (const viewport of viewports) {
        if (!viewport.getClientRects().length) continue;
        const top = Math.max(0, viewport.getBoundingClientRect().top);
        const height = `${Math.max(0, window.innerHeight - top)}px`;
        if (viewport.style.getPropertyValue('--refquill-available-height') !== height) {
          viewport.style.setProperty('--refquill-available-height', height);
        }
      }
    };
    const schedule = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => { frame = undefined; measure(); });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);
  function row(target: EventTarget | null) {
    if (!(target instanceof Element)) return undefined;
    const row = target.closest<HTMLElement>('[data-reference-row]');
    return row && root.current?.contains(row) ? row.dataset.referenceRow : undefined;
  }
  function update(id = hovered.current ?? focused.current) {
    const lines = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-reference-declaration]') ?? []);
    const owners = (line: HTMLElement) => line.dataset.referenceDeclaration!.split(/\s+/);
    let matching = lines.filter(line => owners(line).includes(id ?? ''));
    if (!matching.length && id) {
      const owner = lines.flatMap(owners).filter(candidate => id.startsWith(`${candidate}-`)).sort((a, b) => b.length - a.length)[0];
      matching = owner ? lines.filter(line => owners(line).includes(owner)) : [];
    }
    for (const line of lines) {
      if (matching.includes(line)) line.dataset.referenceActive = '';
      else delete line.dataset.referenceActive;
    }
    // Inline definitions precede the desktop panel in the DOM. Choose a line
    // inside the visible viewport so hidden mobile copies cannot prevent scroll.
    const first = matching.find(line => line.closest<HTMLElement>('[data-reference-viewport]')?.clientHeight);
    let viewport = first?.closest<HTMLElement>('[data-reference-viewport]');
    if (!first || !viewport || !viewport.clientHeight) return;
    // Fumadocs code blocks may own a nested scroll container. Scroll that
    // container when present, keeping the documentation page stationary.
    for (let parent = first.parentElement; parent && parent !== viewport; parent = parent.parentElement) {
      if (parent.scrollHeight > parent.clientHeight && /^(auto|scroll)$/.test(getComputedStyle(parent).overflowY)) {
        viewport = parent;
        break;
      }
    }
    const bounds = viewport.getBoundingClientRect();
    const top = first.getBoundingClientRect().top;
    const bottom = matching.filter(line => viewport.contains(line)).at(-1)!.getBoundingClientRect().bottom;
    if (top < bounds.top || bottom > bounds.bottom) viewport.scrollTop += top - bounds.top - 16;
  }
  return <div id={id} className="refquill-reference" ref={root}
    onPointerOver={e => { hovered.current = row(e.target); update(); }}
    onPointerOut={e => { hovered.current = row(e.relatedTarget); update(); }}
    onFocusCapture={e => { focused.current = row(e.target); update(focused.current ?? hovered.current); }}
    onBlurCapture={e => { focused.current = row(e.relatedTarget); update(); }}
  >{children}</div>;
}
