// A model provider behind one small interface (AI_ARCHITECTURE.md §2), so the analysis can
// run against OpenAI, a self-hosted model later, or a fake in tests.

export type ProviderUsage = { inputTokens: number | null; outputTokens: number | null };

export type StructuredRequest = {
  model: string;
  system: string;
  user: string;
  /** A JSON Schema the output must follow (strict: every property required, no extras). */
  schemaName: string;
  schema: Record<string, unknown>;
};

export interface LlmProvider {
  id: string;
  /** Returns the parsed JSON output. The caller validates it; nothing here is trusted. */
  generateStructured(
    request: StructuredRequest,
  ): Promise<{ output: unknown; usage: ProviderUsage }>;
}
