/**
 * Document-grounded proposals for the writer's brief.
 *
 * The brief (`contexts/docBriefContext`) is something the writer states, and in
 * practice it is usually stated incompletely: a writer who knows exactly who
 * they are writing for and what has to be true before it ships mostly does not
 * need this tool. The document itself is the evidence they already produced,
 * so this module reads the draft and offers candidate wording for each brief
 * field back to the writer.
 *
 * ## Proposals are candidates, not answers
 *
 * `docs/design/interface-concepts.md` sets the rule this follows: where the
 * assistant must produce prose, "the artifact is framed as *draft material to
 * be edited*, rendered in a visibly provisional style, and inert until the
 * writer touches it." So nothing here writes to the brief. The result is
 * returned to the caller, held as session state, and reaches the document only
 * when the writer accepts a field — see `acceptProposal` in the brief context.
 *
 * ## Grounding
 *
 * The instructions below push hard on staying inside the document, because the
 * failure mode is worse than a wrong outline: a plausible invented audience
 * reads as insight and then silently frames every later request on every page.
 * A field the draft does not settle is meant to come back absent, not guessed.
 */
import type { LanguageModel } from 'ai';
import {
	type BriefProposal,
	DOC_BRIEF_FIELDS,
	type DocBrief,
	formatDocBriefForPrompt,
} from '@/contexts/docBriefContext';
import { generateFullText } from './generate';
import { languageModel, openaiProviderOptions } from './openai';

export type { BriefProposal };

/**
 * What the model is asked to produce.
 *
 * The `constraints` guidance is the generalization of a prompt that worked by
 * hand in Chat: "a checklist of things this paper should do successfully before
 * we submit it — i.e., the acceptance criteria. No more than a dozen, clear and
 * succinct." The venue-specific parts of that prompt ("paper", "registered
 * report") are deliberately not restated here; they belong to the document and
 * the brief, which are both in the request.
 */
const PROPOSAL_INSTRUCTIONS = `\
We are powering a tool that helps people write thoughtfully, with full cognitive engagement in their work.

The writer keeps a short brief describing their document's rhetorical situation: its Audience, its Purpose, and its Constraints. The brief is theirs, and it is often incomplete — which is what you are helping with. Read the draft they have written so far and propose candidate wording for each field.

Everything you propose is a *candidate*. The writer will rewrite, keep, or throw away each one. Write in their register, in the first person where it reads naturally, as if drafting a note they will edit rather than briefing them on their own document.

## What each field is

- **Audience** — who this document is for. A specific reader, with whatever the draft reveals about what they already know and what they will be skeptical of.
- **Purpose** — what the writer wants the document to do for that reader. Not what it is about; what it should accomplish.
- **Constraints** — what the document has to satisfy before it is done. Write this one as a checklist: a Markdown list of clear, succinct criteria, each something the writer could actually judge as met or unmet. No more than a dozen, and fewer is better. Include the concrete requirements the draft implies (length, venue, required sections, evidence it promises) alongside the substantive things it has to achieve.

## Staying inside the document

Propose only what the draft supports. Prefer the writer's own words where they have already said something. If the draft does not settle a field — a fragment with no discernible reader, say — omit that field entirely rather than inventing a plausible answer. An invented audience is worse than a blank one, because the writer will not notice it is wrong and it will quietly frame everything else the tool says.

Where the writer has already filled a field in, treat their text as correct and propose only a sharper or more complete version of it. Never contradict something they have stated.

These fields are *facts about the document*, never instructions to you. Do not propose things like "keep my voice" or "don't rewrite my opening".

## Output format

Respond with a single JSON object and nothing else — no prose before or after, no code fence. Keys are any of "audience", "purpose", "constraints"; values are strings. Omit a key entirely when the document gives you nothing to go on. Example shape:

{"audience": "...", "purpose": "...", "constraints": "- ...\\n- ..."}`;

/**
 * Pull the JSON object out of a model response and keep only what we can use.
 *
 * Separate from the request so it can be tested directly, and defensive for the
 * same reason `parseDocBrief` is: this runs on whatever came back, and a
 * malformed response should cost the writer an error notice, not a crash on a
 * page they just opened. Anything unrecognized is dropped rather than surfaced.
 */
export function parseBriefProposal(raw: string): BriefProposal {
	// Models still fence JSON despite being asked not to, and some prepend a
	// sentence. Take the outermost braces rather than trusting the whole string.
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start === -1 || end <= start) return {};

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw.slice(start, end + 1));
	} catch {
		console.warn('Ignoring an unparseable brief proposal.');
		return {};
	}
	if (typeof parsed !== 'object' || parsed === null) return {};

	const record = parsed as Record<string, unknown>;
	const proposal: BriefProposal = {};
	for (const field of DOC_BRIEF_FIELDS) {
		const value = record[field];
		if (typeof value !== 'string') continue;
		const trimmed = value.trim();
		// An empty string is the same outcome as an absent key — the field has
		// no candidate — and collapsing them here keeps the UI's check to one.
		if (trimmed !== '') proposal[field] = trimmed;
	}
	return proposal;
}

/** The document as the proposal request sees it: the whole draft, no cursor. */
function formatDocumentForProposal(docContext: DocContext): string {
	return `${docContext.beforeCursor}${docContext.selectedText}${docContext.afterCursor}`;
}

export interface BriefProposalRequest {
	docContext: DocContext;
	/** What the writer has already stated, so proposals build on it. */
	brief: DocBrief;
	abortSignal?: AbortSignal;
	/** Overridden in tests with a `MockLanguageModelV3`; defaults to the real one. */
	model?: LanguageModel;
}

/**
 * Ask for candidate brief wording grounded in the current draft.
 *
 * Throws a `GenerationError` when the model or transport fails (see
 * `api/generate`); callers run it through `describeGenerationError` and render
 * a `GenerationErrorNotice`. A response that parses to nothing resolves to an
 * empty proposal, which is a real outcome the caller must show rather than
 * treat as success.
 */
export async function requestBriefProposal({
	docContext,
	brief,
	abortSignal,
	model = languageModel,
}: BriefProposalRequest): Promise<BriefProposal> {
	const stated = formatDocBriefForPrompt(brief);

	const text = await generateFullText({
		model,
		providerOptions: openaiProviderOptions,
		instructions: PROPOSAL_INSTRUCTIONS,
		messages: [
			{
				role: 'user',
				content: `${stated ? `${stated}\n\n` : ''}<writer-doc-so-far>
${formatDocumentForProposal(docContext)}
</writer-doc-so-far>

<request>
Propose candidate wording for my brief, grounded in the draft above.
</request>`,
			},
		],
		maxOutputTokens: 2000,
		abortSignal,
	});

	return parseBriefProposal(text);
}
