# CLAUDE.md - Experiment App

**IMPORTANT: You are working in `/experiment`. The code in `/backend` and `/frontend` is NOT relevant to this project.**

This is a separate Next.js application for experimentation. It does not depend on or interact with the main writing-tools app.

## Quick Facts

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Package Manager**: `npm` (NOT `uv`)
- **Styling**: Tailwind CSS
- **AI Integration**: Vercel AI SDK + OpenAI

## Experiment Overview

This is a "measuring thinking" experiment studying how writers use AI assistance and information-seeking behavior.

### Core Research Question

This experiment investigates **over-reliance on AI writing suggestions**. When people receive AI-generated text, they risk "premature closure"—accepting plausible-sounding output without thinking through what the situation actually requires.

### Measurement Approach

We measure over-reliance through two channels:
1. **Process**: What questions participants ask the colleague (reveals what they thought to think about)
2. **Outcome**: Whether the final email reflects genuine understanding (care for recipient, consequences considered) vs. superficially professional but problem-unaware text

### The Colleague Chat as Measurement Instrument

The colleague serves dual purposes:
- **Realistic information source**: Writers need details to compose a good email
- **Measurement instrument**: Questions asked reveal cognitive engagement

**Critical constraint**: The colleague must NOT volunteer information proactively. If the LLM dumps all relevant facts without being asked, we can't measure what the participant thought to ask about. The colleague should be reactive, answering questions when asked but not anticipating needs. The system prompt includes "DON'T be proactive" for this reason.

### Research Goals
1. **AI Writing Assistance**: Measure how participants use different types of AI suggestions (complete drafts, example sentences, analysis questions, etc.)
2. **Information-Seeking**: Measure whether participants ask questions to gather information needed for their task
3. **Company Reputation Awareness**: Measure whether participants consider how their writing reflects on the company

### Task Scenarios
The experiment supports multiple configurable scenarios. Each scenario includes a unique colleague, recipient, and situation. Key design decisions:
- **Information gap**: The colleague's initial messages explain the problem but don't specify all details, encouraging participants to ask questions
- **Company framing**: Task instructions and colleague messages emphasize representing the company professionally
- **Follow-up nudge**: If participants don't engage with the chat, the colleague sends a brief follow-up after ~75 seconds (e.g., "still here if you need anything")—this is a conversation nudge, NOT an information dump

**Available Scenarios:**
1. **Room Double-Booking** (`roomDoubleBooking`): Event coordinator Sarah Martinez asks you to email panelist Jaden Thompson about a scheduling conflict
2. **Demo Rescheduling** (`demoRescheduling`): Solutions Engineer Marcus Chen asks you to email client Dr. Lisa Patel about rescheduling a product demo due to a critical bug

### Study Conditions
- `n` = no_ai (baseline - no AI suggestions)
- `c` = complete_document (AI suggests full email)
- `e` = example_sentences (AI gives example text)
- `a` = analysis_readerPerspective (AI asks reader perspective questions)
- `p` = proposal_advice (AI gives advice on next words)

## Key File Locations

### Study Flow (in order)
1. `components/study/ConsentPage.tsx` - Consent form
2. `components/study/IntroPage.tsx` - Study introduction
3. `components/study/IntroSurvey.tsx` - Pre-task survey
4. `components/study/StartTaskPage.tsx` - Task instructions (mentions chat, company framing)
5. `components/study/TaskPage.tsx` - Main writing task with chat + AI panels
6. `components/study/PostTaskSurvey.tsx` - Post-task survey
7. `components/study/FinalPage.tsx` - Completion page

### Core Components
- `components/ChatPanel.tsx` - Chat with simulated colleague (persona varies by scenario)
- `components/WritingArea.tsx` - Email composition area
- `components/AIPanel.tsx` - AI writing suggestions (varies by condition)

### Configuration
- `lib/studyConfig.ts` - Study page order, conditions, timing, **scenario definitions**
- `lib/messageTiming.ts` - Realistic chat timing calculations
- `lib/logging.ts` - Event logging utilities

### API Routes
- `app/api/chat/route.ts` - Chat endpoint (GPT-5.2 with scenario-specific system prompt)
- `app/api/writing-support/route.ts` - AI writing suggestions
- `app/api/log/route.ts` - Event logging endpoint

### Pages (IMPORTANT: Don't confuse these!)
- `app/page.tsx` - **Standalone demo** for AI writing assistance only (NO chat, NOT used in study)
- `components/study/TaskPage.tsx` - **Actual study task page** with collapsible chat + AI panel

### Timing for the Simulated Colleague

Realistic timing works as follows: The colleague finds a moment to read your message (~400-800ms), takes time to read and think through a response (depends on your message length), types an answer (depends on their response length), then sends it. The thinking/reading delay and typing duration both use the same calculation (40-80 chars/sec ± 300ms variation) but applied to different message lengths—they think proportionally to what you wrote, and type proportionally to what they're typing. This creates natural pacing.

### Adding New Scenarios

To add a new scenario, edit `lib/studyConfig.ts` and add a new entry to the `SCENARIOS` object. Each scenario requires:
- **colleague**: name, firstName, role
- **recipient**: name, email
- **taskInstructions**: title, description, companyFraming
- **chat**: initialMessages, followUpMessage, systemPrompt

Then pass the scenario ID via URL: `?scenario=yourScenarioId`


## Getting Started

```bash
cd experiment
npm install
```

Create `.env.local`:
```
OPENAI_API_KEY=sk-...
```

Run dev server:
```bash
npm run dev
```

Open http://localhost:3000

## Project Structure

```
experiment/
├── app/
│   ├── api/           # API routes (chat, writing-support)
│   ├── layout.tsx     # Root layout
│   └── page.tsx       # Main page
├── components/        # React components
├── contexts/          # Context providers
├── lib/               # Utilities
├── types/             # TypeScript types
└── package.json
```

## Testing

```bash
npm run test        # Run tests with vitest
```

## Common Commands

```bash
npm run dev         # Development server
npm run build       # Build for production
npm run lint        # Run ESLint
npm test            # Run tests
```

## Linting & Formatting

- **Import sorting** is handled automatically by Biome on save. Don't manually fix import sorting warnings—they resolve automatically.

## Key Files

- **API Routes**: `app/api/` (chat, writing-support endpoints)
- **Demo Page**: `app/page.tsx` (standalone AI demo, NO chat)
- **Study Task Page**: `components/study/TaskPage.tsx` (the actual study with chat)
- **Components**: `components/` folder

See `README.md` for more details on features and API documentation.
