/// <reference types="unplugin-icons/types/react" />

declare module 'virtual:carbon-icons' {
    import type { ComponentType, SVGProps } from 'react';
    export const carbonIcons: Record<string, ComponentType<SVGProps<SVGSVGElement>>>;
}
