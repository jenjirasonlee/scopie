import { Logo } from '@/components/shared/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-muted/40 flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo className="text-lg" />
      </div>
      <div className="bg-card w-full max-w-sm rounded-lg border p-6">{children}</div>
      <p className="text-muted-foreground mt-6 text-xs">
        Content intelligence for modern marketing teams.
      </p>
    </main>
  );
}
