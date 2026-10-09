import { CheckCircle2, Circle } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type ChecklistItem = {
  label: string;
  done: boolean;
  href?: string;
  optional?: boolean;
  help?: string;
};

/** Setup steps; hidden once every required step is done. */
export function GettingStarted({ items }: { items: ChecklistItem[] }) {
  if (items.every((item) => item.done || item.optional)) return null;
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Getting started</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.label} className="flex items-start gap-2.5 text-[13px]">
              {item.done ? (
                <CheckCircle2 className="text-success mt-px size-4 shrink-0" aria-label="Done" />
              ) : (
                <Circle
                  className="text-muted-foreground/60 mt-px size-4 shrink-0"
                  aria-label="Not done"
                />
              )}
              <span className={item.done ? 'text-muted-foreground' : undefined}>
                {item.href && !item.done ? (
                  <Link href={item.href} className="text-primary font-medium hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  item.label
                )}
                {item.optional ? <span className="text-muted-foreground"> (optional)</span> : null}
                {item.help && !item.done ? (
                  <span className="text-muted-foreground block text-xs">{item.help}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
