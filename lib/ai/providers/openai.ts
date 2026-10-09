import 'server-only';
import type { LlmProvider, StructuredRequest } from './types';

// OpenAI chat completions with a strict JSON schema. The key stays on the server: it is read
// from the environment by the caller, sent only in the Authorization header, and never
// logged, stored or returned in an error.

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 60_000;

export function openAiProvider(apiKey: string, fetchImpl: typeof fetch = fetch): LlmProvider {
  return {
    id: 'openai',
    async generateStructured(request: StructuredRequest) {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: request.schemaName, schema: request.schema, strict: true },
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
        choices?: { message?: { content?: string | null; refusal?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      } | null;
      if (!response.ok) {
        const message = body?.error?.message?.slice(0, 300) ?? 'no details';
        throw new Error(`OpenAI returned ${response.status}: ${message}`);
      }
      const choice = body?.choices?.[0]?.message;
      if (choice?.refusal) throw new Error('The model declined to answer.');
      if (!choice?.content) throw new Error('The model returned no content.');
      let output: unknown;
      try {
        output = JSON.parse(choice.content);
      } catch {
        throw new Error('The model returned something that is not JSON.');
      }
      return {
        output,
        usage: {
          inputTokens: body?.usage?.prompt_tokens ?? null,
          outputTokens: body?.usage?.completion_tokens ?? null,
        },
      };
    },
  };
}
