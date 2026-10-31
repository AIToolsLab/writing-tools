import { isStepCount, type ModelMessage } from 'ai';
import {
	useCallback,
	useContext,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from 'react';
import {
	AiOutlineArrowDown,
	AiOutlinePlus,
	AiOutlineSend,
} from 'react-icons/ai';

import {
	describeGenerationError,
	type GenerationErrorInfo,
} from '@/api/errors';
import { streamParts } from '@/api/generate';
import { chatLog } from '@/api/logging';
import { languageModel, openaiProviderOptions } from '@/api/openai';
import { GenerationErrorNotice } from '@/components/errorNotice';
import BriefSection from '@/components/briefSection';
import {
	DocJumpStatus,
	DocTextMarkdown,
	jumpToDocText,
	useDocJump,
} from '@/components/docTextLink';
import { ChatContext, recordSeen } from '@/contexts/chatContext';
import {
	formatDocBriefForPrompt,
	useDocBrief,
} from '@/contexts/docBriefContext';
import { EditorContext } from '@/contexts/editorContext';
import { canEdit } from '@/docTools/editor';
import { isEditToolName, toEditOp } from '@/docTools/editTools';
import { previewOpChanges, type ChangePreview } from '@/docTools/preview';
import { locateProposal } from '@/docTools/report';
import { undoEdit } from '@/docTools/undo';
import { useLog } from '@/hooks/useLog';
import { useDocContext } from '@/utilities';

import { chatTools } from './chatTools';
import { ProposalCard } from './ProposalCard';
import classes from './styles.module.css';
import {
	answerProposal,
	DECLINED_REASON,
	displayTranscript,
	documentContext,
	pendingProposals,
	setAsideReason,
	writerTurn,
	type ProposalItem,
} from './transcript';

const suggestionPrompts = [
	'What is my main argument?',
	'How can I improve clarity?',
	'Is my structure logical?',
	'What am I missing?',
];

/**
 * The chat's system prompt. It is passed as the `instructions` option on the
 * generation call and deliberately kept *out* of the transcript: ai@7 rejects a
 * system-role message inside `messages` with "System messages are not allowed
 * in the prompt or messages fields."
 */
const CHAT_INSTRUCTIONS = `\
Help the user improve their writing. Encourage the user towards critical thinking and self-reflection. Be concise.

Each of the user's messages starts with a <document_context> block that the app attaches; the user doesn't see it and didn't write it. On their first message it holds the whole document, with paragraphs numbered like [3]; on every message it shows the text around their cursor or selection, marked with <<CURSOR>> or <<SELECTION>> tags. If the user mentions "here" or "this", assume they mean that area. When the user has changed the document since you last saw it, the block says what changed; call \`view\` when you need the whole current text. The paragraph numbers are for your tools; the user doesn't see them, so mentioning them might confuse the user.

When referring to a specific part of the document, link to it so the user can jump straight there, using a Markdown link whose target is a doctext URL: [second paragraph of the intro](doctext:A%20short%20quote). The link target must start with "doctext:" and be a URL-component-encoded verbatim quote from the document — from a single line, at most 240 characters, with no surrounding quotation marks or paragraph numbers. The link text should be a short description of the place, not the quote itself. Only link to text that is actually in the document; quote it exactly.`;

/** Added to the instructions where the host can apply edits. */
const EDIT_INSTRUCTIONS = `\
You can also propose small edits to the document with \`str_replace\`, \`insert\`, and \`move\`. The user sees each proposal and accepts or declines it; the app rejects any that adds words that aren't the user's own. Mostly, coach: ask, reflect, point at passages. Propose an edit when the user asks for one, or when the improvement is only rearranging or trimming their own words. Propose one edit at a time, and say in a sentence why. If the user declines or sets one aside, don't propose it again; go back to talking it through.`;

/** Runaway cap on model steps (each tool call is a step) per writer turn. */
const MAX_STEPS = 6;

export default function Chat() {
	const {
		chatMessages,
		updateChatMessages,
		docState,
		appliedEdits,
		setAppliedEdits,
	} = useContext(ChatContext);
	const editorAPI = useContext(EditorContext);
	const { brief } = useDocBrief();
	const log = useLog();
	// Read at send time, like the document context is, so a brief the writer
	// just edited applies to the very next message.
	const briefRef = useRef(brief);
	briefRef.current = brief;
	// The transcript as of now, for tool calls that run mid-stream.
	const messagesRef = useRef(chatMessages);
	messagesRef.current = chatMessages;
	const activeRequestControllerRef = useRef<AbortController | null>(null);
	const messagesContainerRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [showScrollButton, setShowScrollButton] = useState(false);
	const [errorInfo, setErrorInfo] = useState<GenerationErrorInfo | null>(
		null,
	);
	/**
	 * The message of a failed turn that was rolled back out of the transcript.
	 * Only such a turn can be retried — retrying one still in the transcript
	 * would send it twice.
	 */
	const [failedMessage, setFailedMessage] = useState<{
		text: string;
		source: 'input' | 'suggested';
	} | null>(null);
	/** Why an Undo was refused, by the proposal's tool call. */
	const [undoErrors, setUndoErrors] = useState<Record<string, string>>({});

	// Show the "scroll to bottom" button when the user scrolls up, and hide it when they are near the bottom.
	const handleScroll = useCallback(() => {
		const container = messagesContainerRef.current;
		if (!container) return;
		const isNearBottom =
			container.scrollHeight -
				container.scrollTop -
				container.clientHeight <
			100;
		setShowScrollButton(!isNearBottom);
	}, []);

	// Instantly jumps the chat to the bottom upon user clicking the "scroll to bottom" button.
	const scrollToBottom = useCallback(() => {
		const container = messagesContainerRef.current;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
	}, []);

	// Auto-scroll when new messages arrive. `showScrollButton` is read but must stay
	// non-reactive — a scroll should fire on new messages, not when the button toggles.
	// useEffectEvent keeps that read out of the dependency array, so the effect runs
	// only on chatMessages and no exhaustive-deps suppression is needed.
	const scrollOnNewMessages = useEffectEvent(() => {
		if (!showScrollButton) {
			messagesContainerRef.current?.scrollTo({
				top: messagesContainerRef.current.scrollHeight,
				behavior: 'smooth',
			});
		}
	});

	useEffect(() => {
		scrollOnNewMessages();
	}, [chatMessages]);

	const { refresh: refreshDocContext } = useDocContext(editorAPI);
	const docJump = useDocJump('chat');

	const [isSendingMessage, updateSendingMessage] = useState(false);

	const [message, updateMessage] = useState('');

	/**
	 * The reply streaming in, shown as a bubble after the transcript until the
	 * turn finishes and its messages join the transcript. Null when idle.
	 */
	const [streamingText, setStreamingText] = useState<string | null>(null);

	const visibleMessages = displayTranscript(chatMessages);
	if (streamingText !== null) {
		visibleMessages.push({ role: 'assistant', text: streamingText });
	}

	/**
	 * Previews of the proposal awaiting the writer, against the document as it
	 * is when the proposal arrives. Keyed by tool call so a stale preview is
	 * never shown on a newer card.
	 */
	const [pendingPreview, setPendingPreview] = useState<{
		toolCallId: string;
		previews: ChangePreview[] | null;
	} | null>(null);
	const pending = pendingProposals(chatMessages)[0] as
		| ProposalItem
		| undefined;
	const pendingId = pending?.toolCallId;
	const showPending = useEffectEvent(async (proposal: ProposalItem) => {
		if (!isEditToolName(proposal.toolName)) return;
		const op = toEditOp(proposal.toolName, proposal.input);
		let previews: ChangePreview[] | null = null;
		try {
			previews = previewOpChanges(await editorAPI.getParagraphs(), op);
		} catch {
			// The writer changed the text since the proposal was checked; the
			// card still shows the summary, and Accept reports the failure.
		}
		setPendingPreview({ toolCallId: proposal.toolCallId, previews });
		// Deliberately not selecting the target here: the writer may be typing
		// in the document, and a selection that appears under them gets
		// overwritten by the next keystroke. The card's "Show in document" does
		// it on request.
	});
	useEffect(() => {
		if (pending) void showPending(pending);
		// Only when a different proposal starts waiting.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pendingId]);

	const resizeTextarea = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
	}, []);

	useEffect(() => {
		resizeTextarea();
	}, [message, resizeTextarea]);

	useEffect(() => {
		return () => {
			// Cleanup on unmount: stop any in-flight stream to avoid post-unmount updates.
			activeRequestControllerRef.current?.abort();
		};
	}, []);

	/**
	 * Run the model on `messages` (which end with whatever it should respond
	 * to: a writer turn, or the answer to a proposal) and add its reply to the
	 * transcript. `rollback` runs if it fails before saying anything.
	 */
	async function runModel(messages: ModelMessage[], rollback: () => void) {
		// Only one active request is allowed; cancel any previous stream first.
		activeRequestControllerRef.current?.abort();
		const requestController = new AbortController();
		activeRequestControllerRef.current = requestController;

		updateSendingMessage(true);
		setErrorInfo(null);
		setFailedMessage(null);
		updateChatMessages(messages);
		messagesRef.current = messages;
		setStreamingText('');
		setShowScrollButton(false);

		const editing = canEdit(editorAPI);
		const { tools, toolApproval } = makeTools();
		let streamed = '';
		try {
			const parts = streamParts({
				model: languageModel,
				providerOptions: {
					openai: {
						...openaiProviderOptions.openai,
						// One proposal at a time.
						parallelToolCalls: false,
					},
				},
				instructions: editing
					? `${CHAT_INSTRUCTIONS}\n\n${EDIT_INSTRUCTIONS}`
					: CHAT_INSTRUCTIONS,
				messages,
				tools,
				toolApproval,
				stopWhen: isStepCount(MAX_STEPS),
				abortSignal: requestController.signal,
			});

			let next = await parts.next();
			while (!next.done) {
				const part = next.value;
				if (part.type === 'text-delta') {
					streamed += part.text;
					setStreamingText(streamed);
				} else if (part.type === 'text-start' && streamed !== '') {
					// A new text block after a tool call: keep it a paragraph apart,
					// as the finished transcript renders it.
					streamed += '\n\n';
				}
				next = await parts.next();
			}
			if (requestController.signal.aborted) return;
			updateChatMessages([...messages, ...next.value]);
			chatLog.responseCompleted(log, {
				responseLength: streamed.length,
			});
		} catch (error) {
			if (requestController.signal.aborted) {
				return;
			}
			const info = describeGenerationError(error);
			console.error('Error while streaming chat response:', error);
			// Nothing streamed: roll back. If part of a reply did arrive, keep it
			// and just show the error under it.
			if (streamed.trim() === '') {
				rollback();
			} else {
				updateChatMessages([
					...messages,
					{ role: 'assistant', content: streamed },
				]);
			}
			setErrorInfo(info);
			chatLog.responseError(log, {
				error: info.detail,
				code: info.code,
			});
		} finally {
			// Ignore stale completions from older requests that were already replaced.
			if (activeRequestControllerRef.current === requestController) {
				activeRequestControllerRef.current = null;
				updateSendingMessage(false);
				setStreamingText(null);
			}
		}
	}

	function makeTools() {
		return chatTools({
			editor: editorAPI,
			docState,
			briefText: () => Object.values(briefRef.current),
			messages: () => messagesRef.current,
			onApplied: (toolCallId, edit) =>
				setAppliedEdits((prev) => ({ ...prev, [toolCallId]: edit })),
			log,
		});
	}

	function logEdit(
		outcome: Parameters<typeof chatLog.edit>[1],
		proposal: ProposalItem,
	) {
		if (!isEditToolName(proposal.toolName)) return;
		const op = toEditOp(proposal.toolName, proposal.input);
		void chatLog.edit(log, outcome, {
			tool: proposal.toolName,
			kind: op.kind,
			toolCallId: proposal.toolCallId,
			proposal: op,
		});
	}

	async function submitMessage(text: string, source: 'input' | 'suggested') {
		chatLog.messageSent(log, { message: text, source });
		updateMessage('');

		// A proposal still open when the writer moves on is set aside: it gets
		// its answer before their turn, so the model knows what happened to it.
		let base = chatMessages;
		for (const proposal of pendingProposals(chatMessages)) {
			base = [
				...base,
				answerProposal(proposal, {
					approved: false,
					reason: setAsideReason(text),
				}),
			];
			logEdit('set_aside', proposal);
		}

		// Pull the current document context at send time. The first turn also
		// carries the whole document, numbered as `view` numbers it; later ones
		// a note of what the writer changed since the model last saw it.
		const docContext = await refreshDocContext();
		const paragraphs = await editorAPI.getParagraphs();
		const previousBaseline = docState.baseline;
		const context = documentContext({
			docContext,
			brief: formatDocBriefForPrompt(briefRef.current),
			paragraphs,
			baseline: chatMessages.length === 0 ? null : previousBaseline,
		});
		recordSeen(docState, paragraphs);

		await runModel([...base, writerTurn(context, text)], () => {
			// Hand the text back to the input box, so Retry re-sends it once
			// rather than duplicating the turn.
			updateChatMessages(chatMessages);
			// The model never saw this turn's context either.
			docState.baseline = previousBaseline;
			updateMessage(text);
			setFailedMessage({ text, source });
		});
	}

	async function acceptProposal(proposal: ProposalItem) {
		logEdit('accepted', proposal);
		updateSendingMessage(true);
		const result = await makeTools().applyProposal(
			proposal.toolCallId,
			proposal.toolName,
			proposal.input,
		);
		const answered = [
			...chatMessages,
			answerProposal(proposal, { approved: true, ...result }),
		];
		// The edit stands even if the model's follow-up fails.
		await runModel(answered, () => updateChatMessages(answered));
	}

	async function declineProposal(proposal: ProposalItem) {
		logEdit('declined', proposal);
		const answered = [
			...chatMessages,
			answerProposal(proposal, {
				approved: false,
				reason: DECLINED_REASON,
			}),
		];
		await runModel(answered, () => updateChatMessages(answered));
	}

	/** Select where a proposal would land; false if it can't be found. */
	async function showProposalInDoc(proposal: ProposalItem): Promise<boolean> {
		if (!isEditToolName(proposal.toolName)) return false;
		const op = toEditOp(proposal.toolName, proposal.input);
		const { highlight } = await locateProposal(editorAPI, op);
		if (!highlight) return false;
		// Trims the quote until it's found: Word's search rejects long strings.
		const { found } = await jumpToDocText(
			(phrase) => editorAPI.selectPhrase(phrase),
			highlight,
		);
		return found;
	}

	async function undoProposal(proposal: ProposalItem) {
		const applied = appliedEdits[proposal.toolCallId];
		if (!applied || applied.undone || !canEdit(editorAPI)) return;
		try {
			await undoEdit(editorAPI, applied.undo);
		} catch (e) {
			logEdit('undo_refused', proposal);
			setUndoErrors((prev) => ({
				...prev,
				[proposal.toolCallId]: (e as Error).message,
			}));
			return;
		}
		// Not recorded as seen: to the model, an undo is the writer's change,
		// and the next edit note reports it.
		logEdit('undone', proposal);
		setAppliedEdits((prev) => ({
			...prev,
			[proposal.toolCallId]: { ...applied, undone: true },
		}));
	}

	function startNewConversation() {
		activeRequestControllerRef.current?.abort();
		activeRequestControllerRef.current = null;
		updateSendingMessage(false);
		setStreamingText(null);
		setErrorInfo(null);
		setFailedMessage(null);
		updateMessage('');
		updateChatMessages([]);
		docState.baseline = null;
		docState.seen.clear();
		setAppliedEdits({});
		setUndoErrors({});
		chatLog.conversationReset(log);
	}

	async function sendMessage(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();

		const trimmedMessage = message.trim();
		if (!trimmedMessage) return;

		await submitMessage(trimmedMessage, 'input');
	}

	async function sendSuggestedMessage(text: string) {
		updateMessage(text);
		await submitMessage(text, 'suggested');
	}

	return (
		<div className={classes.app}>
			{/* The document's brief — same section as on Revise, same stored
			    values; collapsed here so it costs one line above the transcript. */}
			<div className={classes.briefBar}>
				<BriefSection page="chat" />
			</div>

			<div className={classes.chatPanel}>
				{/* In the DOM before any link is clicked — a live region added
				    at the same moment as its text is not reliably announced. */}
				<DocJumpStatus jump={docJump} />

				{visibleMessages.length > 0 ? (
					<div className={classes.chatToolbar}>
						<button
							type="button"
							title="Start a new conversation"
							onClick={startNewConversation}
							className={classes.newConversationBtn}
						>
							<AiOutlinePlus size={12} />
							New conversation
						</button>
					</div>
				) : null}

				<div
					ref={messagesContainerRef}
					onScroll={handleScroll}
					className={classes.chatBody}
				>
					{visibleMessages.length === 0 ? (
						<div className={classes.chatWelcome}>
							<div className={classes.chatWelcomeTitle}>
								What do you think about your document so far?
							</div>

							<div className={classes.chatSuggestions}>
								{suggestionPrompts.map((prompt) => (
									<button
										key={prompt}
										type="button"
										onClick={() => {
											void sendSuggestedMessage(prompt);
										}}
										className={classes.chatSuggChip}
									>
										{prompt}
									</button>
								))}
							</div>
						</div>
					) : (
						visibleMessages.map((chatMessage, index) => {
							if (chatMessage.role === 'proposal') {
								return (
									<ProposalCard
										key={chatMessage.toolCallId}
										proposal={chatMessage}
										previews={
											pendingPreview?.toolCallId ===
											chatMessage.toolCallId
												? pendingPreview.previews
												: null
										}
										applied={
											appliedEdits[chatMessage.toolCallId]
										}
										undoError={
											undoErrors[chatMessage.toolCallId]
										}
										busy={isSendingMessage}
										onAccept={() =>
											void acceptProposal(chatMessage)
										}
										onDecline={() =>
											void declineProposal(chatMessage)
										}
										onUndo={() =>
											void undoProposal(chatMessage)
										}
										onShow={() =>
											showProposalInDoc(chatMessage)
										}
									/>
								);
							}
							const isAssistantTyping =
								chatMessage.role === 'assistant' &&
								chatMessage.text === '' &&
								isSendingMessage;

							return (
								<div
									key={index}
									className={`${classes.chatMsg} ${chatMessage.role === 'user' ? classes.user : classes.ai}`}
								>
									{chatMessage.role === 'assistant' ? (
										<div className={classes.chatMeta}>
											Assistant
										</div>
									) : null}

									{isAssistantTyping ? (
										<div
											className={classes.typingIndicator}
										>
											<span />
											<span />
											<span />
										</div>
									) : (
										<div className={classes.chatBubble}>
											{chatMessage.role ===
											'assistant' ? (
												<DocTextMarkdown jump={docJump}>
													{chatMessage.text}
												</DocTextMarkdown>
											) : (
												chatMessage.text
											)}
										</div>
									)}

									{chatMessage.role === 'user' ? (
										<div className={classes.chatMeta}>
											You
										</div>
									) : null}
								</div>
							);
						})
					)}

					{errorInfo ? (
						<GenerationErrorNotice
							info={errorInfo}
							title="Couldn't get a reply"
							onRetry={
								failedMessage
									? () =>
											void submitMessage(
												failedMessage.text,
												failedMessage.source,
											)
									: undefined
							}
						/>
					) : null}
				</div>

				{showScrollButton ? (
					<button
						type="button"
						title="Scroll to bottom"
						onClick={scrollToBottom}
						className={classes.scrollButton}
					>
						<AiOutlineArrowDown size={16} />
					</button>
				) : null}
			</div>

			<form
				className={classes.chatFoot}
				onSubmit={(e) => {
					void sendMessage(e);
				}}
			>
				<div className={classes.chatInputRow}>
					<textarea
						ref={textareaRef}
						disabled={isSendingMessage}
						placeholder="Ask something about your document..."
						value={message}
						onChange={(e) => updateMessage(e.target.value)}
						onInput={resizeTextarea}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && !e.shiftKey) {
								e.preventDefault();
								e.currentTarget.form?.requestSubmit();
							}
						}}
						rows={1}
						className={classes.chatInput}
					/>

					<button
						type="submit"
						title="Send message"
						disabled={isSendingMessage || !message.trim()}
						className={classes.chatSendBtn}
					>
						<AiOutlineSend size={18} />
					</button>
				</div>
			</form>
		</div>
	);
}
