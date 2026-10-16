import { carbonIcons } from 'virtual:carbon-icons';
import type { SVGProps } from 'react';

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: string }) {
    const Component = carbonIcons[name.replace(/^carbon[:/]/u, '')];
    if (!Component) {
        throw new Error(
            `Carbon icon "${name}" was not compiled. Use a literal <Icon name="…" /> or an icon in docs metadata.`,
        );
    }
    return <Component aria-hidden="true" {...props} />;
}
