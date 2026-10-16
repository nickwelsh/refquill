'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

const collapsedHeight = 96;

export function ApiReferenceDescription({ children }: { children: ReactNode }) {
    const id = useId();
    const content = useRef<HTMLDivElement>(null);
    const [expanded, setExpanded] = useState(false);
    const [overflows, setOverflows] = useState(false);
    const [contentHeight, setContentHeight] = useState(collapsedHeight);

    useEffect(() => {
        const observer = new ResizeObserver((entries) => {
            for (const { target } of entries) {
                const height = Math.ceil(target.getBoundingClientRect().height);
                setContentHeight(height);
                setOverflows(height > collapsedHeight);
            }
        });
        if (content.current !== null) {
            observer.observe(content.current);
        }
        return () => observer.disconnect();
    }, []);

    return (
        <div className="api-reference-summary">
            <div
                id={id}
                className="api-reference-description"
                data-collapsed={overflows && !expanded}
                style={{ maxHeight: expanded ? contentHeight : collapsedHeight }}
                onFocusCapture={() => setExpanded(true)}
            >
                <div ref={content}>{children}</div>
            </div>
            {overflows && (
                <Button
                    intent="plain"
                    size="xs"
                    className="api-description-toggle"
                    aria-controls={id}
                    aria-expanded={expanded}
                    onPress={() => setExpanded((value) => !value)}
                >
                    {expanded ? 'Read less' : 'Read more'}
                </Button>
            )}
        </div>
    );
}
