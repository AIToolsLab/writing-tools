/**
 * The My Words voice session: the six editor tools, the word-bank rule, the
 * reveal/veto beat, and the undo stack. Everything here is transport-agnostic —
 * the spoken channel arrives as a `VoiceTransport` (see `transport.ts`), which
 * `realtime.ts` implements over OpenAI Realtime.
 *
 * The browser owns the real document (the `EditorAPI` seam), so a tool call maps
 * to an `EditOp`, is validated against the *live* corpus, and is applied through
 * the same durable edit path the text tabs use — only the turn-loop differs.
 * Tool results are plain strings the model reads back: a numbered `view`, a
 * windowed "Applied …" confirmation, or a `REJECTED: …` line.
 *
 * Every tool takes `target: 'document' | 'scratchpad'`. The scratchpad is a
 * second, deliberately-out-of-sync surface (the writer's ideas in their own
 * words, Markdown-ish); edits to it run through the same validation and the same
 * paragraph-splice machinery, applied to the text held by the React page.
 *
 * ## Control invariants
 *
 * These six are enforced *here, in code*, not asked for in the prompt — the
 * prompt spends its words on stance (`prompt.ts`). Each exists because the
 * writer's sense of being in control fails in a specific way without it. They
 * are covered by `../__tests__/voiceControl.test.ts`; if you change one, that
 * file should be why you notice.
 *
 * 1. **One applied edit per writer turn.** The budget resets when the writer
 *    starts speaking — deliberately *not* on model-response boundaries, because
 *    this session requests a follow-up response after every tool result, so a
 *    per-response budget would reset immediately and gate nothing. Scoping it to
 *    the writer's turn is also the honest reading of "one move, then hand back
 *    the floor": the writer's "yeah, go on" is what releases the next move.
 *    Only a *successful apply* consumes it — a rejected or vetoed edit must be
 *    retryable, or one bad guess costs the agent the whole turn.
 * 2. **Speech during a veto window cancels the pending edit.** The writer's
 *    instinctive "no, wait" has to work; a ~750ms window is too short to reach
 *    for the ✕ chip. Note the shape: we hold the open window's `cancel`
 *    function and call it, rather than setting a "writer objected" flag — a flag
 *    would leak past the window and silently kill the *next* edit while the
 *    writer talks normally.
 * 3. **No silent failure.** Every path that ends without the edit landing emits
 *    exactly one writer-visible notice (`onNotice`) as well as the model-facing
 *    string. Otherwise the agent just goes quiet, which reads as broken rather
 *    than as principled refusal — and word-bank rejections *will* happen for
 *    mundane reasons like a mis-transcribed word.
 * 4. **Undo inverses are captured at apply time, never re-derived,** and
 *    freshness-checked before they restore anything, so a region the writer has
 *    since hand-edited is refused rather than clobbered.
 * 5. **Highlighting is not an edit.** It never costs or is blocked by the
 *    one-edit-per-turn budget — before or after an edit has spent the turn, or
 *    however many times in a row the model wants to point at something while it
 *    talks. It does take a short beat of its own before the tool result comes
 *    back, so the writer's eye has time to land before the model's next word —
 *    but that beat carries no veto. There's nothing to undo about a selection,
 *    so unlike an edit's reveal window, speech during it is not treated as an
 *    objection and does not touch `pendingVeto`.
 * 6. **A notice describes one attempt, not the session.** The counterpart to 3:
 *    whatever raised the last notice is over once the writer takes the floor
 *    again or the partner lands an edit, so both retract it (`onNotice(null)`).
 *    A strip that cleared only on replacement or manual dismissal outlived its
 *    cause by many successful turns, and a stale "that was blocked" is
 *    indistinguishable from a live one — it reads as the session still being
 *    broken. The debug log keeps the whole history; the strip is only ever
 *    about *now*.
 */

import type { Corpus } from '../corpus';
import {
	applyEditOp,
	applySpliceToEditor,
	delay,
	EditVetoed,
	revealAnchorFor,
	vetoWindow,
	type ApplyEditOptions,
} from '../interaction/editor';
import {
	applyOpLogged,
	applySplice,
	describeOp,
	invertSplices,
	spliceIsFresh,
} from '../interaction/ops';
import {
	appliedReport,
	numberedWindow,
	validateOp,
	viewParagraphs,
} from '../interaction/shared';
import type { EditOp } from '../interaction/types';
import { GREETING_INSTRUCTIONS, VOICE_INSTRUCTIONS } from './prompt';
import { startRealtimeTransport } from './realtime';
import { buildVoiceTools, type ToolName } from './tools';
import type {
	TranscriptSegment,
	TranscriptSpeaker,
	VoiceTransport,
} from './transport';

export type { TranscriptSegment, TranscriptSpeaker };

type Target = 'document' | 'scratchpad';

export interface VoiceSessionOptions {
	/** The real editor host (from EditorContext). */
	editor: EditorAPI;
	/** Builds the live word-bank; must include the writer's rolling transcript. */
	corpus: () => Promise<Corpus>;
	/**
	 * Read/write access to the scratchpad text. `set` must update synchronously
	 * (ref first, then React state) so back-to-back tool calls see fresh text.
	 */
	scratchpad: { get: () => string; set: (text: string) => void };
	/** Element the partner's audio is played back through. */
	audioEl: HTMLAudioElement;
	/** A transcript update (interim or final); dedupe by `seg.id`. */
	onTranscript?: (seg: TranscriptSegment) => void;
	/** A tool call landed (for the debug log). */
	onTool?: (text: string) => void;
	/** Connection/playback status (not conversation content). */
	onStatus?: (text: string) => void;
	/**
	 * Something the *writer* needs to know: an edit was refused, cancelled, or
	 * couldn't be applied. Invariant 3 — one per failed attempt, never silent.
	 * `null` retracts the standing notice: the thing it described is over (see
	 * invariant 6).
	 */
	onNotice?: (text: string | null) => void;
	/** The partner points at a scratchpad phrase (null clears the highlight). */
	onScratchpadHighlight?: (phrase: string | null) => void;
	/** A veto window opened (info) or closed (null); wire `cancel` to a ✕ chip. */
	onReveal?: (info: { anchor?: string; cancel: () => void } | null) => void;
	/** The undo stack changed: depth plus what the top entry would revert. */
	onUndoChange?: (state: { depth: number; description?: string }) => void;
	/** Swap the spoken channel (tests pass a fake). Defaults to OpenAI Realtime. */
	transport?: VoiceTransport;
}

export interface VoiceSession {
	stop: () => Promise<void>;
	/** Undo the most recent partner edit (shared by the UI button and the tool). */
	undo: () => Promise<string>;
}

/** How many partner edits stay undoable. */
const UNDO_CAP = 10;

/** Beat before a scratchpad edit lands (the panel highlight is the reveal). */
const SCRATCHPAD_REVEAL_MS = 750;

/**
 * Beat after a highlight lands, before the tool result returns. Paces the
 * model, not a veto window (invariant 5) — nothing here is undoable, so
 * nothing needs `revealOpts`/`pendingVeto`.
 */
const HIGHLIGHT_BEAT_MS = 500;

/** Coerce an unknown argument field to a string (non-strings → ''). */
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Map tool arguments to an `EditOp`, or throw if the shape is unusable. */
function argsToOp(name: string, a: Record<string, unknown>): EditOp {
	switch (name) {
		case 'str_replace': {
			const oldStr = str(a.old_str);
			if (!oldStr) throw new Error('old_str was missing or empty');
			return {
				kind: 'str_replace',
				oldStr,
				newStr: str(a.new_str),
				paragraph: a.paragraph as number | undefined,
			};
		}
		case 'insert': {
			const text = str(a.text);
			if (!text) throw new Error('text was missing or empty');
			return {
				kind: 'insert',
				text,
				after: a.after as string | undefined,
				paragraph: a.paragraph as number | undefined,
				position: a.position as 'before' | 'after' | undefined,
			};
		}
		case 'move': {
			const phrase = str(a.phrase);
			const paragraph = Number(a.paragraph);
			if (!phrase) throw new Error('phrase was missing or empty');
			if (!Number.isFinite(paragraph)) {
				throw new Error('paragraph was not a number');
			}
			return {
				kind: 'move',
				phrase,
				paragraph,
				position: a.position as 'before' | 'after' | undefined,
			};
		}
		default:
			throw new Error(`not an edit tool: ${name}`);
	}
}

export async function startVoiceSession(
	opts: VoiceSessionOptions,
): Promise<VoiceSession> {
	const { editor, corpus, audioEl, scratchpad } = opts;
	const transport = opts.transport ?? startRealtimeTransport;

	const scratchLines = () => scratchpad.get().split('\n');

	/** Writer-visible failure (invariant 3). Also mirrored into the debug log. */
	const notice = (writerText: string, logText: string): void => {
		opts.onNotice?.(writerText);
		opts.onTool?.(logText);
	};

	/**
	 * Retract the standing notice (invariant 6). Not logged — the notice's own
	 * log line stays; this only takes it off the writer's screen.
	 */
	const clearNotice = () => opts.onNotice?.(null);

	// Inverses of applied edits, most recent last. Popped by `undo`; each entry
	// is freshness-checked against the live surface before it restores anything.
	// The shape ({target, splices, description}) is also the substrate a future
	// change-history view needs — splices carry both old and new text.
	const undoStack: {
		target: Target;
		splices: ParagraphSplice[];
		description: string;
	}[] = [];
	const announceUndo = () =>
		opts.onUndoChange?.({
			depth: undoStack.length,
			description: undoStack[undoStack.length - 1]?.description,
		});
	const pushUndo = (entry: (typeof undoStack)[number]) => {
		undoStack.push(entry);
		if (undoStack.length > UNDO_CAP) undoStack.shift();
		announceUndo();
	};

	// --- Invariant 1: one applied edit per writer turn -----------------------
	// Reset when the writer speaks (below), consumed only by a successful apply.
	let editBudget = 1;

	// --- Invariant 2: speech during a veto window cancels the pending edit ---
	// Holds the *open window's* cancel function, so it cannot leak past the
	// window and kill a later edit.
	let pendingVeto: (() => void) | null = null;

	const onSpeechStart = () => {
		// The writer took the floor: a new move is allowed, and whatever the
		// last notice was about belongs to the exchange they just ended.
		editBudget = 1;
		clearNotice();
		if (pendingVeto) {
			const cancel = pendingVeto;
			pendingVeto = null;
			cancel();
		}
	};

	const revealOpts: Pick<ApplyEditOptions, 'onReveal' | 'onRevealEnd'> = {
		onReveal: (info) => {
			pendingVeto = info.cancel;
			opts.onReveal?.(info);
		},
		onRevealEnd: () => {
			pendingVeto = null;
			opts.onReveal?.(null);
		},
	};

	const undoLast = async (): Promise<string> => {
		const entry = undoStack.pop();
		announceUndo();
		if (!entry) return 'Nothing to undo.';
		const { target, splices, description } = entry;

		// Dry-run against the live surface: every splice must still find the text
		// it expects (the writer may have typed, or hit the host's own undo, since
		// the edit landed).
		let paras =
			target === 'document'
				? await editor.getParagraphs()
				: scratchLines();
		for (const s of splices) {
			if (!spliceIsFresh(paras, s)) {
				notice(
					`Couldn't undo “${description}” — you've changed that part since.`,
					`undo skipped (stale): ${description}`,
				);
				return `That edit has already been changed — nothing was undone.`;
			}
			paras = applySplice(paras, s);
		}

		// Reveal where the revert happens, then apply for real.
		const anchor = splices[0]?.remove[0];
		if (target === 'document') {
			if (anchor) await editor.selectPhrase(anchor).catch(() => {});
			await delay(SCRATCHPAD_REVEAL_MS);
			for (const s of splices) await applySpliceToEditor(editor, s);
		} else {
			if (anchor) opts.onScratchpadHighlight?.(anchor);
			await delay(SCRATCHPAD_REVEAL_MS);
			scratchpad.set(paras.join('\n'));
			opts.onScratchpadHighlight?.(null);
		}
		opts.onTool?.(`undo: ${description}`);
		const around = (splices[splices.length - 1]?.index ?? 0) + 1;
		return `Undid: ${description}. The ${target} now has ${paras.length} paragraph(s). Around the change:\n${numberedWindow(paras, around)}`;
	};

	// The dispatcher every tool call lands on. Returns a string the model reads;
	// never throws for an expected outcome (a word-bank miss, a veto, a stale
	// undo) — those are results the model should re-orient on.
	const dispatch = async (
		name: ToolName,
		args: Record<string, unknown>,
	): Promise<string> => {
		const target: Target =
			args.target === 'scratchpad' ? 'scratchpad' : 'document';

		if (name === 'undo') return undoLast();

		if (name === 'view') {
			const paras =
				target === 'document'
					? await editor.getParagraphs()
					: scratchLines();
			const around =
				typeof args.around === 'number' ? args.around : undefined;
			if (around !== undefined) return numberedWindow(paras, around, 2);
			return viewParagraphs(
				paras,
				target === 'document'
					? '(the document is empty)'
					: '(the scratchpad is empty)',
			);
		}

		if (name === 'highlight') {
			const phrase = str(args.phrase);
			if (target === 'scratchpad') {
				if (!scratchpad.get().includes(phrase)) {
					notice(
						`Your partner looked for “${phrase}” on the scratchpad and couldn't find it.`,
						`highlight miss (scratchpad): "${phrase}"`,
					);
					return `Could not find "${phrase}" on the scratchpad.`;
				}
				opts.onScratchpadHighlight?.(phrase);
				await delay(HIGHLIGHT_BEAT_MS);
				opts.onTool?.(`highlight scratchpad ("${phrase}")`);
				return 'Highlighted on the scratchpad.';
			}
			try {
				await editor.selectPhrase(phrase);
				await delay(HIGHLIGHT_BEAT_MS);
				opts.onTool?.(`highlight("${phrase}")`);
				return 'Highlighted.';
			} catch {
				notice(
					`Your partner looked for “${phrase}” and couldn't find it.`,
					`highlight miss: "${phrase}"`,
				);
				return `Could not find "${phrase}" to highlight.`;
			}
		}

		// --- An edit. Invariant 1: one applied edit per writer turn. ---
		// Checked before validation so a refused move costs nothing else.
		if (editBudget <= 0) {
			opts.onTool?.(`${name} withheld (already moved this turn)`);
			return (
				`You've already made a move this turn. Say briefly what you changed ` +
				`and hand the floor back — you can make another move once the writer ` +
				`has spoken.`
			);
		}

		let op: EditOp;
		try {
			op = argsToOp(name, args);
		} catch (e) {
			notice(
				`Your partner tried an edit that didn't make sense and skipped it.`,
				`unusable ${name} args: ${(e as Error).message}`,
			);
			return `Could not read that tool call: ${(e as Error).message} Re-\`view\` and try again.`;
		}

		const check = validateOp(op, await corpus());
		if (!check.ok) {
			notice(
				`Your partner tried to use “${check.offending}” — not your words yet, so it was blocked.`,
				`REJECTED ${name}: "${check.offending}"`,
			);
			return `REJECTED: "${check.offending}" isn't in the writer's words yet. Use only what they've written or said aloud. (Ask a leading question if needed.)`;
		}

		if (target === 'scratchpad') {
			const before = scratchLines();
			try {
				// Reveal in the panel, run the veto window, then splice the text.
				const anchor = revealAnchorFor(op, before);
				if (anchor && scratchpad.get().includes(anchor)) {
					opts.onScratchpadHighlight?.(anchor);
				}
				const vetoed = await vetoWindow(
					SCRATCHPAD_REVEAL_MS,
					revealOpts,
					anchor,
				);
				if (vetoed) throw new EditVetoed();
				const { after, undo } = applyOpLogged(before, op);
				scratchpad.set(after.join('\n'));
				pushUndo({
					target: 'scratchpad',
					splices: undo,
					description: describeOp(op),
				});
				editBudget = 0;
				clearNotice();
				opts.onTool?.(`${name} applied to scratchpad`);
				return appliedReport(after, op, 'scratchpad');
			} catch (e) {
				if (e instanceof EditVetoed) {
					notice(
						`Cancelled: ${describeOp(op)}.`,
						`${name} vetoed by the writer`,
					);
					return `The writer cancelled that edit during the reveal. Don't retry it — ask how they'd like to proceed.`;
				}
				notice(
					`Your partner couldn't apply an edit to the scratchpad.`,
					`${name} failed (scratchpad): ${(e as Error).message}`,
				);
				return `Could not apply that to the scratchpad: ${(e as Error).message} Re-\`view\` the scratchpad and try again.`;
			} finally {
				opts.onScratchpadHighlight?.(null);
			}
		}

		try {
			const splices = await applyEditOp(editor, op, revealOpts);
			pushUndo({
				target: 'document',
				splices: invertSplices(splices),
				description: describeOp(op),
			});
			editBudget = 0;
		} catch (e) {
			if (e instanceof EditVetoed) {
				notice(
					`Cancelled: ${describeOp(op)}.`,
					`${name} vetoed by the writer`,
				);
				return `The writer cancelled that edit during the reveal. Don't retry it — ask how they'd like to proceed.`;
			}
			notice(
				`Your partner couldn't apply an edit to the document.`,
				`${name} failed: ${(e as Error).message}`,
			);
			return `Could not apply that: ${(e as Error).message} Re-\`view\` and check the paragraph numbers, then try again.`;
		}
		clearNotice();
		opts.onTool?.(`${name} applied`);
		// Hand back a window around the change so the model tracks any shifts.
		return appliedReport(await editor.getParagraphs(), op);
	};

	const live = await transport({
		instructions: VOICE_INSTRUCTIONS,
		greeting: GREETING_INSTRUCTIONS,
		tools: buildVoiceTools(dispatch),
		audioEl,
		onTranscript: opts.onTranscript,
		onStatus: opts.onStatus,
		onSpeechStart,
	});

	return {
		stop: async () => {
			await live.stop();
		},
		undo: undoLast,
	};
}
