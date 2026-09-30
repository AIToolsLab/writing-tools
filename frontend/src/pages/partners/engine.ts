/**
 * The decision engine (§4.2) and suggestion generation (§4.3).
 *
 * ## About these prompts
 *
 * The paper says its prompts are in supplementary materials. The arXiv PDF has
 * no such appendix — pages 24-30 are references. Everything below is therefore
 * **reconstructed from the prose**, not transcribed, and any behavioural
 * difference from the paper could be a prompt difference we cannot detect.
 * What the prose does pin down, and what is honoured here:
 *
 * - The engine receives the session goal, the current text, the recent writing
 *   behaviour, and the enabled partners; it "selects at most two enabled
 *   partners, if any" by "checking whether their user-defined contextual
 *   heuristics are satisfied" (§4.2).
 * - A suggestion is two parts: an acknowledgement of what the writer has just
 *   done or may be trying to do next, then a *question* — question form
 *   because the paper cites evidence that it stimulates ideas while preserving
 *   the writer's ownership (§4.3).
 *
 * ## One model, not two
 *
 * The paper splits a fast model for the decision and a stronger one for the
 * suggestion. We proxy a single model, so both calls use it, and the
 * suggestion is generated lazily on click rather than eagerly on activation.
 * See challenge C5 in `docs/proactive-partners-reproduction.md`.
 */
import { generateFullText } from '@/api/generate';
import { languageModel, openaiProviderOptions } from '@/api/openai';
import { describeActivity } from './signals';
import type {
	ActivityRecord,
	DocSnapshot,
	EventTrigger,
	Partner,
	Suggestion,
	TriggerEvent,
} from './types';
import { TRIGGER_LABELS } from './types';

/** The paper's cap: "at most two" partners per triggering event (§4.2). */
export const MAX_ACTIVATIONS = 2;

/**
 * How much document to send. The paper sends "the current text in the editor";
 * we cap it because a task pane can be sitting beside a book chapter, and the
 * useful context for a moment-to-moment judgement is local.
 */
const CONTEXT_CHARS_BEFORE = 3_000;
const CONTEXT_CHARS_AFTER = 1_000;

function describeTrigger(trigger: EventTrigger): string {
	switch (trigger) {
		case 'long-pause':
			return 'The writer stopped typing for several seconds.';
		case 'sentence-end':
			return 'The writer just finished a sentence and paused briefly.';
		case 'text-selection':
			return 'The writer selected a span of text and left it selected.';
	}
}

/**
 * The document as the model sees it: a window around the cursor, with the
 * cursor or selection marked. Matches the convention the Chat page already
 * uses, so a reader of the logs sees one document format across pages.
 */
export function renderDocument(snapshot: DocSnapshot): string {
	const before = snapshot.beforeCursor.slice(-CONTEXT_CHARS_BEFORE);
	const after = snapshot.afterCursor.slice(0, CONTEXT_CHARS_AFTER);
	const truncatedBefore =
		snapshot.beforeCursor.length > CONTEXT_CHARS_BEFORE ? '…' : '';
	const truncatedAfter =
		snapshot.afterCursor.length > CONTEXT_CHARS_AFTER ? '…' : '';
	if (snapshot.selectedText === '') {
		return `${truncatedBefore}${before}<<CURSOR>>${after}${truncatedAfter}`;
	}
	return `${truncatedBefore}${before}<<SELECTION>>${snapshot.selectedText}<</SELECTION>>${after}${truncatedAfter}`;
}

function renderSituation(
	snapshot: DocSnapshot,
	activity: ActivityRecord[],
	trigger: EventTrigger,
	brief: string | null,
): string {
	return [
		brief,
		`What just happened: ${describeTrigger(trigger)}`,
		`Recent writing behaviour: ${describeActivity(activity, snapshot.at)}`,
		`The document, with the writer's cursor or selection marked:\n\n${renderDocument(snapshot)}`,
	]
		.filter(Boolean)
		.join('\n\n');
}

export const DECISION_INSTRUCTIONS = `\
You decide whether an AI writing partner should speak up right now, while someone is writing.

You will be given the writer's brief, what they just did, a summary of their recent editing activity, their document with the cursor or selection marked, and a list of partners the writer configured. Each partner has a role (the kind of help it gives) and a contextual heuristic (the condition the writer said should be true before it interrupts).

For each partner, judge only one thing: is that partner's heuristic actually satisfied by this moment in this document? Judge the heuristic as written. Do not activate a partner because its role seems generally useful.

Select at most two partners, and prefer to select none. Interrupting a writer who does not need help is worse than staying quiet: silence is the correct answer most of the time.

Reply with JSON and nothing else, in this shape:
{"activate": [{"id": "<partner id>", "why": "<one short sentence on which part of the heuristic this moment satisfies>"}]}
Use {"activate": []} to stay silent.`;

function renderPartnerList(partners: Partner[]): string {
	return partners
		.map(
			(partner) =>
				`- id: ${partner.id}\n  name: ${partner.name}\n  role: ${partner.role}\n  speak up when: ${partner.heuristic}`,
		)
		.join('\n');
}

export interface DecisionChoice {
	id: string;
	why: string;
}

/**
 * Parse the engine's reply.
 *
 * Tolerant on purpose: a fenced code block, a stray preamble, or a missing
 * `why` should degrade to "no partners" or "this partner, no reason" rather
 * than to an exception on the writing path. Unknown ids are dropped — the
 * model occasionally invents one — and the result is capped at two.
 */
export function parseDecision(
	raw: string,
	knownIds: Set<string>,
): DecisionChoice[] {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
	const body = (fenced ? fenced[1] : raw).trim();
	const start = body.indexOf('{');
	const end = body.lastIndexOf('}');
	if (start === -1 || end <= start) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(body.slice(start, end + 1));
	} catch {
		return [];
	}
	const activate = (parsed as { activate?: unknown })?.activate;
	if (!Array.isArray(activate)) return [];
	const seen = new Set<string>();
	const choices: DecisionChoice[] = [];
	for (const entry of activate) {
		if (typeof entry !== 'object' || entry === null) continue;
		const record = entry as Record<string, unknown>;
		const id = typeof record.id === 'string' ? record.id : '';
		if (!knownIds.has(id) || seen.has(id)) continue;
		seen.add(id);
		choices.push({
			id,
			why: typeof record.why === 'string' ? record.why : '',
		});
		if (choices.length === MAX_ACTIVATIONS) break;
	}
	return choices;
}

/** Ask the engine which of `candidates`, if any, should speak up now. */
export async function decideActivations(
	event: TriggerEvent,
	candidates: Partner[],
	brief: string | null,
	signal?: AbortSignal,
): Promise<DecisionChoice[]> {
	if (candidates.length === 0) return [];
	const prompt = [
		renderSituation(event.snapshot, event.activity, event.trigger, brief),
		`The writer's partners:\n${renderPartnerList(candidates)}`,
	].join('\n\n');

	const raw = await generateFullText({
		model: languageModel,
		instructions: DECISION_INSTRUCTIONS,
		messages: [{ role: 'user', content: prompt }],
		providerOptions: openaiProviderOptions,
		abortSignal: signal,
	});
	return parseDecision(raw, new Set(candidates.map((partner) => partner.id)));
}

export const SUGGESTION_INSTRUCTIONS = `\
You are a thought partner for a writer, configured by them for one specific kind of help. You have just decided this is a good moment to speak up, unprompted, while they are mid-draft.

Say two things, in this order.

First, one sentence acknowledging what the writer appears to be doing right now — what they have just written, or what they seem to be reaching for next. Ground it in their actual text. This is how you show you have read them; it also lets them catch you if you have misread.

Second, one question that opens up the thinking your role is meant to support. A question, not an instruction and not a rewrite: the writer's sentences are theirs, and your job is to make a line of thought available to them, not to supply it. It should be specific to this draft — a question that would make sense pasted under any document is not worth interrupting for. It may name a concrete possibility as part of the question, but it must still end as a question they could answer either way.

Be brief. Two or three sentences total. Do not greet them, do not explain yourself, and do not praise the writing.

Reply with JSON and nothing else:
{"acknowledgement": "<one sentence>", "question": "<one question>"}`;

/**
 * Parse a suggestion, falling back to treating the whole reply as the question
 * when the model answers in prose. A partner that produced *something* is more
 * useful to the writer than an error card, and an empty question is still
 * caught by the caller.
 */
export function parseSuggestion(raw: string): Suggestion {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
	const body = (fenced ? fenced[1] : raw).trim();
	const start = body.indexOf('{');
	const end = body.lastIndexOf('}');
	if (start !== -1 && end > start) {
		try {
			const parsed = JSON.parse(body.slice(start, end + 1)) as Record<
				string,
				unknown
			>;
			const acknowledgement =
				typeof parsed.acknowledgement === 'string'
					? parsed.acknowledgement
					: '';
			const question =
				typeof parsed.question === 'string' ? parsed.question : '';
			if (acknowledgement || question) {
				return { acknowledgement, question };
			}
		} catch {
			// Fall through to the prose reading below.
		}
	}
	return { acknowledgement: '', question: body };
}

export async function generateSuggestion(
	partner: Partner,
	snapshot: DocSnapshot,
	activity: ActivityRecord[],
	trigger: EventTrigger,
	brief: string | null,
	signal?: AbortSignal,
): Promise<Suggestion> {
	const prompt = [
		`Your role: ${partner.role}`,
		`The writer asked you to speak up when: ${partner.heuristic}`,
		renderSituation(snapshot, activity, trigger, brief),
	].join('\n\n');

	const raw = await generateFullText({
		model: languageModel,
		instructions: SUGGESTION_INSTRUCTIONS,
		messages: [{ role: 'user', content: prompt }],
		providerOptions: openaiProviderOptions,
		abortSignal: signal,
	});
	return parseSuggestion(raw);
}

/**
 * The follow-up conversation of §4.4 ("Inspiring"): the writer can clarify,
 * ask for alternatives, or challenge the partner's framing. Kept in the same
 * register as the suggestion — this is still a partner, not a text generator.
 */
export const FOLLOW_UP_INSTRUCTIONS = `\
You are the same thought partner, now in a short follow-up conversation the writer opened from your suggestion. They may want it clarified, want alternatives, or want to push back on your framing.

Stay a thought partner. Answer plainly and briefly — two or three sentences. Do not draft prose for the document and do not rewrite their sentences; where they seem to want that, point at what the choice actually is and let them make it. It is fine to say your suggestion does not apply here.`;

export function followUpContext(
	partner: Partner,
	snapshot: DocSnapshot,
	trigger: EventTrigger,
	suggestion: Suggestion,
	brief: string | null,
): string {
	return [
		`Your role: ${partner.role}`,
		brief,
		`You spoke up because: ${TRIGGER_LABELS[trigger]} — ${describeTrigger(trigger)}`,
		`The document at that moment:\n\n${renderDocument(snapshot)}`,
		`What you said:\n${suggestion.acknowledgement}\n${suggestion.question}`,
	]
		.filter(Boolean)
		.join('\n\n');
}
