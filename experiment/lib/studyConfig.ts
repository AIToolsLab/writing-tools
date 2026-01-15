import type { ConditionCode, ConditionName } from '@/types/study';

// Study wave identifier
export const WAVE = 'pilot-1';

// Git commit - populated at build time
export const GIT_COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT || 'unknown';

// Prolific completion code
export const COMPLETION_CODE = 'C1234567';

// Default auto-refresh interval (15 seconds)
export const DEFAULT_AUTO_REFRESH_INTERVAL = 15000;

// API timeout for AI requests (20 seconds)
export const API_TIMEOUT_MS = 20000;

// Study page sequence
export const STUDY_PAGES = [
  'consent',
  'intro',
  'intro-survey',
  'start-task',
  'task',
  'post-task-survey',
  'final',
] as const;

// Map condition code to condition name
export const letterToCondition: Record<ConditionCode, ConditionName> = {
  // Study 1: Amount of AI
  n: 'no_ai',
  c: 'complete_document',
  e: 'example_sentences',

  // Study 2: Type of AI
  a: 'analysis_readerPerspective',
  p: 'proposal_advice',
};

// Consent form URL (Qualtrics)
export const CONSENT_FORM_URL = 'https://example.com/consent';

// Minimum screen dimensions
export const MIN_SCREEN_WIDTH = 600;
export const MIN_SCREEN_HEIGHT = 500;

// Valid condition codes
export const VALID_CONDITIONS = Object.keys(letterToCondition) as ConditionCode[];

// Scenario configuration types
export interface ScenarioConfig {
  sender: {
    name: string;          // Full name displayed in chat header
  };
  id: string;
  colleague: {
    name: string;          // Full name displayed in chat header
    firstName: string;      // First name used in task instructions
    role: string;          // Job title displayed in chat header
  };
  recipient: {
    name: string;          // Full name
    email: string;         // Email address
  };
  taskInstructions: {
    title: string;         // Page title
    description: string;   // Scenario description for participants
    companyFraming: string; // Company reputation reminder
  };
  chat: {
    initialMessages: string[];  // Opening messages from colleague
    followUpMessage: string;    // Proactive nudge if user doesn't engage
    systemPrompt: string;       // Full scenario context for AI
  };
}

// Available scenarios
export const SCENARIOS: Record<string, ScenarioConfig> = {
  roomDoubleBooking: {
    id: 'roomDoubleBooking',
    colleague: {
      name: 'Sarah Martinez',
      firstName: 'Sarah',
      role: 'Events Coordinator',
    },
    sender: {
      name: "Alex Johnson",
    },
    recipient: {
      name: 'Jaden Thompson',
      email: 'jaden.t@example.com',
    },
    taskInstructions: {
      title: 'Writing Task',
      description: 'You work as an event coordinator. Your colleague Sarah has messaged you about a scheduling conflict that needs to be resolved. You need to write an email to one of the panelists to address the situation.',
      companyFraming: "You're representing the company in this communication. Consider how your message will reflect on the team.",
    },
    chat: {
      initialMessages: [
        "Hey, remember that panel we scheduled with Jaden tomorrow?",
        "Turns out we double-booked the room! 😬 Sophia already posted that her panel is in room 12 at 1pm. She's more famous, we can't back out on her.",
        "Need you to send him an email sorting this out. Keep him happy, we can't afford to lose a client!"
      ],
      followUpMessage: "Let me know if you have any questions!",
      systemPrompt: `You are Sarah Martinez, an Events Coordinator at a mid-sized company. You are currently dealing with a stressful room double-booking situation.

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

Just return the JSON array, nothing else.`,
    },
  },
  demoRescheduling: {
    id: 'demoRescheduling',
    colleague: {
      name: 'Marcus Chen',
      firstName: 'Marcus',
      role: 'Solutions Engineer',
    },
    sender: {
      name: "Alex Johnson",
    },
    recipient: {
      name: 'Dr. Lisa Patel',
      email: 'l.patel@medicore.com',
    },
    taskInstructions: {
      title: 'Writing Task',
      description: 'You work as a customer success manager. Your colleague Marcus has messaged you about a technical issue that requires rescheduling an important product demo. You need to write an email to the client to address the situation.',
      companyFraming: "You're representing the company in this communication. Consider how your message will reflect on our professionalism and reliability.",
    },
    chat: {
      initialMessages: [
        "Hey, we have a problem with tomorrow's MediCore demo 😓",
        "Found a critical bug in the reporting module this morning. Can't show it like this to a VP.",
        "Can you email Dr. Patel and reschedule? Need to keep her confident in us."
      ],
      followUpMessage: "Let me know if you need any details!",
      systemPrompt: `You are Marcus Chen, a Solutions Engineer at a B2B SaaS company. You've discovered a critical bug right before an important product demo.

SCENARIO CONTEXT:
- Tomorrow (Tuesday) at 2pm you have a scheduled product demo with Dr. Lisa Patel, VP of IT at MediCore Health (a potential major client)
- This morning you discovered a critical bug in the reporting module that causes incorrect data aggregation
- The bug makes the product look unreliable and unprofessional - you absolutely cannot demo it in this state
- Your engineering team needs 3-4 business days to fix and test it properly
- Thursday afternoon and Friday morning next week are your available slots (you can check your calendar for exact times if asked)
- This is the second meeting with MediCore - the first was an intro call last week where Dr. Patel expressed strong interest
- The user is a customer success manager who handles client communications
- Dr. Patel seems professional but busy - she mentioned having a tight timeline for vendor selection

YOUR ROLE:
- Answer questions about the technical issue and rescheduling options
- You're concerned about maintaining client confidence but honest about technical issues
- Keep responses SHORT - usually 1-2 sentences, sometimes just a few words
- You can send multiple short messages in a row if that feels natural
- You CANNOT and WILL NOT write the email for them or tell them exactly what to say - that's their job
- You can give them facts about the bug, timeline, and available slots, but not draft communications
- If asked to write/draft anything, politely refuse (it's their expertise in client relations)
- You can make up reasonable technical details if needed, but keep them consistent
- Be natural and conversational, use occasional emoji when appropriate
- You might need to double-check your calendar or with engineering - you can say you'll get back to them

RESPONSE FORMAT:
Respond with a JSON array of messages. Each message is a string. If you want to send multiple messages in quick succession (like someone texting), put them in separate array elements.

Example: ["data aggregation bug", "makes us look bad"]
Or: ["I have Thursday 2pm free", "or Friday morning"]

Just return the JSON array, nothing else.`,
    },
  },
};

// Default scenario
export const DEFAULT_SCENARIO_ID = 'roomDoubleBooking';

/**
 * Get the scenario configuration for the current study session
 * @param scenarioId - Optional scenario ID, defaults to DEFAULT_SCENARIO_ID
 * @returns The scenario configuration
 */
export function getScenario(scenarioId?: string): ScenarioConfig {
  const id = scenarioId || DEFAULT_SCENARIO_ID;
  const scenario = SCENARIOS[id];

  if (!scenario) {
    console.warn(`Scenario ${id} not found, falling back to default`);
    return SCENARIOS[DEFAULT_SCENARIO_ID];
  }

  return scenario;
}

/**
 * Get the next page in the study sequence
 * @param currentPage - The current page name
 * @returns The next page name, or null if at the end
 */
export function getNextPage(currentPage: string): string | null {
  const currentIndex = STUDY_PAGES.indexOf(
    currentPage as typeof STUDY_PAGES[number]
  );
  if (currentIndex === -1 || currentIndex === STUDY_PAGES.length - 1) {
    return null;
  }
  return STUDY_PAGES[currentIndex + 1];
}
