import type { ChatRequest, ChatStep, LlmProvider, StructuredRequest } from './types';

const USAGE = { inputTokens: 100, outputTokens: 50 };

/**
 * A provider that answers from functions, for tests. Records every request it gets.
 * `chat` gets the request and the number of the step (0 first) and returns tool calls or an
 * answer; without it, chat steps fail.
 */
export function fakeProvider(
  answer: (request: StructuredRequest) => unknown,
  chat?: (
    request: ChatRequest,
    step: number,
  ) =>
    | { type: 'tool_calls'; calls: { id: string; name: string; arguments: string }[] }
    | { type: 'answer'; text: string },
): LlmProvider & {
  requests: StructuredRequest[];
  chatRequests: ChatRequest[];
} {
  const requests: StructuredRequest[] = [];
  const chatRequests: ChatRequest[] = [];
  return {
    id: 'fake',
    requests,
    chatRequests,
    async generateStructured(request) {
      requests.push(request);
      return { output: answer(request), usage: USAGE };
    },
    async chatWithTools(request): Promise<ChatStep> {
      // Keep a copy: the caller adds to the same message list afterwards.
      chatRequests.push({ ...request, messages: [...request.messages] });
      if (!chat) throw new Error('The fake provider has no chat answers.');
      return { ...chat(request, chatRequests.length - 1), usage: USAGE };
    },
  };
}
