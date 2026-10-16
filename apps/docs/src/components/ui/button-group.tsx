import { Group } from 'react-aria-components/Group';
import type { GroupProps } from 'react-aria-components/Group';
import { composeRenderProps } from 'react-aria-components/composeRenderProps';
import { tv } from 'tailwind-variants';
import type { VariantProps } from 'tailwind-variants';

// Intent UI button-group, using the site's existing Button and Menu primitives.
const buttonGroupStyles = tv({
    base: "flex w-fit items-stretch *:focus-visible:relative *:focus-visible:z-10 has-[>[data-slot=button-group]]:gap-2 has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-e-md [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
    variants: {
        orientation: {
            horizontal:
                '[&>*:not(:first-child)]:rounded-s-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-e-none',
            vertical:
                'flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:border-t-0 [&>*:not(:last-child)]:rounded-b-none',
        },
    },
    defaultVariants: { orientation: 'horizontal' },
});

export function ButtonGroup({ className, orientation, ...props }: GroupProps & VariantProps<typeof buttonGroupStyles>) {
    return (
        <Group
            data-slot="button-group"
            data-orientation={orientation}
            className={composeRenderProps(className, (renderedClassName) =>
                buttonGroupStyles({ orientation, className: renderedClassName }),
            )}
            {...props}
        />
    );
}
