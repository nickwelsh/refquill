'use client';
import { useTheme } from 'next-themes';
import Moon from '~icons/carbon/moon';
import Sun from '~icons/carbon/sun';
import Laptop from '~icons/carbon/laptop';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem, MenuLabel, MenuTrigger } from '@/components/ui/menu';

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    return (
        <MenuTrigger>
            <Button intent="plain" size="sq-sm" aria-label="Appearance">
                <Laptop />
            </Button>
            <Menu
                aria-label="Appearance"
                selectionMode="single"
                selectedKeys={[theme ?? 'system']}
                onAction={(key) => setTheme(String(key))}
            >
                <MenuItem id="system" textValue="System">
                    {({ isSelected }) => (
                        <>
                            {!isSelected && <Laptop />}
                            <MenuLabel>System</MenuLabel>
                        </>
                    )}
                </MenuItem>
                <MenuItem id="light" textValue="Light">
                    {({ isSelected }) => (
                        <>
                            {!isSelected && <Sun />}
                            <MenuLabel>Light</MenuLabel>
                        </>
                    )}
                </MenuItem>
                <MenuItem id="dark" textValue="Dark">
                    {({ isSelected }) => (
                        <>
                            {!isSelected && <Moon />}
                            <MenuLabel>Dark</MenuLabel>
                        </>
                    )}
                </MenuItem>
            </Menu>
        </MenuTrigger>
    );
}
