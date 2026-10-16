'use client';

import { composeRenderProps } from 'react-aria-components/composeRenderProps';
import { cn } from 'cn';
import type { ClassNameValue } from 'cn';

type Render<T> = string | ((v: T) => string) | undefined;

export function cx<T = unknown>(...classes: [...Array<ClassNameValue>, Render<T>]): string | ((v: T) => string) {
    const value = classes.pop();
    const className = typeof value === 'string' || typeof value === 'function' ? value : undefined;

    return composeRenderProps(className, (renderedClassName) => cn(classes, renderedClassName));
}
