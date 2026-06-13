<div align="center">
  <img src="https://via.placeholder.com/150" alt="MasteryOS Logo" width="120" />
  
  # 🧠 MasteryOS
  **An AI-Powered Learning Operating System for DSA + AI/ML Mastery.**

  [![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
  [![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
  [![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20Auth%20%2B%20pgvector-3ECF8E?logo=supabase)](https://supabase.com/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript)](https://www.typescriptlang.org/)
  [![OpenAI](https://img.shields.io/badge/AI-OpenAI-412991.svg)](https://openai.com/)
  
  [Report Bug](https://github.com/ShuLaPy/masteryos/issues) · [Request Feature](https://github.com/ShuLaPy/masteryos/issues)
</div>

<hr>

> **Not another flashcard app. Not another LeetCode grind tracker.** MasteryOS is a full-stack study companion that knows *what* you're learning, *when* you need it, and *why* it matters. 

## 🤔 Why I Built This

Traditional studying is structurally broken, and most learning tools solve **one** problem in isolation:

- 📇 **Flashcard apps** optimize memory, but don't know your lecture schedule, your prerequisite graph, or if you can actually *apply* a concept.
- 💻 **DSA trackers** log problems, but don't connect your pattern weakness to your overall study capacity.
- 🤖 **AI tutors** chat well, but have no memory model, no spaced repetition, and no idea what you forgot yesterday.

**MasteryOS was born from a real constraint:** Navigating a demanding university AI/ML curriculum while simultaneously prepping for DSA interviews, with limited daily study time. MasteryOS bridges the gap between structured curriculums and self-directed spaced repetition using our proprietary **Bridge & Runway Engine** and **Concept Graphs**.

---

## ✨ Core Engines

MasteryOS is a single Next.js application backed by Supabase. It unifies two parallel mastery tracks under one brain:

| Track | What it optimizes | Core engine |
|-------|-------------------|-------------|
| 🎓 **AIML Track** | Concept retention, prerequisite readiness, lecture alignment | FSRS + Concept Graph + Bridge & Runway |
| 💻 **DSA Track** | Pattern recognition, problem-solving fluency, interview readiness | Glicko-2 + FSRS recognition cards + Curated Bank |
| 🤖 **AI Mentor** | Daily guidance, synthesis, coaching | GPT-5.4 (Server-side) |

---

## 🚀 Key Features

### 🌉 Bridge & Runway Scheduling
Our defining intelligence layer. MasteryOS dynamically partitions your daily study plan into optimized zones, so you never walk into a lecture unprepared:
- 🛫 **Prerequisite Runway:** Preparing for a lecture tomorrow? MasteryOS calculates the required prerequisite concepts via the Knowledge Graph and prioritizes surfacing *those* cards today.
- ⚡ **Immediate Recall:** Locks in newly extracted concepts from today's lecture on the forgetting curve.
- 📚 **General SRS:** Standard retention reviews powered by the cutting-edge **FSRS** (Free Spaced Repetition Scheduler) algorithm.

### 🧠 AI Concept Vault & Extraction
- **Automated Ingestion:** Paste your rough lecture notes, and our AI extracts concepts, generates SRS cards, and automatically links them to your existing prerequisite graph.
- **Semantic Deduplication:** Built on `pgvector` embeddings to prevent duplicate concepts (cosine similarity > 0.85).
- **Cold-Start Remediation:** If a prerequisite is entirely unstudied 7 days before a lecture, the AI generates a primer and seed cards to get you up to speed.

### 💻 DSA Pattern Mastery
Where definition flashcards fail, MasteryOS trains **recognition** and **execution**.
- **25 Canonical Patterns:** Track mastery across core algorithms.
- **Glicko-2 Skill Rating:** Just like chess, your pattern mastery is rated dynamically. MasteryOS detects over-indexing (grinding one pattern while others decay).
- **ZPD Problem Selection:** (Zone of Proximal Development). The AI curates problems from a 300-problem bank that perfectly match your current skill rating to maximize flow state.

### 🧪 Feynman 2.0 & AI Interviews
- **Teach to Master:** Pick a weak concept and explain it to the AI, which plays the role of a confused student in a Socratic dialogue.
- **Weekly Mock Interviews:** A structured, once-a-week oral examination of your AI/ML knowledge, complete with shadow-grading that feeds back into your overall mastery score.

---

## 📸 Interface

| Dashboard & Daily Plan | Concept Graph Visualization |
| :---: | :---: |
| <img src="https://via.placeholder.com/600x400?text=Mentor+Home" alt="Dashboard" /> | <img src="https://via.placeholder.com/600x400?text=Knowledge+Graph" alt="Concept Graph" /> |

| DSA Workspace & Tracking | Daily Review |
| :---: | :---: |
| <img src="https://via.placeholder.com/600x400?text=DSA+Track" alt="DSA Workspace" /> | <img src="https://via.placeholder.com/600x400?text=Spaced+Repetition" alt="AI Ingestion" /> |

---

## 🏗️ Architecture & Tech Stack

- **Framework:** Next.js 16 (App Router, Server Components)
- **Database & Auth:** Supabase (PostgreSQL, Row Level Security, Edge Functions)
- **AI & Search:** OpenAI `gpt-5.4` + `text-embedding-3-small` via `pgvector` HNSW index
- **Algorithms:** `ts-fsrs` (Memory), Custom Glicko-2 (Skill), Custom Planning Engine
- **Styling:** Tailwind CSS v4, Shadcn/UI, Framer Motion
- **Data Viz:** Recharts + D3.js

---

## 🧮 Under the Hood (The Math)

MasteryOS is highly opinionated about *how* learning is scheduled:

| System | Formula Intuition |
|--------|-------------------|
| **FSRS Retrievability** | `R = e^(-t/S)` — Memory decay drives urgency. |
| **Bridge Priority** | High urgency × high relevance = study this prerequisite *now*. <br/> `Priority = (1 - R) × (0.15 + 0.85 · Relevance)` |
| **Glicko-2 Weakness** | `max(masteryGap, 0.6·staleness)` — Surfaces weak or rusty patterns. |
| **ZPD Fit** | Selects problems where expected success ≈ 65% to maximize the learning rate. |

---

## 🛠️ Getting Started

### 1. Clone & Install
```bash
git clone [https://github.com/ShuLaPy/masteryos.git](https://github.com/ShuLaPy/masteryos.git)
cd masteryos
npm install

```

### 2. Environment Variables

Create a `.env.local` file in the root directory:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
SUPABASE_SECRET_KEY=your_secret_key
OPENAI_API_KEY=your_openai_api_key

```

### 3. Database Setup & Seeding

Link your Supabase project and push the schema migrations:

```bash
# Start local Supabase (if using Supabase CLI)
npx supabase start
npx supabase db push

# Seed the curated DSA problem bank
npm run seed:problems

# Enrich problem bank with concepts
npm run enrich:problems

# Backfill Glicko-2 ratings from existing attempts
npm run backfill:elo

```

### 4. Run the App

```bash
npm run dev

```

Open [http://localhost:3000](http://localhost:3000) and start building your knowledge vault.

---

## 🤝 Contributing

MasteryOS is open source — we welcome contributions from developers, designers, and educators!

1. **Fork** the project
2. **Create** your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. **Commit** your Changes (`git commit -m 'Add some AmazingFeature'`)
4. **Push** to the Branch (`git push origin feature/AmazingFeature`)
5. **Open** a Pull Request

---

## 🙏 Acknowledgments

* **[FSRS](https://github.com/open-spaced-repetition/fsrs4anki)** — Modern spaced repetition algorithm.
* **[Glicko-2](http://www.glicko.net/glicko/glicko2.pdf)** — Skill rating with built-in uncertainty/decay.
* **[AlgoMaster-300](https://github.com/yangshun/tech-interview-handbook)** — Curated problem list structure.

---