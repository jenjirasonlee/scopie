import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { FormState } from '@/lib/forms';

export function FormMessage({ state }: { state: FormState }) {
  if (!state.message || state.status === 'idle') return null;
  const success = state.status === 'success';
  return (
    <Alert variant={success ? 'success' : 'destructive'} aria-live="polite">
      {success ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}
