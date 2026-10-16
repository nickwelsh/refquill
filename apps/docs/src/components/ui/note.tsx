import type { ComponentProps } from 'react';
import { cn } from 'cn';
import Information from '~icons/carbon/information-filled';
import Warning from '~icons/carbon/warning-filled';
import Checkmark from '~icons/carbon/checkmark-filled';

export interface NoteProps extends ComponentProps<'div'> {
    intent?: 'default' | 'info' | 'warning' | 'danger' | 'success';
    indicator?: boolean;
}

const icons = {
    default: null,
    info: Information,
    warning: Warning,
    danger: Warning,
    success: Checkmark,
};

export function Note({ indicator = true, intent = 'default', className, children, ...props }: NoteProps) {
    const IndicatorIcon = icons[intent];
    return (
        <div
            data-slot="note"
            className={cn(
                'grid w-full overflow-hidden rounded-lg border border-current/15 p-4 text-base/6 backdrop-blur-2xl sm:text-sm/6',
                '[&_a:hover]:underline **:[strong]:font-medium',
                IndicatorIcon !== null && indicator ? 'grid-cols-[auto_1fr]' : 'grid-cols-1',
                intent === 'default' && 'bg-muted/50 text-secondary-foreground',
                intent === 'info' &&
                    'bg-info-subtle text-info-subtle-foreground **:[.text-muted-foreground]:text-info-subtle-foreground/70',
                intent === 'warning' &&
                    'bg-warning-subtle text-warning-subtle-foreground **:[.text-muted-foreground]:text-warning-subtle-foreground/80',
                intent === 'danger' &&
                    'bg-danger-subtle text-danger-subtle-foreground **:[.text-muted-foreground]:text-danger-subtle-foreground/80',
                intent === 'success' &&
                    'bg-success-subtle text-success-subtle-foreground **:[.text-muted-foreground]:text-success-subtle-foreground/80',
                className,
            )}
            {...props}
        >
            {IndicatorIcon !== null && indicator && (
                <div
                    aria-hidden="true"
                    className="me-3 grid size-8 place-content-center rounded-full border-2 border-current/40"
                >
                    <div className="grid size-6 place-content-center rounded-full border-2 border-current/85">
                        <IndicatorIcon className="size-5 shrink-0" />
                    </div>
                </div>
            )}
            <div className="min-w-0 space-y-2 text-pretty">{children}</div>
        </div>
    );
}
