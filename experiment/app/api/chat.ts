import { createFileRoute } from '@tanstack/react-router'
import { openai } from '@ai-sdk/openai'
import { convertToModelMessages, streamText } from 'ai'
import { getScenario } from '@/lib/studyConfig'

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages, scenario: scenarioId } = await request.json()
        const scenario = getScenario(scenarioId)

        const result = streamText({
          model: openai('gpt-5.2'),
          system: scenario.chat.systemPrompt,
          messages: convertToModelMessages(messages),
          maxOutputTokens: 300,
        })

        return result.toUIMessageStreamResponse()
      },
    },
  },
})
