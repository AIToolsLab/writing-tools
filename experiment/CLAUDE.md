# CLAUDE.md - Experiment App

**IMPORTANT: You are working in `/experiment`. The code in `/backend` and `/frontend` is NOT relevant to this project.**

This is a separate Next.js application for experimentation. It does not depend on or interact with the main writing-tools app.

## Quick Facts

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Package Manager**: `npm` (NOT `uv`)
- **Styling**: Tailwind CSS
- **AI Integration**: Vercel AI SDK + OpenAI

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

## Key Files

- **API Routes**: `app/api/` (chat, writing-support endpoints)
- **Main App**: `app/page.tsx`
- **Components**: `components/` folder

See `README.md` for more details on features and API documentation.
