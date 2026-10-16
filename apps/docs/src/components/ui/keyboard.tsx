'use client';

import { Keyboard as KeyboardPrimitive } from 'react-aria-components/Keyboard';
import { cn } from 'cn';

export function Keyboard({ className, ...props }: React.ComponentProps<typeof KeyboardPrimitive>) {
    return (
        <KeyboardPrimitive
            data-slot="keyboard"
            className={cn(
                'forced-colors:group-focus:text-[HighlightText hidden font-mono text-[0.80rem] text-current/60 group-hover:text-foreground group-focus:text-foreground group-focus:opacity-90 group-disabled:opacity-50 lg:inline',
                className,
            )}
            {...props}
        />
    );
}
