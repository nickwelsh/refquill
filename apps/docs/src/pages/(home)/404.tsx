import { Link } from 'fumadocs-core/link';

export default function NotFound() {
    return (
        <main id="main-content" className="min-w-0 py-12 sm:py-20">
            <h1 className="text-3xl">Page not found</h1>
            <p className="my-6 text-muted-foreground">This documentation page does not exist.</p>
            <Link href="/docs" className="text-primary">
                Return to documentation
            </Link>
        </main>
    );
}
