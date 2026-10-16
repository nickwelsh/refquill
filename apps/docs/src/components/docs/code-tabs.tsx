'use client';
import type { ReactNode } from 'react';
import { Tabs, TabList, Tab, TabPanel } from '@/components/ui/tabs';

export function CodeBlockTabs({ children, defaultValue }: { children: ReactNode; defaultValue?: string }) {
    return (
        <Tabs
            className="docs-code-tabs not-typeset"
            {...(defaultValue === undefined ? {} : { defaultSelectedKey: defaultValue })}
        >
            {children}
        </Tabs>
    );
}
export function CodeBlockTabsList({ children }: { children: ReactNode }) {
    return (
        <TabList aria-label="Code examples" selectionIndicator={false}>
            {children}
        </TabList>
    );
}
export function CodeBlockTabsTrigger({ value, children }: { value: string; children: ReactNode }) {
    return <Tab id={value}>{children}</Tab>;
}
export function CodeBlockTab({ value, children }: { value: string; children: ReactNode }) {
    return <TabPanel id={value}>{children}</TabPanel>;
}
