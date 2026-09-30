/**
 * A tag the writer clicked, expanded into a suggestion card (paper §4.4,
 * "Inspiring"): the partner's acknowledgement and question, plus an optional
 * follow-up conversation.
 *
 * The suggestion is generated **here**, on open, not when the partner
 * activated. The paper generates eagerly so the tag can appear in under a
 * second while the suggestion is already being written; we have one model, so
 * eager generation would spend a call on every tag the writer ignores — and
 * our triggers are noisier than keystroke triggers, so that is most of them.
 * See challenge C5 in `docs/proactive-partners-reproduction.md`.
 *
 * The paper's third engagement form, "Executing" — the partner writing into
 * the document — is deliberately absent. See challenge C4.
 */
import { useEffect, useRef, useState } from 'react';
import { AiOutlineClose, AiOutlineSend } from 'react-icons/ai';
import {
	describeGenerationError,
	type GenerationErrorInfo,
} from '@/api/errors';
import { generateFullText } from '@/api/generate';
import { languageModel, openaiProviderOptions } from '@/api/openai';
import { GenerationErrorNotice } from '@/components/errorNotice';
import {
	FOLLOW_UP_INSTRUCTIONS,
	followUpContext,
	generateSuggestion,
} from './engine';
import type { Activation, Partner, Suggestion } from './types';
import { TRIGGER_LABELS } from './types';
import classes from './styles.module.css';

export interface SuggestionCardProps {
	activation: Activation;
	partner: Partner;
	brief: string | null;
	onDismiss: () => void;
	onSuggestion: (suggestion: Suggestion, latencyMs: number) => void;
	onFollowUp: (message: string, turn: number) => void;
	onError: (stage: 'suggestion' | 'follow_up', error: unknown) => void;
}

export default function SuggestionCard({
	activation,
	partner,
	brief,
	onDismiss,
	onSuggestion,
	onFollowUp,
	onError,
}: SuggestionCardProps): React.JSX.Element {
	const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
	const [errorInfo, setErrorInfo] = useState<GenerationErrorInfo | null>(
		null,
	);
	const [thread, setThread] = useState<{ role: string; content: string }[]>(
		[],
	);
	const [draft, setDraft] = useState('');
	const [sending, setSending] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const controllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		controllerRef.current = controller;
		const startedAt = Date.now();
		setErrorInfo(null);
		generateSuggestion(
			partner,
			activation.snapshot,
			activation.activity,
			activation.trigger,
			brief,
			controller.signal,
		)
			.then((result) => {
				if (controller.signal.aborted) return;
				setSuggestion(result);
				onSuggestion(result, Date.now() - startedAt);
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				setErrorInfo(describeGenerationError(error));
				onError('suggestion', error);
			});
		return () => controller.abort();
		// `attempt` is the retry seam; the callbacks are not reactive inputs.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activation.id, attempt]);

	async function send(): Promise<void> {
		const message = draft.trim();
		if (!message || sending || !suggestion) return;
		setDraft('');
		const turn = thread.filter((m) => m.role === 'user').length + 1;
		const nextThread = [...thread, { role: 'user', content: message }];
		setThread(nextThread);
		setSending(true);
		onFollowUp(message, turn);
		try {
			const reply = await generateFullText({
				model: languageModel,
				instructions: FOLLOW_UP_INSTRUCTIONS,
				messages: [
					{
						role: 'user',
						content: followUpContext(
							partner,
							activation.snapshot,
							activation.trigger,
							suggestion,
							brief,
						),
					},
					...nextThread.map((m) => ({
						role: m.role as 'user' | 'assistant',
						content: m.content,
					})),
				],
				providerOptions: openaiProviderOptions,
			});
			setThread((current) => [
				...current,
				{ role: 'assistant', content: reply },
			]);
		} catch (error) {
			setErrorInfo(describeGenerationError(error));
			onError('follow_up', error);
		} finally {
			setSending(false);
		}
	}

	return (
		<article className={classes.card}>
			<header className={classes.cardHeader}>
				<span className={classes.cardPartner}>
					<span aria-hidden>{partner.emoji}</span> {partner.name}
				</span>
				<span className={classes.cardTrigger}>
					{TRIGGER_LABELS[activation.trigger].toLowerCase()}
				</span>
				<button
					type="button"
					className={classes.iconButton}
					aria-label="Dismiss suggestion"
					onClick={onDismiss}
				>
					<AiOutlineClose />
				</button>
			</header>

			{!suggestion && !errorInfo && (
				<p className={classes.thinking} role="status">
					{partner.name} is reading what you just wrote…
				</p>
			)}

			{errorInfo ? (
				<GenerationErrorNotice
					info={errorInfo}
					onRetry={() => setAttempt((n) => n + 1)}
				/>
			) : null}

			{suggestion ? (
				<div className={classes.suggestion}>
					{suggestion.acknowledgement ? (
						<p className={classes.acknowledgement}>
							{suggestion.acknowledgement}
						</p>
					) : null}
					<p className={classes.question}>{suggestion.question}</p>
				</div>
			) : null}

			{suggestion ? (
				<div className={classes.thread}>
					{thread.map((message, index) => (
						<p
							key={`${message.role}-${index}`}
							className={
								message.role === 'user'
									? classes.threadUser
									: classes.threadPartner
							}
						>
							{message.content}
						</p>
					))}
					{sending ? (
						<p className={classes.thinking} role="status">
							Thinking…
						</p>
					) : null}
					<div className={classes.composer}>
						<input
							className={classes.composerInput}
							value={draft}
							placeholder="Ask, or push back…"
							aria-label={`Reply to ${partner.name}`}
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') void send();
							}}
						/>
						<button
							type="button"
							className={classes.iconButton}
							aria-label="Send"
							disabled={sending || draft.trim() === ''}
							onClick={() => void send()}
						>
							<AiOutlineSend />
						</button>
					</div>
				</div>
			) : null}
		</article>
	);
}
