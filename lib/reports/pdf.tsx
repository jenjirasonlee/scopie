import 'server-only';
import { Document, Font, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { CONFIDENCE_LABELS, insightKindLabel, SEVERITY_LABELS } from '@/lib/ai/shared';
import {
  formatDay,
  formatWeek,
  RANKING_ROLE_LABELS,
  reportWriterSentences,
  safeExternalUrl,
} from './shared';
import type {
  ReportAction,
  ReportInsight,
  ReportKpi,
  ReportPost,
  ReportRanking,
  ReportSnapshot,
  ReportStrategy,
  ReportWeek,
} from './types';

// The weekly report as a PDF (A4). It shows the stored snapshot exactly as the report page
// does, with the same sections and wording; nothing here recomputes a number. Uses the PDF
// standard fonts (Helvetica), so rendering needs no font files and no network.

export type ReportPdfInput = {
  title: string;
  /** "Made by Sam on 6 Oct 2026, 09:12" (madeByLine), in the report's time zone. */
  madeBy: string;
  createdAt: string;
  snapshot: ReportSnapshot;
};

export const DEMO_PDF_LINE = 'DEMO DATA — not real CANNA data';

/** "scopie-weekly-report-2026-09-28.pdf": safe for a Content-Disposition header. */
export function reportPdfFilename(week: ReportWeek): string {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(week.start) ? week.start : 'week';
  return `scopie-weekly-report-${start}.pdf`;
}

// The standard fonts only cover Windows-1252. The few typographic characters outside it that
// Scopie's own sentences use are swapped for their nearest equivalent so they don't vanish.
const REPLACEMENTS: Record<string, string> = {
  '−': '-', // minus sign
  '‑': '-', // non-breaking hyphen
  ' ': ' ', // thin space
  ' ': ' ', // narrow no-break space
  '→': '->',
  '←': '<-',
  '≥': '>=',
  '≤': '<=',
  '≈': '~',
};

const CP1252_EXTRA = new Set(
  '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split('').map((char) => char.codePointAt(0)!),
);

/** Text as the standard fonts can draw it; characters they can't are shown as "?". */
export function pdfText(value: string): string {
  let out = '';
  for (const char of value) {
    const replaced = REPLACEMENTS[char];
    if (replaced !== undefined) {
      out += replaced;
      continue;
    }
    const code = char.codePointAt(0)!;
    if (code === 0x0a || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      out += char;
    } else if (CP1252_EXTRA.has(code)) {
      out += char;
    } else if (code >= 0x300 && code <= 0x36f) {
      // A combining accent: dropped, the letter before it stays.
    } else {
      out += '?';
    }
  }
  return out;
}

const t = pdfText;

// No hyphenation: words wrap whole, as on the page ("be-fore" reads badly in a table cell).
Font.registerHyphenationCallback((word) => [word]);

const COLORS = {
  text: '#111827',
  muted: '#4b5563',
  faint: '#6b7280',
  border: '#d1d5db',
  rule: '#e5e7eb',
  header: '#f3f4f6',
  own: '#f1f5f9',
  demoBg: '#fef3c7',
  demoBorder: '#b45309',
  demoText: '#78350f',
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 74,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontFamily: 'Helvetica',
    fontSize: 9.5,
    color: COLORS.text,
  },
  // Resolves to 13.3pt and is inherited as that, as it would be from the Page.
  body: { fontSize: 9.5, lineHeight: 1.4 },
  runningHeader: {
    position: 'absolute',
    top: 22,
    left: 44,
    right: 44,
  },
  runningHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: COLORS.faint,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
    paddingBottom: 4,
  },
  demoStrip: {
    marginTop: 4,
    paddingVertical: 2,
    backgroundColor: COLORS.demoBg,
    borderWidth: 0.75,
    borderColor: COLORS.demoBorder,
    color: COLORS.demoText,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 44,
    right: 120,
    fontSize: 7.5,
    color: COLORS.faint,
  },
  // Spans the full width (right-aligned): a narrow box around render text is laid out empty.
  pageNumber: {
    position: 'absolute',
    bottom: 20,
    left: 44,
    right: 44,
    fontSize: 7.5,
    color: COLORS.faint,
    textAlign: 'right',
  },
  footerRule: {
    position: 'absolute',
    bottom: 34,
    left: 44,
    right: 44,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
  },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 18, lineHeight: 1.2, marginBottom: 4 },
  meta: { fontSize: 9.5, color: COLORS.muted },
  demoBanner: {
    marginTop: 10,
    padding: 8,
    backgroundColor: COLORS.demoBg,
    borderWidth: 1,
    borderColor: COLORS.demoBorder,
    color: COLORS.demoText,
  },
  demoBannerTitle: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  section: { marginTop: 18 },
  h2: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 12.5,
    marginBottom: 3,
    paddingBottom: 3,
    borderBottomWidth: 0.75,
    borderBottomColor: COLORS.text,
  },
  h3: { fontFamily: 'Helvetica-Bold', fontSize: 10.5, marginTop: 10, marginBottom: 3 },
  h4: { fontFamily: 'Helvetica-Bold', fontSize: 9.5 },
  description: { fontSize: 8.5, color: COLORS.muted, marginBottom: 6 },
  muted: { color: COLORS.muted },
  small: { fontSize: 8 },
  italic: { fontFamily: 'Helvetica-Oblique' },
  bold: { fontFamily: 'Helvetica-Bold' },
  bulletRow: { flexDirection: 'row', marginBottom: 2 },
  bullet: { width: 12 },
  bulletText: { flex: 1 },
  // Rows carry the side borders, so a table split over two pages stays boxed on both.
  tr: {
    flexDirection: 'row',
    borderTopWidth: 0.5,
    borderTopColor: COLORS.rule,
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderLeftColor: COLORS.border,
    borderRightColor: COLORS.border,
  },
  tableEnd: { borderTopWidth: 0.5, borderTopColor: COLORS.border },
  th: {
    flexDirection: 'row',
    borderWidth: 0.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.header,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
  },
  cell: { paddingVertical: 3.5, paddingHorizontal: 5 },
  right: { textAlign: 'right' },
  card: {
    borderWidth: 0.5,
    borderColor: COLORS.border,
    padding: 8,
    marginBottom: 6,
  },
  pill: { fontSize: 7.5, color: COLORS.muted, marginBottom: 2 },
});

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Section({
  title,
  description,
  empty,
  children,
}: {
  title: string;
  description?: string;
  /** Shown instead of the body; null leaves the whole section out (as on the page). */
  empty?: string | null;
  children?: React.ReactNode;
}) {
  if (empty === null) return null;
  return (
    <View style={styles.section}>
      {/* Keeps a heading together with the start of its section. */}
      <View wrap={false} minPresenceAhead={60}>
        <Text style={styles.h2}>{t(title)}</Text>
        {description ? <Text style={styles.description}>{t(description)}</Text> : null}
      </View>
      {empty ? <Text style={[styles.muted, { fontSize: 9 }]}>{t(empty)}</Text> : children}
    </View>
  );
}

function Bullets({ items, muted = false }: { items: string[]; muted?: boolean }) {
  return (
    <View>
      {items.map((item, index) => (
        <View key={index} style={styles.bulletRow} wrap={false}>
          <Text style={[styles.bullet, muted ? styles.muted : {}]}>•</Text>
          <Text style={[styles.bulletText, muted ? styles.muted : {}]}>{t(item)}</Text>
        </View>
      ))}
    </View>
  );
}

type Column = { label: string; width: number | string; align?: 'right' };

function TableHead({ columns }: { columns: readonly Column[] }) {
  return (
    <View style={styles.th}>
      {columns.map((column, index) => (
        <Text
          key={index}
          style={[styles.cell, { width: column.width }, column.align ? styles.right : {}]}
        >
          {t(column.label)}
        </Text>
      ))}
    </View>
  );
}

/**
 * A table whose rows never split. What leads into it (a heading), its column heads and its
 * first row stay on one page, so a heading or a header row is never left alone at the bottom.
 */
function Table({
  columns,
  lead,
  children,
}: {
  columns: readonly Column[];
  lead?: React.ReactNode;
  children: React.ReactNode[];
}) {
  const [first, ...rest] = children;
  return (
    <View>
      <View wrap={false}>
        {lead}
        <TableHead columns={columns} />
        {first}
      </View>
      {rest}
      <View style={styles.tableEnd} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const KPI_COLUMNS = [
  { label: 'Number', width: '24%' },
  { label: 'This week', width: '13%', align: 'right' },
  { label: 'Compared with the week before', width: '28%' },
  { label: 'What it is made of', width: '35%' },
] as const satisfies readonly Column[];

function KpiTable({ kpis }: { kpis: ReportKpi[] }) {
  return (
    <Table columns={KPI_COLUMNS}>
      {kpis.map((kpi) => (
        <View key={kpi.key} style={styles.tr} wrap={false}>
          <Text style={[styles.cell, styles.bold, { width: KPI_COLUMNS[0].width }]}>
            {t(kpi.label)}
          </Text>
          {kpi.value === null ? (
            <>
              <Text
                style={[
                  styles.cell,
                  styles.right,
                  styles.bold,
                  styles.muted,
                  { width: KPI_COLUMNS[1].width, fontSize: 11 },
                ]}
              >
                N/A
              </Text>
              <Text
                style={[styles.cell, styles.italic, styles.muted, { width: KPI_COLUMNS[2].width }]}
              >
                {t(kpi.unavailable ?? 'Not available for this week.')}
              </Text>
            </>
          ) : (
            <>
              <Text
                style={[
                  styles.cell,
                  styles.right,
                  styles.bold,
                  { width: KPI_COLUMNS[1].width, fontSize: 11 },
                ]}
              >
                {t(kpi.display)}
              </Text>
              <Text style={[styles.cell, styles.muted, { width: KPI_COLUMNS[2].width }]}>
                {t(
                  kpi.change ??
                    (kpi.previous === null
                      ? 'No comparison: the week before isn’t known.'
                      : `Week before: ${kpi.previousDisplay}`),
                )}
              </Text>
            </>
          )}
          <Text style={[styles.cell, styles.muted, styles.small, { width: KPI_COLUMNS[3].width }]}>
            {t(kpi.basis)}
          </Text>
        </View>
      ))}
    </Table>
  );
}

function RankingBlock({ ranking, showRole }: { ranking: ReportRanking; showRole: boolean }) {
  const columns: Column[] = showRole
    ? [
        { label: '#', width: '6%', align: 'right' },
        { label: 'Profile', width: '34%' },
        { label: 'Role', width: '16%' },
        { label: 'Follower growth', width: '16%', align: 'right' },
        { label: 'Based on', width: '28%' },
      ]
    : [
        { label: '#', width: '6%', align: 'right' },
        { label: 'Profile', width: '44%' },
        { label: 'Follower growth', width: '18%', align: 'right' },
        { label: 'Based on', width: '32%' },
      ];
  const width = (label: string) => columns.find((column) => column.label === label)!.width;
  const lead = (
    <>
      <Text style={styles.h3}>{t(ranking.platform)}</Text>
      {ranking.basis ? (
        <Text style={[styles.small, { marginBottom: 4 }]}>{t(ranking.basis)}</Text>
      ) : null}
    </>
  );
  return (
    <View style={{ marginBottom: 10 }}>
      {ranking.rows.length ? (
        <Table columns={columns} lead={lead}>
          {ranking.rows.map((row) => (
            <View
              key={`${row.accountId}-${row.rank}`}
              style={[
                styles.tr,
                showRole && row.role === 'own' ? { backgroundColor: COLORS.own } : {},
              ]}
              wrap={false}
            >
              <Text style={[styles.cell, styles.right, styles.muted, { width: width('#') }]}>
                {row.rank}
              </Text>
              <View style={[styles.cell, { width: width('Profile') }]}>
                <Text style={styles.bold}>{t(row.name)}</Text>
                {row.countryCode ? (
                  <Text style={[styles.small, styles.muted]}>{t(row.countryCode)}</Text>
                ) : null}
              </View>
              {showRole ? (
                <Text style={[styles.cell, { width: width('Role') }]}>
                  {RANKING_ROLE_LABELS[row.role]}
                </Text>
              ) : null}
              <Text
                style={[
                  styles.cell,
                  styles.right,
                  styles.bold,
                  { width: width('Follower growth') },
                ]}
              >
                {t(row.display)}
              </Text>
              <Text style={[styles.cell, styles.muted, styles.small, { width: width('Based on') }]}>
                {t(row.sample)}
              </Text>
            </View>
          ))}
        </Table>
      ) : (
        <View wrap={false}>
          {lead}
          <Text style={[styles.muted, { fontSize: 9 }]}>
            {t(`No profile on ${ranking.platform} had a comparable value this week.`)}
          </Text>
        </View>
      )}
      {ranking.notRanked.length ? (
        <View style={{ marginTop: 5 }}>
          <Text
            style={[styles.bold, styles.small]}
          >{`Not ranked (${ranking.notRanked.length})`}</Text>
          {ranking.notRanked.map((entry, index) => (
            <Text key={`${entry.name}-${index}`} style={[styles.small, { marginTop: 1.5 }]}>
              <Text style={styles.bold}>{t(entry.name)}</Text>
              <Text style={[styles.italic, styles.muted]}>: {t(entry.reason)}</Text>
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const POST_COLUMNS = [
  { label: '#', width: '6%', align: 'right' },
  { label: 'Profile', width: '34%' },
  { label: 'Platform', width: '15%' },
  { label: 'Format', width: '14%' },
  { label: 'Published', width: '15%' },
  { label: 'Engagement', width: '16%', align: 'right' },
] as const satisfies readonly Column[];

function TopContent({ posts, timeZone }: { posts: ReportPost[]; timeZone: string }) {
  const [rank, profile, platform, format, published, engagement] = POST_COLUMNS;
  return (
    <Table columns={POST_COLUMNS}>
      {posts.map((post, index) => {
        const url = safeExternalUrl(post.permalink);
        const day = formatDay(post.publishedAt, timeZone);
        return (
          <View
            key={`${post.accountId}-${post.publishedAt}-${index}`}
            style={styles.tr}
            wrap={false}
          >
            <Text style={[styles.cell, styles.right, styles.muted, { width: rank.width }]}>
              {index + 1}
            </Text>
            <View style={[styles.cell, { width: profile.width }]}>
              <Text style={styles.bold}>{t(post.profile)}</Text>
              {/* A plain address rather than a link: it still works on paper. */}
              {url ? (
                <Text style={[styles.muted, { fontSize: 7 }]}>{t(breakable(url))}</Text>
              ) : null}
            </View>
            <Text style={[styles.cell, { width: platform.width }]}>{t(post.platform)}</Text>
            <Text style={[styles.cell, { width: format.width }]}>{t(post.format)}</Text>
            <Text
              style={[
                styles.cell,
                { width: published.width },
                day ? {} : [styles.italic, styles.muted],
              ].flat()}
            >
              {day ?? 'date not known'}
            </Text>
            <Text style={[styles.cell, styles.right, styles.bold, { width: engagement.width }]}>
              {t(post.display)}
            </Text>
          </View>
        );
      })}
    </Table>
  );
}

/** A long address split over lines so it stays inside its column (it has no spaces to wrap at). */
function breakable(url: string): string {
  return url.match(/.{1,44}/g)?.join('\n') ?? url;
}

function Strategies({ strategies }: { strategies: ReportStrategy[] }) {
  return (
    <View>
      {strategies.map((strategy) => (
        <View key={strategy.id} style={styles.card} wrap={false}>
          <Text style={[styles.h4, { marginBottom: 4 }]}>{t(strategy.name)}</Text>
          {strategy.objectives.length ? (
            strategy.objectives.map((objective, index) => (
              <View
                key={`${objective.name}-${index}`}
                style={{
                  paddingVertical: 2.5,
                  borderTopWidth: index ? 0.5 : 0,
                  borderTopColor: COLORS.rule,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ flex: 1, paddingRight: 8 }}>{t(objective.name)}</Text>
                  <Text style={styles.bold}>{t(objective.display)}</Text>
                </View>
                {objective.note ? (
                  <Text style={[styles.small, styles.muted]}>{t(objective.note)}</Text>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={styles.muted}>No objectives with a KPI.</Text>
          )}
          {strategy.coverage ? (
            <Text
              style={[
                styles.small,
                styles.muted,
                {
                  marginTop: 4,
                  paddingTop: 4,
                  borderTopWidth: 0.5,
                  borderTopColor: COLORS.rule,
                },
              ]}
            >
              {t(strategy.coverage)}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function Insights({
  title,
  insights,
  empty,
}: {
  title: string;
  insights: ReportInsight[];
  empty: string;
}) {
  return (
    <View>
      <Text style={styles.h3} minPresenceAhead={40}>
        {t(title)}{' '}
        <Text style={[styles.muted, { fontFamily: 'Helvetica' }]}>({insights.length})</Text>
      </Text>
      {insights.length ? (
        insights.map((insight) => (
          <View key={insight.id} style={styles.card} wrap={false}>
            <Text style={styles.pill}>
              {t(`${SEVERITY_LABELS[insight.severity]} · ${insightKindLabel(insight.kind)}`)}
            </Text>
            <Text style={[styles.h4, { marginBottom: 2 }]}>{t(insight.title)}</Text>
            <Text>{t(insight.body)}</Text>
          </View>
        ))
      ) : (
        <Text style={[styles.muted, { fontSize: 9 }]}>{t(empty)}</Text>
      )}
    </View>
  );
}

function Actions({ actions }: { actions: ReportAction[] }) {
  return (
    <View>
      {actions.map((action, index) => (
        <View key={action.id} style={styles.card} wrap={false}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
            <Text style={[styles.h4, { flex: 1, paddingRight: 8 }]}>
              {index + 1}. {t(action.title)}
            </Text>
            <Text style={styles.pill}>{CONFIDENCE_LABELS[action.confidence]}</Text>
          </View>
          <Text>{t(action.recommendation)}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export function ReportPdfDocument({ title, madeBy, createdAt, snapshot }: ReportPdfInput) {
  const timeZone = snapshot.timeZone;
  const week = formatWeek(snapshot.week);
  const madeOn = formatDay(createdAt, timeZone) ?? 'the day it was made';
  const footerLine = `Made by Scopie on ${madeOn}; numbers frozen when the report was made.`;

  return (
    <Document
      title={t(title)}
      author="Scopie"
      subject={t(`Weekly report for ${snapshot.orgName}${week ? `, ${week}` : ''}`)}
      creator="Scopie"
      producer="Scopie"
      language="en-GB"
    >
      <Page size="A4" style={styles.page}>
        {/* On every page: what this is and, for DEMO data, that none of it is real. */}
        <View style={styles.runningHeader} fixed>
          <View style={styles.runningHeaderRow}>
            <Text>{t(`Scopie · ${snapshot.orgName}`)}</Text>
            <Text>{t(week ? `Weekly report · ${week}` : 'Weekly report')}</Text>
          </View>
          {snapshot.isDemo ? <Text style={styles.demoStrip}>{t(DEMO_PDF_LINE)}</Text> : null}
        </View>

        {/* lineHeight lives here, not on the Page: on the Page it blanks the page numbers. */}
        <View style={styles.body}>
          <View>
            <Text style={styles.title}>{t(title)}</Text>
            <Text style={styles.meta}>
              {t(`${snapshot.orgName} · ${week ? `Covers ${week}` : 'Weekly report'}`)}
            </Text>
            <Text style={styles.meta}>{t(madeBy)}</Text>
            {snapshot.isDemo ? (
              <View style={styles.demoBanner}>
                <Text style={styles.demoBannerTitle}>{t(DEMO_PDF_LINE)}</Text>
                <Text>
                  This report was made from DEMO DATA generated for testing. None of it is real.
                </Text>
              </View>
            ) : null}
          </View>

          <Section title="Summary" empty={snapshot.summary.length ? undefined : null}>
            <Bullets items={snapshot.summary} />
          </Section>

          <Section
            title="The week in numbers"
            description={`Compared with the week before (${formatWeek(snapshot.previousWeek) ?? 'previous week'}).`}
            empty={snapshot.kpis.length ? undefined : 'No numbers to report for this week.'}
          >
            <KpiTable kpis={snapshot.kpis} />
          </Section>

          <Section
            title="Markets"
            description="Your own profiles ranked by follower growth during the week, one ranking per platform."
            empty={
              snapshot.markets.length ? undefined : 'Nothing to report: no own profiles to rank.'
            }
          >
            {snapshot.markets.map((ranking) => (
              <RankingBlock key={ranking.platformKey} ranking={ranking} showRole={false} />
            ))}
          </Section>

          <Section
            title="Competitor watch"
            description="Your own profiles and competitors together, ranked by follower growth during the week."
            empty={
              snapshot.competitors.length
                ? undefined
                : 'Nothing to report: no competitors are monitored.'
            }
          >
            {snapshot.competitors.map((ranking) => (
              <RankingBlock key={ranking.platformKey} ranking={ranking} showRole />
            ))}
          </Section>

          <Section
            title="Top content"
            description="Your own posts published this week with the most engagement."
            empty={
              snapshot.topContent.length ? undefined : 'Nothing to report: no posts this week.'
            }
          >
            <TopContent posts={snapshot.topContent} timeZone={timeZone} />
          </Section>

          <Section
            title="Strategy"
            description="Where each active strategy stood at the end of the week."
            empty={
              snapshot.strategies.length ? undefined : 'Nothing to report: no active strategies.'
            }
          >
            <Strategies strategies={snapshot.strategies} />
          </Section>

          {snapshot.analysis ? (
            <Section title="Insights">
              <Insights
                title="Key insights"
                insights={snapshot.insights.key}
                empty="Nothing stood out enough to report."
              />
              <Insights
                title="Opportunities"
                insights={snapshot.insights.opportunities}
                empty="No opportunities found this week."
              />
              <Insights
                title="Risks"
                insights={snapshot.insights.risks}
                empty="No risks found this week."
              />
              <Text style={styles.h3} minPresenceAhead={40}>
                Recommended actions{' '}
                <Text style={[styles.muted, { fontFamily: 'Helvetica' }]}>
                  ({snapshot.actions.length})
                </Text>
              </Text>
              {snapshot.actions.length ? (
                <Actions actions={snapshot.actions} />
              ) : (
                <Text style={[styles.muted, { fontSize: 9 }]}>
                  No recommended actions in this analysis.
                </Text>
              )}
            </Section>
          ) : null}

          <Section title="Who wrote it">
            <Text style={styles.muted}>
              {t(
                `${reportWriterSentences(snapshot.analysis, timeZone).join(' ')} Every number was computed by Scopie and frozen when the report was made. Findings show what the numbers have in common, not what caused them.`,
              )}
            </Text>
          </Section>

          <Section
            title="What this report couldn’t include"
            empty={snapshot.notes.length ? undefined : null}
          >
            <Bullets items={snapshot.notes} muted />
          </Section>

          <Text style={[styles.small, styles.muted, { marginTop: 14 }]}>
            {t(`Dates and times in ${timeZone}.`)}
          </Text>
        </View>

        <View style={styles.footerRule} fixed />
        <Text style={styles.footer} fixed>
          {t(snapshot.isDemo ? `${footerLine} ${DEMO_PDF_LINE}.` : footerLine)}
        </Text>
        <Text
          style={styles.pageNumber}
          fixed
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </Page>
    </Document>
  );
}

/** The report as PDF bytes. */
export async function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
  return renderToBuffer(<ReportPdfDocument {...input} />);
}
