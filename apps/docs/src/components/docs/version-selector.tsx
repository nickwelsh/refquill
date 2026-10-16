'use client';
import ChevronDown from '~icons/carbon/chevron-down';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem, MenuLabel, MenuSubMenu, MenuTrigger } from '@/components/ui/menu';
import { getVersionPageUrl } from '@/lib/docs-navigation';
import type { DocsVersion } from '@/lib/docs-navigation';

const statusBadges = { latest: 'Current', stable: undefined, deprecated: 'Deprecated' };

function VersionBadges({ version }: { version: DocsVersion }) {
    const statusBadge = statusBadges[version.status];
    const badges = [...new Set([...(statusBadge === undefined ? [] : [statusBadge]), ...version.badges])];
    return badges.length > 0 ? (
        <span className="version-badges">
            {badges.map((badge) => (
                <span
                    key={badge}
                    className="version-badge"
                    data-status={badge === statusBadge ? version.status : undefined}
                >
                    {badge}
                </span>
            ))}
        </span>
    ) : null;
}

export function VersionSelector({
    versions,
    current,
    pageUrl,
}: {
    versions: Array<DocsVersion>;
    current: DocsVersion;
    pageUrl: string;
}) {
    const deprecated = versions.filter((version) => version.status === 'deprecated');
    const groupDeprecated = deprecated.length > 1;
    const visible = groupDeprecated ? versions.filter((version) => version.status !== 'deprecated') : versions;
    const renderVersion = (version: DocsVersion) => (
        <MenuItem
            key={version.url}
            id={version.url}
            href={getVersionPageUrl(current, version, pageUrl)}
            textValue={`Version ${version.name}`}
        >
            <MenuLabel className="version-label">
                <span>Version {version.name}</span>
                <VersionBadges version={version} />
            </MenuLabel>
        </MenuItem>
    );
    return (
        <MenuTrigger>
            <Button intent="plain" size="sm" className="version-trigger">
                Version {current.name}
                <ChevronDown />
            </Button>
            <Menu
                aria-label="Documentation version"
                popover={{ placement: 'bottom end', className: 'docs-version-menu' }}
                selectionMode="single"
                selectedKeys={[current.url]}
            >
                {visible.map((version) => renderVersion(version))}
                {groupDeprecated && (
                    <MenuSubMenu>
                        <MenuItem id="deprecated-versions" textValue="Deprecated versions">
                            Deprecated versions
                        </MenuItem>
                        <Menu
                            aria-label="Deprecated versions"
                            items={deprecated}
                            selectionMode="single"
                            selectedKeys={[current.url]}
                            popover={{ className: 'docs-version-menu' }}
                        >
                            {renderVersion}
                        </Menu>
                    </MenuSubMenu>
                )}
            </Menu>
        </MenuTrigger>
    );
}
