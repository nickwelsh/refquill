import type { ReactNode } from 'react';
import { Provider } from '@/components/provider';
import '@/styles/globals.css';

export default async function RootElement({ children }: { children: ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </head>
            <body className="flex min-h-dvh flex-col">
                <Provider>{children}</Provider>
            </body>
        </html>
    );
}

export async function getConfig() {
    return {
        render: 'static',
    } as const;
}
