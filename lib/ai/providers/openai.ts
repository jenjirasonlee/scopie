import 'server-only';
import type { ChatMessage, ChatRequest, ChatStep, LlmProvider, StructuredRequest } from './types';

// OpenAI chat completions: strict JSON schema output, and tool calling for the chat. The key
// stays on the server: it is read from the environment by the caller, sent only in the
// Authorization header, and never logged, stored or returned in an error.

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 60_000;

type CompletionBody = {
  error?: { message?: string };
  choices?: {
    message?: {
      content?: string | null;
      refusal?: string | null;
      tool_calls?: {
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

async function complete(
  apiKey: string,
  fetchImpl: typeof fetch,
  payload: Record<string, unknown>,
): Promise<CompletionBody> {
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as CompletionBody | null;
  if (!response.ok) {
    const message = body?.error?.message?.slice(0, 300) ?? 'no details';
    throw new Error(`OpenAI returned ${response.status}: ${message}`);
  }
  return body ?? {};
}

const usageOf = (body: CompletionBody) => ({
  inputTokens: body.usage?.prompt_tokens ?? null,
  outputTokens: body.usage?.completion_tokens ?? null,
});

function toOpenAiMessage(message: ChatMessage) {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: message.content };
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
  }
}

export function openAiProvider(apiKey: string, fetchImpl: typeof fetch = fetch): LlmProvider {
  return {
    id: 'openai',
    async generateStructured(request: StructuredRequest) {
      const body = await complete(apiKey, fetchImpl, {
        model: request.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: request.schemaName, schema: request.schema, strict: true },
        },
      });
      const choice = body.choices?.[0]?.message;
      if (choice?.refusal) throw new Error('The model declined to answer.');
      if (!choice?.content) throw new Error('The model returned no content.');
      let output: unknown;
      try {
        output = JSON.parse(choice.content);
      } catch {
        throw new Error('The model returned something that is not JSON.');
      }
      return { output, usage: usageOf(body) };
    },

    async chatWithTools(request: ChatRequest): Promise<ChatStep> {
      const body = await complete(apiKey, fetchImpl, {
        model: request.model,
        messages: [
          { role: 'system', content: request.system },
          ...request.messages.map(toOpenAiMessage),
        ],
        tools: request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: request.toolChoice,
        parallel_tool_calls: true,
      });
      const choice = body.choices?.[0]?.message;
      if (choice?.refusal) throw new Error('The model declined to answer.');
      const calls = (choice?.tool_calls ?? []).flatMap((call) =>
        call.type === 'function' && call.id && call.function?.name
          ? [{ id: call.id, name: call.function.name, arguments: call.function.arguments ?? '{}' }]
          : [],
      );
      if (calls.length) return { type: 'tool_calls', calls, usage: usageOf(body) };
      if (!choice?.content) throw new Error('The model returned no content.');
      return { type: 'answer', text: choice.content, usage: usageOf(body) };
    },
  };
}
