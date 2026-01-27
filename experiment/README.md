# Controlled Open-Ended Writing Task

A Next.js application that simulates a communicative writing task with AI-powered chat support.

## Features

- **Email Writing Interface**: Compose emails with a realistic email editor
- **AI Chat Assistant**: Chat with an AI-powered colleague who provides context for your writing task
- **Writing Support API**: AI writing assistance of various kinds
- **Streaming Responses**: Real-time streaming chat responses using Vercel AI SDK
- **Configurable Scenarios**: Multiple writing scenarios (room double-booking, demo rescheduling, etc.)

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **AI Integration**: Vercel AI SDK with OpenAI

## Getting Started

### Prerequisites

- Node.js 18+ installed
- OpenAI API key

### Installation

1. Navigate to the project directory:

```bash
cd experiment
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env.local` file and add your OpenAI API key:

```bash
cp .env.example .env.local
```

Then edit `.env.local` and add your API key:

```
OPENAI_API_KEY=sk-...
```

4. Run the development server:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

```
writing-task-app/
├── app/
│   ├── api/
│   │   ├── chat/route.ts           # Streaming chat endpoint
│   │   └── writing-support/route.ts # AI writing assistance endpoint
│   ├── globals.css                  # Global styles with animations
│   ├── layout.tsx                   # Root layout
│   └── page.tsx                     # Main application page
├── components/
│   ├── AIPanel.tsx                  # AI writing assistant placeholder
│   ├── ChatPanel.tsx                # Chat interface component
│   └── WritingArea.tsx              # Email editor component
└── types/
    └── index.ts                     # TypeScript type definitions
```

## API Routes

### POST /api/chat

Streaming chat endpoint that simulates a conversation with an AI colleague. The colleague's persona and context vary by scenario.

**Request:**
```json
{
  "messages": [
    { "role": "user", "content": "What room is available?" }
  ],
  "scenario": "roomDoubleBooking"
}
```

**Response:** Server-Sent Events stream with AI responses

### POST /api/writing-support

AI writing assistance endpoint.

**Request:**
```json
{
  "editorState": {
    "beforeCursor": "Dear [Recipient],\n\nI hope this email finds you well. ",
    "selectedText": "",
    "afterCursor": ""
  }
}
```

**Response:**
```json
{
  "suggestions": [
    "Consider adding a greeting or asking about their availability.",
    "You might want to mention the purpose of the meeting."
  ]
}
```

## Development

- The chat interface uses the `useChat` hook from `@ai-sdk/react`
- Messages are displayed with typing indicators and read receipts
