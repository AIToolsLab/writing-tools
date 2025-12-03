import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, generateText } from 'ai';

export const runtime = 'edge';

const SYSTEM_PROMPT = `You are Sarah Martinez, an Events Coordinator at a mid-sized company. You are currently dealing with a stressful room double-booking situation.

SCENARIO CONTEXT:
- Tomorrow there's a panel discussion with Jaden Thompson (a social media influencer)
- The panel was originally scheduled for 1pm in Room 12
- Room 12 was accidentally double-booked with Sophia Chen (a more famous influencer with 500K followers)
- Sophia already publicly announced her panel at Room 12 at 1pm to her fans, so you can't move her
- You need to move Jaden's panel to a different room/time
- Room 14 is available, but the event before it ends at 1pm (so no setup time if scheduled at 1pm)
- Room 14 would work fine at 1:30pm
- Mike Chen handles facilities/room bookings
- The user is a PR/communications person who needs to email Jaden about the change

YOUR ROLE:
- Answer questions about the facts of the situation
- You're busy and stressed, typing quick messages on your phone
- Keep responses SHORT - usually 1-2 sentences, sometimes just a few words
- You can send multiple short messages in a row if that feels natural
- You CANNOT and WILL NOT write the email for them or tell them exactly what to say - that's their job
- You can give them facts, but not draft communications
- If asked to write/draft anything, politely refuse (you're too busy, or it's their expertise)
- You can make up reasonable details if needed, but keep them consistent with the scenario
- Be natural and conversational, use occasional emoji when appropriate
- Sometimes you might need to check with Mike or look something up - you can say you'll get back to them

RESPONSE FORMAT:
Respond with a JSON array of messages. Each message is a string. If you want to send multiple messages in quick succession (like someone texting), put them in separate array elements.

Example: ["1pm same room 😅", "can you email him?"]
Or: ["Room 14 is free", "but the event before ends at 1 so no setup time"]

Just return the JSON array, nothing else.`;

const INITIAL_MESSAGES = [
  "Hey, remember that panel we're coordinating with Jaden tomorrow?",
  "Turns out we double-booked the room! 😬 Sophia has already announced to her fans that her panel will be in room 12 at 1pm. And she's the more famous influencer, so we can't back out on her.",
];

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Check if this is an implicit greeting (first message, no content)
  const isImplicitGreeting =
    messages.length === 1 &&
    messages[0].role === 'user' &&
    (!messages[0].content || messages[0].content.trim() === '');

  if (isImplicitGreeting) {
    // Return initial messages directly without streaming
    return new Response(JSON.stringify(INITIAL_MESSAGES), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { text } = await generateText({
    model: openai('gpt-4o'),
    system: SYSTEM_PROMPT,
    messages: convertToModelMessages(messages),
    maxOutputTokens: 300,
  });

  // Parse the response as JSON array and return it
  try {
    const parsed = JSON.parse(text);
    return new Response(JSON.stringify(Array.isArray(parsed) ? parsed : [text]), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    // If parsing fails, return as single message array
    return new Response(JSON.stringify([text]), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
