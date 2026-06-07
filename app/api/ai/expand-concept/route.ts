import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateText } from "@/lib/openai";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { title } = await request.json();
  if (!title) return Response.json({ error: "Title required" }, { status: 400 });

  const prompt = `Act as a world-class professor of Mathematics, Artificial Intelligence, and Machine Learning. Generate comprehensive, profoundly clear, and strictly accurate study notes for the following topic.

**Topic:** ${title}

**Goal:** A complete mastery guide. A student reading these notes should go from zero understanding to grasping both the intuitive ideas and the rigorous mathematical foundations — able to explain, implement, and debug the topic afterward. Prioritize depth and accuracy over brevity. Never skip steps in mathematical logic; spell out every transition.

---

## OUTPUT STRUCTURE (include every section; if one genuinely doesn't apply, say why in one line and give the closest equivalent):

### 1. 🏷️ Classification & Prerequisites
- **Type:** What kind of concept is this? (e.g., optimization algorithm / neural architecture / theorem / regularization technique / loss function / evaluation metric / probabilistic model, etc.)
- **Prerequisites:** 3–5 specific concepts the reader must already know (e.g., "chain rule of calculus" — not just "math").
- **Difficulty:** [Beginner / Intermediate / Advanced]

### 2. 🎯 Intuition & The "Why"
- Explain it as if to a complete beginner, jargon-free.
- Answer explicitly: *What problem does this solve? Why was it invented? What did people do before it?*

### 3. 🌍 Real-World Analogy
- ONE precise analogy that mirrors the **mechanism**, not just the outcome.
- Explicitly map each part of the analogy to its technical counterpart (e.g., "the slope of the hill → the gradient; the size of each step → the learning rate").

### 4. 📚 Core Concepts & Vocabulary
- Define every essential term. **Bold** each key term on first use; use bullet points.

### 5. 🧮 Mathematical Foundations (Rigorous)
- State the core formulas, theorems, or objective functions using LaTeX ($$ ... $$ for display, $ ... $ inline).
- **Crucial:** Define *every single variable and symbol* in a table — | Symbol | Meaning | Typical range/shape |.
- Explain the intuition behind each term: *why is it built this way?*
- Derive or motivate the key equation in a few lines where it aids understanding.

### 6. ⚙️ Algorithmic Flow / Proof Logic
- **If an algorithm:** numbered sequence from initialization to convergence; state what happens and *why* at each step.
- **If a theorem:** break down the core proof logic or the steps of its application.

### 7. 🔢 Worked Example (Concrete Numbers)
- Walk through a full numerical example start to finish using small *actual* values — not just variable names.
- Show the intermediate math at every step so the input→output transformation is fully visible.

### 8. 💻 Code Implementation (if applicable to AI/ML)
- **Part A — From Scratch (NumPy, ~15–20 lines):** core logic only, heavily commented.
- **Part B — Library Usage (PyTorch / Scikit-Learn / HuggingFace, ~5–10 lines):** the standard call, with the most important hyperparameters annotated inline.

### 9. 📐 Variants & Evolution
- 3–5 important variants, improvements, or sibling methods.
- For each: one line on *how it differs* and *when to prefer it*.
- Add a comparison table if there are ≥3 (columns: Name | Key Difference | Best Used When).

### 10. ✅ When to Use / ❌ When Not to Use
- 3–4 concrete scenarios where this is the right tool (specify task type, data regime, constraints).
- 3–4 scenarios where you should use something else — and name the alternative.

### 11. ⚡ Complexity & Scalability
- Time complexity (training vs. inference separately).
- Space complexity.
- Scaling behavior across dataset size N, feature dimensionality D, and model/parameter count; note bottlenecks.

### 12. ⚠️ Common Pitfalls & Edge Cases
- 4–6 mistakes students actually make.
- When/why the concept fails or breaks down (e.g., "assumption of linearity violated", "vanishing gradients").

### 13. 🔗 Connections to the Broader Landscape
- **Builds on:** 2–3 foundations this depends on.
- **Leads to:** 2–3 downstream concepts this enables.
- **Often confused with:** 1–2 similar-but-distinct concepts — state the exact distinction in one sentence each.

### 14. 📝 Summary & Cheat Sheet
- A 3–4 sentence TL;DR.
- A quick-reference table of pros/cons, complexities, and key properties.
- Close with exactly one sentence: *"The single most important thing to remember about ${title} is: ___."*

---

## TONE & FORMATTING:
- Exceptionally clear and structured. Use the emoji headings exactly as shown, plus \`###\` subheadings, horizontal rules, and tables for scannability.
- **Bold** key terms; \`inline code\` for variables, functions, parameters.
- LaTeX for all math. Tables for any comparison of ≥3 items.
- Spell out every mathematical transition — do not skip logical steps.`;

  const { data, error } = await generateText(
    "You are an expert computer science and AI educator.",
    prompt,
    1000
  );

  if (error || !data) {
    return Response.json({ error: "Failed to generate notes" }, { status: 500 });
  }

  return Response.json({ notes: data });
}
