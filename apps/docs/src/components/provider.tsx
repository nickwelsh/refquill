'use client';
import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/waku';
import { RouterProvider } from 'react-aria-components';
import { useRouter } from 'fumadocs-core/framework';
import { publicPath } from '@/lib/shared';

function AriaRouterProvider({ children }: { children: ReactNode }) {
    const { push } = useRouter();
    return (
        <RouterProvider
            useHref={publicPath}
            navigate={(href) => {
                void push(href);
            }}
        >
            {children}
        </RouterProvider>
    );
}

export function Provider({ children }: { children: ReactNode }) {
    return (
        <RootProvider search={{ enabled: false }} theme={{ hotKey: false, defaultTheme: 'system', enableSystem: true }}>
            <AriaRouterProvider>{children}</AriaRouterProvider>
        </RootProvider>
    );
}
