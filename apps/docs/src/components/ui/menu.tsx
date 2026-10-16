'use client';

import CheckIcon from '~icons/carbon/checkmark';
import ChevronRightIcon from '~icons/carbon/chevron-right';
import { Collection } from 'react-aria-components/Collection';
import { composeRenderProps } from 'react-aria-components/composeRenderProps';
import { Header } from 'react-aria-components/Header';
import type {
    MenuItemProps as MenuItemPrimitiveProps,
    MenuProps as MenuPrimitiveProps,
    MenuSectionProps as MenuSectionPrimitiveProps,
} from 'react-aria-components/Menu';
import {
    Menu as MenuPrimitive,
    MenuItem as MenuItemPrimitive,
    MenuSection as MenuSectionPrimitive,
} from 'react-aria-components/Menu';
import { cn } from 'cn';
import { tv } from 'tailwind-variants';
import type { VariantProps } from 'tailwind-variants';
import { cx } from '@/lib/primitive';
import { dropdownItemStyles, dropdownSectionStyles } from './dropdown';
import { Popover } from './popover';
import type { PopoverProps } from './popover';

export { MenuTrigger, SubmenuTrigger as MenuSubMenu } from 'react-aria-components/Menu';

export interface MenuProps<T> extends MenuPrimitiveProps<T>, Pick<PopoverProps, 'placement'> {
    className?: string;
    popover?: Pick<
        PopoverProps,
        | 'arrow'
        | 'className'
        | 'placement'
        | 'offset'
        | 'crossOffset'
        | 'arrowBoundaryOffset'
        | 'triggerRef'
        | 'isOpen'
        | 'onOpenChange'
        | 'shouldFlip'
        | 'isNonModal'
        | 'trigger'
        | 'getTargetRect'
    >;
}

export const menuStyles = tv({
    base: "grid max-h-[inherit] grid-cols-[auto_1fr] gap-y-1 overflow-x-hidden overflow-y-auto overscroll-contain p-1 outline-hidden [clip-path:inset(0_0_0_0_round_calc(var(--radius-xl)-(--spacing(1))))] [&>[data-slot=menu-section]+[data-slot=menu-section]:not([class*='mt-']):not([class*='my-'])]:mt-3",
});

export function Menu<T extends object>({ className, placement, popover, ...props }: MenuProps<T>) {
    return (
        <Popover
            className={cx('min-w-32 *:data-[slot=popover-inner]:overflow-hidden', popover?.className)}
            {...(placement ? { placement } : {})}
            {...popover}
        >
            <MenuPrimitive data-slot="menu-content" className={menuStyles({ className })} {...props} />
        </Popover>
    );
}

export interface MenuItemProps
    extends MenuItemPrimitiveProps, Pick<VariantProps<typeof dropdownItemStyles>, 'intent'> {}

export function MenuItem({ className, intent, children, ...props }: MenuItemProps) {
    const textValue = props.textValue ?? (typeof children === 'string' ? children : undefined);
    return (
        <MenuItemPrimitive
            data-slot="menu-item"
            className={composeRenderProps(className, (renderedClassName, { hasSubmenu, ...renderProps }) =>
                dropdownItemStyles({
                    ...renderProps,
                    intent,
                    className: hasSubmenu
                        ? cn(
                              intent === 'danger' && 'open:bg-danger-subtle open:text-danger-subtle-foreground',
                              intent === 'warning' && 'open:bg-warning-subtle open:text-warning-subtle-foreground',
                              intent === undefined &&
                                  'open:bg-accent open:text-accent-foreground open:*:[.text-muted-foreground]:text-accent-foreground open:*:[svg]:text-accent-foreground',
                              renderedClassName,
                          )
                        : renderedClassName,
                }),
            )}
            {...(textValue === undefined ? {} : { textValue })}
            {...props}
        >
            {(values) => (
                <>
                    {values.isSelected && ['single', 'multiple'].includes(values.selectionMode) && <CheckIcon />}

                    {typeof children === 'function' ? children(values) : children}

                    {values.hasSubmenu && (
                        <ChevronRightIcon
                            data-slot="chevron"
                            className="absolute end-0 size-4 -translate-y-1/2"
                            style={{
                                top: 'calc(var(--spacing) * 3)',
                            }}
                        />
                    )}
                </>
            )}
        </MenuItemPrimitive>
    );
}

export interface MenuHeaderProps extends React.ComponentProps<typeof Header> {
    separator?: boolean;
}

export function MenuHeader({ className, separator = false, ...props }: MenuHeaderProps) {
    return (
        <Header
            className={cn(
                'col-span-full px-2.5 py-2 text-base font-medium sm:text-sm',
                separator && '-mx-1 border-b sm:px-3 sm:pb-2.5',
                className,
            )}
            {...props}
        />
    );
}

const { section, header } = dropdownSectionStyles();

export interface MenuSectionProps<T> extends MenuSectionPrimitiveProps<T> {
    ref?: React.Ref<HTMLDivElement>;
    label?: string;
}

export function MenuSection<T extends object>({ className, children, ref, ...props }: MenuSectionProps<T>) {
    return (
        <MenuSectionPrimitive data-slot="menu-section" ref={ref} className={section({ className })} {...props}>
            {'label' in props && <Header className={header()}>{props.label}</Header>}
            <Collection {...(props.items ? { items: props.items } : {})}>{children}</Collection>
        </MenuSectionPrimitive>
    );
}

export {
    DropdownSeparator as MenuSeparator,
    DropdownKeyboard as MenuShortcut,
    DropdownLabel as MenuLabel,
    DropdownDescription as MenuDescription,
} from './dropdown';
