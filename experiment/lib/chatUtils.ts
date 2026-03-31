/**
 * Utility function to parse JSON array responses from the assistant.
 * Shared between ChatPanel (for display) and AIPanel (for conversation history formatting).
 */
export function parseMessageContent(content: string): string[] {
  try {
    // Remove markdown code blocks if present
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [content];
  } catch {
    return [content];
  }
}
