'use client';
import { useEffect, useRef, useState } from 'react';

export function useCopy() {
    const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (timer.current !== null) {
                clearTimeout(timer.current);
            }
        },
        [],
    );
    async function copy(getText: () => string | Promise<string>) {
        setStatus('copying');
        try {
            const text = getText();
            await (typeof text === 'string'
                ? navigator.clipboard.writeText(text)
                : navigator.clipboard.write([
                      new ClipboardItem({
                          'text/plain': text.then((value) => new Blob([value], { type: 'text/plain' })),
                      }),
                  ]));
            setStatus('copied');
        } catch {
            setStatus('error');
        }
        if (timer.current !== null) {
            clearTimeout(timer.current);
        }
        timer.current = setTimeout(() => setStatus('idle'), 2000);
    }
    return { status, copy };
}
