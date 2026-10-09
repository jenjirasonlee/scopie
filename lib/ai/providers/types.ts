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

/** A tool the model may call, described with a JSON Schema for its arguments. */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  /** The arguments as the model wrote them (JSON text). Never trusted: tools parse them. */
  arguments: string;
};

/** One message of a tool-calling conversation. */
export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export type ChatRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  /** 'none' forces a written answer (used on the last round). */
  toolChoice: 'auto' | 'none';
};

/** One model step: either tool calls to run, or the written answer. */
export type ChatStep =
  | { type: 'tool_calls'; calls: ToolCall[]; usage: ProviderUsage }
  | { type: 'answer'; text: string; usage: ProviderUsage };

export interface LlmProvider {
  id: string;
  /** Returns the parsed JSON output. The caller validates it; nothing here is trusted. */
  generateStructured(
    request: StructuredRequest,
  ): Promise<{ output: unknown; usage: ProviderUsage }>;
  /** One step of a tool-calling chat. The caller runs the tools and loops. */
  chatWithTools(request: ChatRequest): Promise<ChatStep>;
}
