import type { Json } from '@/lib/db/types';
import { ingest, type Db } from '@/lib/ingest/ingest';
import { parseImport, type RowError } from './parse';
import type { ImportKind } from './templates';

export type ImportSummary = {
  batchId: string | null;
  status: 'completed' | 'completed_with_errors' | 'failed';
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  duplicatesSkipped: number;
  errors: RowError[];
  ignoredColumns: string[];
};

export type RunImportInput = {
  organizationId: string;
  socialAccountId: string;
  platformKey: string;
  userId: string;
  kind: ImportKind;
  fileName: string;
  text: string;
  now?: Date;
};

const MAX_STORED_ERRORS = 50;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Imports a CSV as the signed-in user. Every value lands as "imported" data tied to
 * an import batch, so it can always be told apart from data read live from a platform.
 */
export async function runImport(db: Db, input: RunImportInput): Promise<ImportSummary> {
  const now = input.now ?? new Date();
  let parsed;
  try {
    parsed = parseImport(input.kind, input.text, now);
  } catch (error) {
    return failed([
      { row: 1, message: error instanceof Error ? error.message : 'Could not read the file.' },
    ]);
  }
  if (parsed.rowsValid === 0) {
    return {
      ...failed(parsed.errors),
      rowsTotal: parsed.rowsTotal,
      rowsSkipped: parsed.rowsTotal,
      ignoredColumns: parsed.ignoredColumns,
    };
  }

  const { data: batch, error: batchError } = await db
    .from('import_batches')
    .insert({
      organization_id: input.organizationId,
      social_account_id: input.socialAccountId,
      platform_key: input.platformKey,
      kind: input.kind,
      file_name: input.fileName.slice(0, 200),
      rows_total: parsed.rowsTotal,
      created_by: input.userId,
    })
    .select('id')
    .single();
  if (batchError)
    return failed([{ row: 1, message: 'Could not start the import. Please try again.' }]);

  const errors = [...parsed.errors];
  let duplicatesSkipped = 0;
  let ingestFailed = false;
  const base = {
    organizationId: input.organizationId,
    socialAccountId: input.socialAccountId,
    platformKey: input.platformKey,
    dataSource: 'imported' as const,
    importBatchId: batch.id,
  };
  try {
    if (input.kind === 'account_metrics') {
      const result = await ingest(
        db,
        { ...base, capturedAt: now.toISOString(), accountMetrics: parsed.accountMetrics },
        'user',
      );
      duplicatesSkipped += result.duplicatesSkipped;
      errors.push(
        ...result.rejected.map((reject) => ({
          row: 0,
          message: `${reject.ref}: ${reject.reason}`,
        })),
      );
    } else {
      for (const group of parsed.postGroups) {
        const result = await ingest(
          db,
          { ...base, capturedAt: group.capturedAt, posts: group.posts, postMetrics: group.metrics },
          'user',
        );
        duplicatesSkipped += result.duplicatesSkipped;
        errors.push(
          ...result.rejected.map((reject) => ({
            row: 0,
            message: `${reject.ref}: ${reject.reason}`,
          })),
        );
      }
    }
  } catch {
    ingestFailed = true;
    errors.push({
      row: 0,
      message: 'Saving stopped part way. Rows already saved stay in this import.',
    });
  }

  const rowsSkipped = parsed.rowsTotal - parsed.rowsValid;
  const status = ingestFailed ? 'failed' : errors.length ? 'completed_with_errors' : 'completed';
  await db
    .from('import_batches')
    .update({
      status,
      rows_imported: parsed.rowsValid,
      rows_skipped: rowsSkipped,
      errors: errors.slice(0, MAX_STORED_ERRORS) as unknown as NonNullable<Json>,
      completed_at: new Date().toISOString(),
    })
    .eq('id', batch.id);

  return {
    batchId: batch.id,
    status,
    rowsTotal: parsed.rowsTotal,
    rowsImported: parsed.rowsValid,
    rowsSkipped,
    duplicatesSkipped,
    errors,
    ignoredColumns: parsed.ignoredColumns,
  };
}

function failed(errors: RowError[]): ImportSummary {
  return {
    batchId: null,
    status: 'failed',
    rowsTotal: 0,
    rowsImported: 0,
    rowsSkipped: 0,
    duplicatesSkipped: 0,
    errors,
    ignoredColumns: [],
  };
}
