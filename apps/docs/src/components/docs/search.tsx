'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'fumadocs-core/framework';
import { useStaticSearch } from 'fumadocs-core/search/client';
import { Autocomplete, SearchField, Input, ListBoxItem, ListBox, FieldInputContext } from 'react-aria-components';
import { SelectableCollectionContext } from 'react-aria-components/Autocomplete';
import { useOverlay } from 'react-aria/useOverlay';
import { useOverlayPosition } from 'react-aria/useOverlayPosition';
import { Overlay } from 'react-aria/Overlay';
import { mergeProps } from 'react-aria/mergeProps';
import { usePreventScroll } from 'react-aria/usePreventScroll';
import SearchIcon from '~icons/carbon/search';
import Close from '~icons/carbon/close';
import ArrowUp from '~icons/carbon/arrow-up';
import ArrowDown from '~icons/carbon/arrow-down';
import Return from '~icons/carbon/return';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import type { SearchSection } from '@/lib/search';
import { SearchResultContent } from './search-result';
import { TagGroup, TagList, Tag } from '@/components/ui/tag-group';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { publicPath } from '@/lib/shared';

function ShortcutTag({ children }: { children: string }) {
    return (
        <div className="search-shortcut" aria-hidden="true" inert>
            <SelectableCollectionContext value={null}>
                <TagGroup aria-label="Keyboard shortcut" selectionMode="none">
                    <TagList>
                        <Tag textValue={children} className="search-shortcut-tag">
                            <kbd>{children}</kbd>
                        </Tag>
                    </TagList>
                </TagGroup>
            </SelectableCollectionContext>
        </div>
    );
}

const mobileQuery = '(width < 768px)';
function subscribeToViewport(onChange: () => void) {
    const media = globalThis.matchMedia(mobileQuery);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
}
const isMobileViewport = () => globalThis.matchMedia(mobileQuery).matches;
const serverViewport = () => false;

export function DocsSearch({ version, sections }: { version: string; sections: Array<SearchSection> }) {
    const [open, setOpen] = useState(false);
    const [section, setSection] = useState('all');
    const tag = sections.some((item) => item.id === section) ? section : version;
    const mobile = useSyncExternalStore(subscribeToViewport, isMobileViewport, serverViewport);
    usePreventScroll({ isDisabled: !open });
    const field = useRef<HTMLDivElement>(null);
    const dropdown = useRef<HTMLDivElement>(null);
    const selectOnOpen = useRef(false);
    function shouldCloseOnInteractOutside(target: Element) {
        return (
            field.current?.contains(target) !== true &&
            dropdown.current?.contains(target) !== true &&
            !target.closest('.search-filter-popover')
        );
    }
    const { overlayProps } = useOverlay(
        {
            isOpen: open && !mobile,
            isDismissable: true,
            shouldCloseOnBlur: true,
            shouldCloseOnInteractOutside,
            onClose: () => setOpen(false),
        },
        dropdown,
    );
    const { overlayProps: positionProps } = useOverlayPosition({
        targetRef: field,
        overlayRef: dropdown,
        isOpen: open && !mobile,
        placement: 'bottom',
        offset: 8,
        onClose: null,
    });
    useEffect(() => {
        if (open) {
            const container = mobile ? dropdown.current : field.current;
            const input = container?.querySelector('input');
            input?.focus({ preventScroll: true });
            if (selectOnOpen.current) {
                input?.select();
                selectOnOpen.current = false;
            }
        }
    }, [open, mobile]);
    const { push } = useRouter();
    const { search, onSearchChange, data, isLoading, error } = useStaticSearch({
        tag,
        from: publicPath('/api/search'),
    });
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                const input = field.current?.querySelector('input');
                if (open && input) {
                    input.focus({ preventScroll: true });
                    input.select();
                } else {
                    selectOnOpen.current = true;
                    setOpen(true);
                }
            }
        };
        globalThis.addEventListener('keydown', onKey);
        return () => globalThis.removeEventListener('keydown', onKey);
    }, [open]);
    const results =
        data?.query === search && !isLoading
            ? data.items.flatMap((item) => (item.type === 'table' ? item.rows : [item]))
            : [];
    let message = 'Type to search the docs.';
    if (search.length > 0) {
        message = results.length === 0 ? 'No results found.' : `${results.length} results`;
    }
    if (isLoading) {
        message = 'Searching…';
    }
    if (error) {
        message = 'Search failed. Please try again.';
    }
    const searchField = (
        <SearchField
            ref={field}
            aria-label="Search documentation"
            className="search-field"
            onFocus={() => setOpen(true)}
        >
            <SearchIcon />
            <Input
                placeholder="Search documentation…"
                onClick={() => setOpen(true)}
                onKeyDownCapture={(event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        event.currentTarget.blur();
                        setOpen(false);
                    }
                }}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                        setOpen(true);
                    }
                    if (event.key === 'Tab' && !mobile) {
                        const filter = dropdown.current?.querySelector<HTMLButtonElement>('.search-section-trigger');
                        if (filter && !event.shiftKey) {
                            event.preventDefault();
                            filter.focus();
                        } else {
                            setOpen(false);
                        }
                    }
                }}
            />
            {mobile ? (
                <Button
                    slot={null}
                    intent="plain"
                    size="sq-xs"
                    className="search-clear"
                    aria-label={search.length > 0 ? 'Clear search' : 'Close search'}
                    onPress={() => {
                        if (search.length > 0) {
                            onSearchChange('');
                            field.current?.querySelector('input')?.focus({ preventScroll: true });
                        } else {
                            setOpen(false);
                        }
                    }}
                >
                    <Close />
                </Button>
            ) : (
                <Button slot="clear" intent="plain" size="sq-xs" className="search-clear" aria-label="Clear search">
                    <Close />
                </Button>
            )}
            {!mobile && <ShortcutTag>⌘ K</ShortcutTag>}
        </SearchField>
    );
    const searchResults = (
        <>
            <output className="search-status" aria-live="polite">
                {message}
            </output>
            <ListBox aria-label="Search results" items={results} className="search-results">
                {(item) => (
                    <ListBoxItem
                        id={item.id}
                        textValue={item.content}
                        className="search-result"
                        data-result-type={item.type}
                        onAction={() => {
                            field.current?.querySelector('input')?.blur();
                            setOpen(false);
                            const target = new URL(publicPath(item.url), globalThis.location.href);
                            if (
                                target.pathname === globalThis.location.pathname &&
                                target.search === globalThis.location.search &&
                                target.hash.length > 0
                            ) {
                                globalThis.location.assign(target.href);
                            } else {
                                void push(item.url);
                            }
                        }}
                    >
                        <SearchResultContent item={item} query={search} />
                    </ListBoxItem>
                )}
            </ListBox>
            <div className="search-footer">
                {sections.length > 1 && (
                    <div className="search-filter">
                        <span>Filter</span>
                        <SelectableCollectionContext value={null}>
                            <FieldInputContext value={null}>
                                <Select
                                    aria-label="Filter search by section"
                                    className="search-section-select"
                                    value={tag === version ? 'all' : tag}
                                    onChange={(value) => setSection(String(value))}
                                >
                                    <SelectTrigger className="search-section-trigger" />
                                    <SelectContent popover={{ className: 'search-filter-popover' }}>
                                        <SelectItem id="all">All</SelectItem>
                                        {sections.map((item) => (
                                            <SelectItem key={item.id} id={item.id}>
                                                {item.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </FieldInputContext>
                        </SelectableCollectionContext>
                    </div>
                )}
                <div className="search-hints" aria-hidden="true">
                    <div>
                        <span className="search-arrow-keys">
                            <ArrowUp />
                            <ArrowDown />
                        </span>
                        Navigate
                    </div>
                    <div>
                        <Return />
                        Open
                    </div>
                    <div>
                        <ShortcutTag>Esc</ShortcutTag>Close
                    </div>
                </div>
            </div>
        </>
    );
    return (
        <div className="docs-search">
            <Autocomplete
                inputValue={search}
                onInputChange={(value) => {
                    onSearchChange(value);
                    setOpen(true);
                }}
            >
                {mobile ? (
                    <>
                        <Button
                            intent="plain"
                            size="sq-sm"
                            className="mobile-search-trigger"
                            aria-label="Search documentation"
                            aria-haspopup="dialog"
                            aria-expanded={open}
                            onPress={() => setOpen(true)}
                        >
                            <SearchIcon />
                        </Button>
                        <Sheet
                            aria-label="Search documentation"
                            isOpen={open}
                            onOpenChange={setOpen}
                            className="search-sheet"
                        >
                            <div ref={dropdown} className="search-sheet-body">
                                {searchField}
                                {searchResults}
                            </div>
                        </Sheet>
                    </>
                ) : (
                    <>
                        {searchField}
                        {open && (
                            <Overlay disableFocusManagement>
                                <div
                                    {...mergeProps(overlayProps, positionProps)}
                                    ref={dropdown}
                                    className="search-dropdown material-regular overlay-surface"
                                    data-empty={search.length === 0 || undefined}
                                >
                                    {searchResults}
                                </div>
                            </Overlay>
                        )}
                    </>
                )}
            </Autocomplete>
        </div>
    );
}
