import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DEMO_PDF_LINE, pdfText, renderReportPdf, reportPdfFilename } from '@/lib/reports/pdf';
import type { ReportSnapshot } from '@/lib/reports/types';
import { REPORT_SNAPSHOT_FIXTURE } from '../fixtures/report-snapshot';

// Windows-1252's 0x80–0x9F block (Node's TextDecoder reads that label as Latin-1).
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';
const fromWindows1252 = (bytes: Buffer) =>
  [...bytes]
    .map((byte) =>
      byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : String.fromCharCode(byte),
    )
    .join('');

const INPUT = {
  title: 'Weekly report: 28 Sept – 4 Oct 2026',
  madeBy: 'Made by Demo Manager on 5 Oct 2026, 09:12',
  createdAt: '2026-10-05T07:12:00.000Z',
};

/**
 * The text drawn in a PDF, roughly: inflates every content stream and decodes the hex strings
 * the standard fonts are written with (one byte per Windows-1252 character).
 */
function drawnText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const parts: string[] = [];
  const streams = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streams.exec(raw))) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    try {
      const content = inflateSync(pdf.subarray(start, end)).toString('latin1');
      for (const line of content.split('\n')) {
        if (!line.endsWith('TJ')) continue;
        const hex = [...line.matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => m[1]).join('');
        parts.push(fromWindows1252(Buffer.from(hex, 'hex')));
      }
    } catch {
      // Not a deflated stream (a font program, say).
    }
    streams.lastIndex = end + 'endstream'.length;
  }
  // Words and wrapped lines come as separate strings; spacing is normalised.
  return parts.join(' ').replace(/\s+/g, ' ');
}

const pageCount = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

describe('weekly report PDF', () => {
  it('renders the stored snapshot to an A4 PDF', async () => {
    const pdf = await renderReportPdf({ ...INPUT, snapshot: REPORT_SNAPSHOT_FIXTURE });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5_000);
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(2);
    // A4 in points.
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28\d* 841\.89\d*\]/);
  }, 30_000);

  it('shows the sections, numbers and wording as stored', async () => {
    const pdf = await renderReportPdf({ ...INPUT, snapshot: REPORT_SNAPSHOT_FIXTURE });
    const text = drawnText(pdf);
    for (const expected of [
      'Weekly report: 28 Sept – 4 Oct 2026',
      'Made by Demo Manager on 5 Oct 2026, 09:12',
      'Summary',
      'The week in numbers',
      '+1,240',
      'Markets',
      'Competitor watch',
      'Not ranked (1)',
      'Only one follower count this week',
      'Top content',
      '1,284',
      'Strategy',
      'Key insights',
      'No risks found this week.',
      'Recommended actions',
      'Medium confidence',
      'Who wrote it',
      'What this report couldn’t include',
      'numbers frozen when the report was made',
    ]) {
      expect(text).toContain(expected);
    }
  }, 30_000);

  it('marks DEMO data on every page and shows page numbers', async () => {
    const pdf = await renderReportPdf({ ...INPUT, snapshot: REPORT_SNAPSHOT_FIXTURE });
    const text = drawnText(pdf);
    const pages = pageCount(pdf);
    // Once in the running header and once in the footer of every page, plus the first-page banner.
    expect(text.split(DEMO_PDF_LINE).length - 1).toBeGreaterThanOrEqual(pages * 2 + 1);
    expect(text).toContain(`Page 1 of ${pages}`);
    expect(text).toContain(`Page ${pages} of ${pages}`);
  }, 30_000);

  it('shows unknown numbers as N/A with the reason, never as 0', async () => {
    const pdf = await renderReportPdf({ ...INPUT, snapshot: REPORT_SNAPSHOT_FIXTURE });
    const text = drawnText(pdf);
    const unknown = REPORT_SNAPSHOT_FIXTURE.kpis.filter((kpi) => kpi.value === null);
    expect(unknown.length).toBeGreaterThan(0);
    expect(text.split('N/A').length - 1).toBeGreaterThanOrEqual(unknown.length);
    for (const kpi of unknown) expect(text).toContain(kpi.unavailable!);
    expect(text).toContain('No comparison: the week before isn’t known.');
  }, 30_000);

  it('has no DEMO marking for real data, and leaves out the insights when there was no analysis', async () => {
    const snapshot: ReportSnapshot = {
      ...structuredClone(REPORT_SNAPSHOT_FIXTURE),
      orgName: 'Acme',
      isDemo: false,
      dataSource: 'live_public',
      analysis: null,
      markets: [],
      notes: [],
    };
    const text = drawnText(await renderReportPdf({ ...INPUT, snapshot }));
    expect(text).not.toContain('DEMO DATA');
    expect(text).not.toContain('Key insights');
    expect(text).toContain('Nothing to report: no own profiles to rank.');
    expect(text).toContain('No analysis could be made for this week');
    expect(text).not.toContain('What this report couldn’t include');
  }, 30_000);
});

describe('report PDF helpers', () => {
  it('names the file after the week', () => {
    expect(reportPdfFilename({ start: '2026-09-28', end: '2026-10-04' })).toBe(
      'scopie-weekly-report-2026-09-28.pdf',
    );
    expect(reportPdfFilename({ start: '../"evil', end: '' })).toBe('scopie-weekly-report-week.pdf');
  });

  it('keeps text the standard fonts can draw and swaps the rest', () => {
    expect(pdfText('Café – 1.6× “ok” ’s')).toBe('Café – 1.6× “ok” ’s');
    expect(pdfText('−3 → 5')).toBe('-3 -> 5');
    expect(pdfText('カンナ')).toBe('???');
  });
});
