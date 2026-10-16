'use client';

import { useRef } from 'react';
import type { RefObject } from 'react';
import { Dialog } from 'react-aria-components/Dialog';
import type { DialogProps } from 'react-aria-components/Dialog';
import { Modal, ModalOverlay } from 'react-aria-components/Modal';
import type { ModalOverlayProps } from 'react-aria-components/Modal';
import { useMove } from 'react-aria/useMove';
import { cx } from '@/lib/primitive';

function SheetHandle({ sheet, close }: { sheet: RefObject<HTMLDivElement | null>; close: () => void }) {
    const distance = useRef(0);
    const { moveProps } = useMove({
        onMoveStart: () => {
            distance.current = 0;
            sheet.current?.toggleAttribute('data-dragging', true);
        },
        onMove: (event) => {
            distance.current = Math.max(0, distance.current + event.deltaY);
            sheet.current?.style.setProperty('--sheet-drag', `${distance.current}px`);
        },
        onMoveEnd: () => {
            sheet.current?.toggleAttribute('data-dragging', false);
            if (distance.current > 80) {
                close();
            } else {
                sheet.current?.style.setProperty('--sheet-drag', '0px');
            }
        },
    });
    return (
        <div {...moveProps} className="sheet-drag-handle" aria-hidden="true">
            <span />
        </div>
    );
}

export { DialogTrigger as SheetTrigger } from 'react-aria-components/Dialog';

export interface SheetProps
    extends Omit<ModalOverlayProps, 'children'>, Pick<DialogProps, 'aria-label' | 'aria-labelledby' | 'children'> {}

export function Sheet({
    className,
    children,
    'aria-label': label,
    'aria-labelledby': labelledBy,
    ...props
}: SheetProps) {
    const sheet = useRef<HTMLDivElement>(null);
    return (
        <ModalOverlay
            {...props}
            isDismissable
            className="sheet-overlay fixed inset-0 z-50 flex h-(--visual-viewport-height,100dvh) items-end justify-center overflow-hidden"
        >
            <Modal
                ref={sheet}
                data-slot="sheet"
                className={cx(
                    'sheet-panel relative w-full max-w-[800px] rounded-t-4xl border border-b-0 border-foreground/20 material-thick overlay-surface text-overlay-foreground dark:border-border',
                    className,
                )}
            >
                <Dialog
                    {...(label === undefined ? {} : { 'aria-label': label })}
                    {...(labelledBy === undefined ? {} : { 'aria-labelledby': labelledBy })}
                    data-slot="sheet-content"
                    className="relative flex max-h-(--visual-viewport-height,100dvh) flex-col overflow-hidden outline-hidden [--gutter:--spacing(6)]"
                >
                    {(values) => (
                        <>
                            <SheetHandle sheet={sheet} close={values.close} />
                            {typeof children === 'function' ? children(values) : children}
                        </>
                    )}
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}

export {
    DialogFooter as SheetFooter,
    DialogHeader as SheetHeader,
    DialogTitle as SheetTitle,
    DialogDescription as SheetDescription,
    DialogBody as SheetBody,
    DialogClose as SheetClose,
} from './dialog';
