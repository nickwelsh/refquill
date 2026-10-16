'use client';
import Copy from '~icons/carbon/copy';
import Check from '~icons/carbon/checkmark';
import ChevronDown from '~icons/carbon/chevron-down';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Menu, MenuItem, MenuLabel, MenuDescription, MenuTrigger } from '@/components/ui/menu';
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip';
import { useCopy } from './use-copy';

export function SchemaCopyActions({ getText }: { getText: () => string }) {
    const { status, copy } = useCopy();
    let message = 'Copy JSON Schema';
    if (status === 'copied') {
        message = 'Copied';
    } else if (status === 'error') {
        message = 'Copy failed. Try again.';
    }
    return (
        <>
            <ButtonGroup aria-label="Copy JSON Schema" className="schema-copy-actions">
                <TooltipTrigger delay={0} closeDelay={0}>
                    <Button
                        intent="plain"
                        size="sq-sm"
                        aria-label={message}
                        isPending={status === 'copying'}
                        onPress={() => {
                            void copy(getText);
                        }}
                    >
                        {status === 'copied' ? <Check /> : <Copy />}
                    </Button>
                    <Tooltip arrow={false}>{message}</Tooltip>
                </TooltipTrigger>
                <MenuTrigger>
                    <Button
                        intent="plain"
                        size="sq-sm"
                        className="sm:w-6"
                        aria-label="Schema copy options"
                        isDisabled={status === 'copying'}
                    >
                        <ChevronDown />
                    </Button>
                    <Menu aria-label="Schema copy options" popover={{ placement: 'bottom end' }}>
                        <MenuItem
                            onAction={() => {
                                void copy(getText);
                            }}
                            textValue="Copy JSON Schema"
                        >
                            <MenuLabel>Copy JSON Schema</MenuLabel>
                            <MenuDescription>Formatted JSON.</MenuDescription>
                        </MenuItem>
                        <MenuItem
                            onAction={() => {
                                void copy(() => JSON.stringify(JSON.parse(getText())));
                            }}
                            textValue="Copy JSON Schema (minified)"
                        >
                            <MenuLabel>Copy JSON Schema (minified)</MenuLabel>
                            <MenuDescription>JSON without extra whitespace.</MenuDescription>
                        </MenuItem>
                        <MenuItem
                            onAction={() => {
                                void copy(() => globalThis.location.href.split('#')[0] ?? globalThis.location.href);
                            }}
                            textValue="Copy URL"
                        >
                            <MenuLabel>Copy URL</MenuLabel>
                            <MenuDescription>Link to this schema reference.</MenuDescription>
                        </MenuItem>
                    </Menu>
                </MenuTrigger>
            </ButtonGroup>
            <span className="sr-only" aria-live="polite">
                {status === 'copied' || status === 'error' ? message : ''}
            </span>
        </>
    );
}
