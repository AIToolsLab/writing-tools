# Writing Task Prototype

A Next.js application that simulates a writing task with AI-powered chat support. This app was built based on a prototype HTML file and uses Vercel's AI SDK for LLM integration.

## Features

- **Email Writing Interface**: Compose emails with a realistic email editor
- **AI Chat Assistant**: Chat with "Sarah Martinez," an AI-powered events coordinator who provides context for your writing task
- **Writing Support API**: Stubbed endpoint for future AI writing assistance
- **Streaming Responses**: Real-time streaming chat responses using Vercel AI SDK

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **AI Integration**: Vercel AI SDK with OpenAI
- **Runtime**: Edge runtime for API routes

## Getting Started

### Prerequisites

- Node.js 18+ installed
- OpenAI API key

### Installation

1. Navigate to the project directory:

```bash
cd writing-task-app
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
│   │   └── writing-support/route.ts # Stubbed writing support endpoint
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

Streaming chat endpoint that simulates a conversation with Sarah Martinez, an events coordinator.

**Request:**
```json
{
  "messages": [
    { "role": "user", "content": "What room is available?" }
  ]
}
```

**Response:** Server-Sent Events stream with AI responses

### POST /api/writing-support

Stubbed endpoint for AI writing assistance (to be implemented).

**Request:**
```json
{
  "editorState": {
    "beforeCursor": "Dear Jaden,\n\nI hope this email finds you well. ",
    "selectedText": "",
    "afterCursor": ""
  }
}
```

**Response:**
```json
{
  "suggestions": [
    "Writing support coming soon!"
  ]
}
```

## Development

- The chat interface uses the `useChat` hook from `@ai-sdk/react` for real-time streaming
- Messages use the UIMessage format with `parts` array for flexible content
- The `DefaultChatTransport` handles communication with the `/api/chat` endpoint
- Messages are displayed with typing indicators and read receipts
- The second message from Sarah appears automatically after 8 seconds
- All API routes use Edge runtime for optimal performance

## License

MIT
