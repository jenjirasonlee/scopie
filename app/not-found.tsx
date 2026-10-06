import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">404</p>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="text-muted-foreground max-w-sm text-[13px]">
        The page doesn&apos;t exist, or it belongs to an organization you&apos;re not a member of.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/">Go to Scopie</Link>
      </Button>
    </main>
  );
}
