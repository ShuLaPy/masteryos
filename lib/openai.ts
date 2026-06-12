import OpenAI from "openai";

// Singleton client — server-side only
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export { openai };

export type OpenAIMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

/**
 * Simple text generation
 */
export async function generateText(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 1024,
  model = "gpt-4o-mini"
): Promise<{ data: string | null; error: string | null }> {
  try {
    const response = await openai.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });
    const text = response.choices[0]?.message?.content || null;
    return { data: text, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { data: null, error: message };
  }
}

/**
 * JSON generation with automatic parsing
 */
export async function generateJSON<T>(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2048,
  model = "gpt-4o-mini"
): Promise<{ data: T | null; error: string | null }> {
  const fullSystem = `${systemPrompt}\n\nIMPORTANT: Respond with ONLY valid JSON, no markdown, no explanation, no code blocks.`;
  try {
    const response = await openai.chat.completions.create({
      model,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: fullSystem },
        { role: "user", content: userMessage },
      ],
    });
    const text = response.choices[0]?.message?.content || "";
    const parsed = JSON.parse(text) as T;
    return { data: parsed, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { data: null, error: message };
  }
}

/**
 * Streaming text for chat interfaces
 */
export async function* streamText(
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
  maxTokens = 1024,
  model = "gpt-4o-mini"
): AsyncGenerator<string> {
  const stream = await openai.chat.completions.create({
    model,
    max_tokens: maxTokens,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) {
      yield content;
    }
  }
}

/**
 * Generate embedding vector for text using text-embedding-3-small (1536 dims)
 */
export async function generateEmbedding(
  text: string
): Promise<{ data: number[] | null; error: string | null }> {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000), // Cap input length
    });
    const embedding = response.data[0]?.embedding ?? null;
    return { data: embedding, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { data: null, error: message };
  }
}
