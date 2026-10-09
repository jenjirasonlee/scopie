import Link from 'next/link';
import { SubmitButton } from '@/components/shared/submit-button';
import { Badge } from '@/components/ui/badge';
import {
  createTaxonomyItem,
  setTaxonomyItemActive,
  updateTaxonomyItem,
} from '@/lib/taxonomy/actions';
import {
  campaignDates,
  pillarColorClass,
  PILLAR_COLOR_LABELS,
  TAXONOMY,
  TAXONOMY_KINDS,
  type Campaign,
  type Pillar,
  type Taxonomy,
  type TaxonomyItem,
  type TaxonomyKind,
} from '@/lib/taxonomy/shared';
import { cn } from '@/lib/utils';
import { TaxonomyItemForm } from './item-form';

/** One link per taxonomy list, with how many active items each has. Plain links, so no JavaScript is needed. */
export function TaxonomyTabs({
  orgSlug,
  current,
  taxonomy,
}: {
  orgSlug: string;
  current: TaxonomyKind;
  taxonomy: Taxonomy;
}) {
  return (
    <nav aria-label="Taxonomy lists" className="flex flex-wrap gap-1 border-b">
      {TAXONOMY_KINDS.map((kind) => {
        const active = kind === current;
        const count = taxonomy[kind].filter((item) => item.isActive).length;
        return (
          <Link
            key={kind}
            href={`/${orgSlug}/settings/taxonomy?list=${TAXONOMY[kind].slug}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'text-muted-foreground hover:text-foreground -mb-px border-b-2 border-transparent px-2.5 py-2 text-[13px]',
              active && 'border-primary text-foreground font-medium',
            )}
          >
            {TAXONOMY[kind].label}
            <span className="text-muted-foreground ml-1.5 text-xs tabular-nums">{count}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** The items of one list, with forms to add, edit, deactivate and reactivate for managers. */
export function TaxonomySection({
  orgSlug,
  kind,
  items,
  canManage,
}: {
  orgSlug: string;
  kind: TaxonomyKind;
  items: TaxonomyItem[];
  canManage: boolean;
}) {
  const meta = TAXONOMY[kind];
  return (
    <section aria-labelledby={`${kind}-heading`} className="space-y-4">
      <div>
        <h3 id={`${kind}-heading`} className="text-sm font-semibold">
          {meta.label}
        </h3>
        <p className="text-muted-foreground text-[13px]">{meta.description}</p>
      </div>

      {canManage ? (
        <details className="bg-card rounded-lg border px-4 py-3" open={items.length === 0}>
          <summary className="text-primary cursor-pointer text-[13px] font-medium">
            Add a {meta.singular}
          </summary>
          <div className="pt-4">
            <TaxonomyItemForm
              action={createTaxonomyItem.bind(null, orgSlug, kind)}
              kind={kind}
              submitLabel={`Add ${meta.singular}`}
              idPrefix={`new-${kind}`}
            />
          </div>
        </details>
      ) : null}

      {items.length === 0 ? (
        <p className="text-muted-foreground bg-card rounded-lg border border-dashed px-6 py-8 text-center text-[13px]">
          No {meta.plural} yet.
          {canManage ? null : ' Owners, admins and managers can add them.'}
        </p>
      ) : (
        <ul className="bg-card divide-y rounded-lg border">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              orgSlug={orgSlug}
              kind={kind}
              item={item}
              canManage={canManage}
            />
          ))}
        </ul>
      )}
      {canManage && items.length ? (
        <p className="text-muted-foreground text-xs">
          Items can&apos;t be deleted. Deactivate one to stop it being offered for new content;
          content already tagged with it keeps the tag.
        </p>
      ) : null}
    </section>
  );
}

function ItemRow({
  orgSlug,
  kind,
  item,
  canManage,
}: {
  orgSlug: string;
  kind: TaxonomyKind;
  item: TaxonomyItem;
  canManage: boolean;
}) {
  const color = kind === 'pillars' ? (item as Pillar).color : undefined;
  const dates = kind === 'campaigns' ? campaignDates(item as Campaign) : null;
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div
          className={cn('min-w-0 flex-1 space-y-0.5', !item.isActive && 'text-muted-foreground')}
        >
          <div className="flex flex-wrap items-center gap-2">
            {kind === 'pillars' ? (
              <span
                className={cn(
                  'size-3 shrink-0 rounded-full',
                  pillarColorClass(color),
                  !item.isActive && 'opacity-50',
                )}
                title={color ? PILLAR_COLOR_LABELS[color] : 'No colour'}
                aria-hidden
              />
            ) : null}
            <span className="text-sm font-medium break-words">{item.name}</span>
            {item.isActive ? null : <Badge variant="muted">Inactive</Badge>}
          </div>
          {dates ? <p className="text-xs">{dates}</p> : null}
          {item.description ? (
            <p className="text-muted-foreground text-[13px] break-words">{item.description}</p>
          ) : null}
        </div>
        {canManage ? (
          <form action={setTaxonomyItemActive.bind(null, orgSlug)}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="active" value={item.isActive ? 'false' : 'true'} />
            <SubmitButton
              variant="ghost"
              size="sm"
              aria-label={`${item.isActive ? 'Deactivate' : 'Reactivate'} ${item.name}`}
            >
              {item.isActive ? 'Deactivate' : 'Reactivate'}
            </SubmitButton>
          </form>
        ) : null}
      </div>
      {canManage ? (
        <details>
          <summary className="text-primary cursor-pointer text-xs font-medium">Edit</summary>
          <div className="pt-3">
            <TaxonomyItemForm
              action={updateTaxonomyItem.bind(null, orgSlug, kind, item.id)}
              kind={kind}
              item={{
                name: item.name,
                description: item.description,
                color,
                startsOn: (item as Campaign).startsOn,
                endsOn: (item as Campaign).endsOn,
              }}
              submitLabel="Save changes"
              idPrefix={`edit-${item.id}`}
            />
          </div>
        </details>
      ) : null}
    </li>
  );
}
