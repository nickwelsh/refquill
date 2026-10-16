'use client';
import { useCopy } from './use-copy';
import Copy from '~icons/carbon/copy';
import Check from '~icons/carbon/checkmark';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip';

export function CopyButton({
    getText,
    label = 'Copy',
    className = '',
}: {
    getText: () => string | Promise<string>;
    label?: string;
    className?: string;
}) {
    const { status, copy } = useCopy();
    let message = label;
    if (status === 'copied') {
        message = 'Copied';
    }
    if (status === 'error') {
        message = 'Copy failed. Try again.';
    }
    return (
        <TooltipTrigger delay={0} closeDelay={0}>
            <Button
                intent={label === 'Copy page' ? 'outline' : 'plain'}
                size="sm"
                className={className}
                aria-label={message}
                isPending={status === 'copying'}
                onPress={() => {
                    void copy(getText);
                }}
            >
                {status === 'copied' ? <Check /> : <Copy />}
                {label === 'Copy page' && <span>{message}</span>}
            </Button>
            <Tooltip arrow={false}>{message}</Tooltip>
        </TooltipTrigger>
    );
}
