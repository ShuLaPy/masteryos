import { openai, type OpenAIMessage } from "./openai";

type Task = "card_generation" | "problem_selection" | "coaching_synthesis";

const MODEL_MAP: Record<Task, string> = {
  card_generation: "gpt-5.4-mini",
  problem_selection: "gpt-5.4",
  coaching_synthesis: "gpt-5.4",
};

export async function complete({
  task,
  messages,
  systemPrompt,
}: {
  task: Task;
  messages: OpenAIMessage[];
  systemPrompt: string;
}): Promise<{ data: { content: string } | null; error: string | null }> {
  try {
    const response = await openai.chat.completions.create({
      model: MODEL_MAP[task],
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    });
    const content = response.choices[0]?.message?.content ?? "";
    return { data: { content }, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { data: null, error: message };
  }
}
