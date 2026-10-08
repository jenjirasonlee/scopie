import type { LlmProvider, StructuredRequest } from './types';

/** A provider that answers from a function, for tests. Records every request it gets. */
export function fakeProvider(answer: (request: StructuredRequest) => unknown): LlmProvider & {
  requests: StructuredRequest[];
} {
  const requests: StructuredRequest[] = [];
  return {
    id: 'fake',
    requests,
    async generateStructured(request) {
      requests.push(request);
      return { output: answer(request), usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
}
