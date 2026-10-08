import { FileText, Film, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { removeContentAsset } from '@/lib/content/actions';
import {
  ACCEPTED_FILE_TYPES,
  ACCEPTED_FILES_HINT,
  assetKind,
  formatBytes,
} from '@/lib/content/files';
import type { ContentAsset } from '@/lib/content/queries';

export function assetUrl(assetId: string, download = false) {
  return `/api/content-assets/${assetId}${download ? '?download=1' : ''}`;
}

/** The files of the version being shown, with upload and remove for editors. */
export function ContentAssets({
  orgSlug,
  itemId,
  assets,
  canEdit,
  uploadsReady,
  versionLabel,
  uploaded,
  uploadError,
}: {
  orgSlug: string;
  itemId: string;
  assets: ContentAsset[];
  /** True when this is the current, editable version and the person may edit. */
  canEdit: boolean;
  uploadsReady: boolean;
  versionLabel: string;
  uploaded?: number;
  uploadError?: string;
}) {
  const remove = removeContentAsset.bind(null, orgSlug);
  return (
    <Card id="files">
      <CardHeader>
        <CardTitle>Files</CardTitle>
        <CardDescription>
          Images, videos and PDFs for {versionLabel}. Only members of this organization can open
          them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {uploadError ? (
          <p role="alert" className="text-destructive text-[13px]">
            {uploadError}
          </p>
        ) : uploaded ? (
          <p className="text-success text-[13px]" aria-live="polite">
            {uploaded === 1 ? 'File added.' : `${uploaded} files added.`}
          </p>
        ) : null}

        {assets.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {assets.map((asset) => {
              const kind = assetKind(asset.mime_type);
              return (
                <li key={asset.id} className="bg-card overflow-hidden rounded-md border">
                  <a
                    href={assetUrl(asset.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-muted/40 flex aspect-video items-center justify-center"
                  >
                    {kind === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element -- private, authenticated file
                      <img
                        src={assetUrl(asset.id)}
                        alt={asset.file_name}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    ) : kind === 'video' ? (
                      <Film className="text-muted-foreground size-8" aria-hidden />
                    ) : (
                      <FileText className="text-muted-foreground size-8" aria-hidden />
                    )}
                  </a>
                  <div className="flex items-start justify-between gap-2 p-2.5">
                    <div className="min-w-0 text-[13px]">
                      <p className="truncate font-medium" title={asset.file_name}>
                        {asset.file_name}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {formatBytes(asset.bytes)}
                        {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
                        {' · '}
                        <a href={assetUrl(asset.id, true)} className="hover:underline">
                          Download
                        </a>
                      </p>
                    </div>
                    {canEdit ? (
                      <form action={remove}>
                        <input type="hidden" name="itemId" value={itemId} />
                        <input type="hidden" name="assetId" value={asset.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${asset.file_name}`}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-[13px]">No files yet.</p>
        )}

        {canEdit ? (
          uploadsReady ? (
            <form
              action="/api/content-assets"
              method="post"
              encType="multipart/form-data"
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="itemId" value={itemId} />
              <div className="space-y-1">
                <label htmlFor="content-files" className="text-muted-foreground block text-xs">
                  {ACCEPTED_FILES_HINT}
                </label>
                <Input
                  id="content-files"
                  type="file"
                  name="files"
                  accept={ACCEPTED_FILE_TYPES}
                  multiple
                  required
                  className="max-w-sm"
                />
              </div>
              <Button type="submit" variant="outline">
                <Upload aria-hidden />
                Upload
              </Button>
            </form>
          ) : (
            <p className="text-muted-foreground text-[13px]">
              File uploads aren’t set up on this server yet. Whoever runs Scopie sets ASSET_STORAGE
              (see .env.example).
            </p>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
