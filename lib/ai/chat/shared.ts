// Scopie AI chat: shapes and labels shared by the server and the chat page. Safe in the
// browser (no server imports).

/** One tool call behind an answer, as shown in the "Data used" panel. */
export type DataUsedTool = {
  /** Tool name, e.g. "get_overview". */
  tool: string;
  /** What it read, in plain words: "Overview of your profiles". */
  label: string;
  /** "10 Sep – 9 Oct", or null when the tool isn't about a period. */
  period: string | null;
  /** Profiles the result rests on, or null when it doesn't read profiles. */
  profiles: number | null;
};

/** The "Data used" panel of one answer (stored with the message). */
export type DataUsed = {
  tools: DataUsedTool[];
  /** "DEMO" or "PUBLIC": the data source every number was read from. */
  source: string;
  writer: 'rules' | 'model';
  model: string | null;
  /** Why Scopie's rules wrote an answer the model was asked for, when that happened. */
  note: string | null;
};

export type ChatMessageView = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  dataUsed: DataUsed | null;
};

export const READY_QUESTIONS = [
  { id: 'followers', label: 'How did our followers change this month?' },
  { id: 'competitors', label: 'Which competitors grew fastest?' },
  { id: 'top_posts', label: 'What were our top posts this month?' },
  { id: 'recommendations', label: 'What does the analysis recommend?' },
  { id: 'strategy', label: 'How is our strategy doing?' },
] as const;

export type ReadyQuestionId = (typeof READY_QUESTIONS)[number]['id'];

export function isReadyQuestionId(value: unknown): value is ReadyQuestionId {
  return READY_QUESTIONS.some((q) => q.id === value);
}

export const NO_DATA_ANSWER = 'Scopie doesn’t have data to answer that.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** A stored "Data used" panel (jsonb), or null when it can't be read. */
export function readDataUsed(value: unknown): DataUsed | null {
  if (!isRecord(value) || !Array.isArray(value.tools)) return null;
  const writer = value.writer === 'model' ? 'model' : value.writer === 'rules' ? 'rules' : null;
  if (!writer) return null;
  return {
    tools: value.tools.filter(isRecord).flatMap((tool) => {
      const name = str(tool.tool);
      const label = str(tool.label);
      if (!name || !label) return [];
      return [
        {
          tool: name,
          label,
          period: str(tool.period),
          profiles: typeof tool.profiles === 'number' ? tool.profiles : null,
        },
      ];
    }),
    source: str(value.source) ?? 'unknown',
    writer,
    model: writer === 'model' ? str(value.model) : null,
    note: str(value.note),
  };
}

/** One line on who wrote an answer, for the "Data used" panel. */
export function answerWriterLabel(used: Pick<DataUsed, 'writer' | 'model'>): string {
  return used.writer === 'model'
    ? `The AI model ${used.model ?? '(name not recorded)'}, from the tool results above. Scopie checked every number it used.`
    : 'Scopie’s own rules, from the tool results above. No AI model wrote this answer.';
}

/**
 * Splits an answer into paragraphs and list items ("- " lines) and finds web links in it, so
 * the page can render it without HTML. Only https links are made clickable.
 */
export type AnswerPart = { kind: 'text'; text: string } | { kind: 'link'; href: string };
export type AnswerBlock = { kind: 'paragraph' | 'item'; parts: AnswerPart[] };

const LINK = /https:\/\/[^\s<>"')]+/g;

function splitLinks(line: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of line.matchAll(LINK)) {
    if (match.index > last) parts.push({ kind: 'text', text: line.slice(last, match.index) });
    parts.push({ kind: 'link', href: match[0] });
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push({ kind: 'text', text: line.slice(last) });
  return parts;
}

export function answerBlocks(text: string): AnswerBlock[] {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .map((line) => {
      const item = /^\s*[-•*]\s+/.exec(line);
      return item
        ? { kind: 'item' as const, parts: splitLinks(line.slice(item[0].length)) }
        : { kind: 'paragraph' as const, parts: splitLinks(line.trim()) };
    });
}
