/** Resolve an OpenAI-compatible chat completions endpoint. */
export function resolveChatCompletionsUrl(
  explicitUrl: string | undefined,
  baseUrl: string | undefined,
  defaultBaseUrl: string,
): string {
  const selected = String(explicitUrl || baseUrl || defaultBaseUrl).trim().replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(selected) ? selected : `${selected}/chat/completions`;
}
