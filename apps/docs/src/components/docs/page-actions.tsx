'use client';
import ChevronDown from '~icons/carbon/chevron-down';
import Document from '~icons/carbon/document';
import GitHub from '~icons/carbon/logo-github';
import ChatBot from '~icons/carbon/chat-bot';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem, MenuLabel, MenuDescription, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { CopyButton } from './copy-button';
import { absoluteUrl, publicPath } from '@/lib/shared';

export function PageActions({ markdownUrl, githubUrl }: { markdownUrl: string; githubUrl: string }) {
    async function markdown() {
        const response = await fetch(publicPath(markdownUrl));
        if (!response.ok) {
            throw new Error('Unable to load page Markdown');
        }
        return response.text();
    }
    function ask(provider: 'chatgpt' | 'claude') {
        const url = absoluteUrl(markdownUrl);
        const prompt = encodeURIComponent(`Read ${url} so I can ask questions about this documentation.`);
        globalThis.open(
            provider === 'chatgpt' ? `https://chatgpt.com/?q=${prompt}` : `https://claude.ai/new?q=${prompt}`,
            '_blank',
            'noopener,noreferrer',
        );
    }
    return (
        <div className="page-actions">
            <CopyButton label="Copy page" getText={markdown} />
            <MenuTrigger>
                <Button intent="outline" size="sq-sm" aria-label="Page options">
                    <ChevronDown />
                </Button>
                <Menu aria-label="Page options" popover={{ placement: 'bottom end', className: 'page-options' }}>
                    <MenuItem href={absoluteUrl(markdownUrl)} target="_blank" textValue="View as Markdown">
                        <Document />
                        <MenuLabel>View as Markdown</MenuLabel>
                        <MenuDescription>Open the raw Markdown version.</MenuDescription>
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem onAction={() => ask('chatgpt')} textValue="Open in ChatGPT">
                        <ChatBot aria-hidden="true" />
                        <MenuLabel>Open in ChatGPT</MenuLabel>
                        <MenuDescription>Ask ChatGPT about this page.</MenuDescription>
                    </MenuItem>
                    <MenuItem onAction={() => ask('claude')} textValue="Open in Claude">
                        <ChatBot aria-hidden="true" />
                        <MenuLabel>Open in Claude</MenuLabel>
                        <MenuDescription>Ask Claude about this page.</MenuDescription>
                    </MenuItem>
                    <MenuItem href={githubUrl} target="_blank" textValue="Open in GitHub">
                        <GitHub />
                        <MenuLabel>Open in GitHub</MenuLabel>
                        <MenuDescription>View the source file on GitHub.</MenuDescription>
                    </MenuItem>
                </Menu>
            </MenuTrigger>
        </div>
    );
}
