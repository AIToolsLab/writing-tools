/**
 * Calculate realistic timing for message delays based on message length.
 *
 * Thinking/Reading: Sarah takes time proportional to what the user wrote (40-80 chars/sec)
 * Typing: Sarah types her response proportional to what she's typing (40-80 chars/sec)
 * Both use ±300ms variation
 */

const MIN_READING_SPEED = 40; // chars per second
const MAX_READING_SPEED = 80; // chars per second
const READING_VARIATION = 300; // ±ms

/**
 * Calculate thinking/reading delay based on received message length
 * @param messageLength - Length of the received message in characters
 * @returns Delay in milliseconds
 */
export function calculateThinkingDelay(messageLength: number): number {
  if (messageLength === 0) return 400; // Minimum delay for empty messages

  // Random speed between MIN and MAX chars/sec
  const speed = MIN_READING_SPEED + Math.random() * (MAX_READING_SPEED - MIN_READING_SPEED);

  // Calculate base delay: how long to read the message
  const baseDelay = (messageLength / speed) * 1000;

  // Add variation: ±300ms
  const variation = (Math.random() - 0.5) * 2 * READING_VARIATION;

  return Math.max(400, baseDelay + variation); // Minimum 400ms
}

/**
 * Calculate typing duration based on response message length
 * @param messageLength - Length of the message being typed in characters
 * @returns Duration in milliseconds
 */
export function calculateTypingDuration(messageLength: number): number {
  if (messageLength === 0) return 300; // Minimum duration

  // Random speed between MIN and MAX chars/sec
  const speed = MIN_READING_SPEED + Math.random() * (MAX_READING_SPEED - MIN_READING_SPEED);

  // Calculate base duration: how long to type the message
  const baseDuration = (messageLength / speed) * 1000;

  // Add variation: ±300ms
  const variation = (Math.random() - 0.5) * 2 * READING_VARIATION;

  return Math.max(300, baseDuration + variation); // Minimum 300ms
}

/**
 * Calculate delay between multiple messages
 * Uses the typing duration of the previous message as the inter-message delay
 * @param previousMessageLength - Length of the previous message
 * @returns Delay in milliseconds
 */
export function calculateInterMessageDelay(previousMessageLength: number): number {
  // Reuse typing duration calculation - messages sent one after another
  return calculateTypingDuration(previousMessageLength);
}
