/**
 * The voice tab's scratchpad panel: the writer's ideas in their own words, as
 * plain text with lightweight Markdown conventions — `#` heading = an idea,
 * `-` lines = related notes, `[[idea words]]` = a writer-owned link to another
 * heading, "quoted phrase" = an anchor into the document's wording.
 *
 * The conventions are rendering hints, not a data model: a per-line classifier
 * styles the read view (no Markdown parser), and clicking swaps to a plain
 * textarea so the writer's own typing path stays trivial. The agent's current
 * focus (`highlight` tool / the pre-edit reveal) is shown as a <mark> and
 * scrolled into view.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

/** `[[link]]` or a "quoted"/“quoted” anchor; everything else is plain text. */
const TOKEN = /(\[\[[^\]]+\]\]|"[^"]+"|“[^”]+”)/g;

export function VoiceScratchpad(props: {
	value: string;
	onChange: (v: string) => void;
	/** Phrase the agent is pointing at (null = no highlight). */
	highlight: string | null;
	/** A "quoted anchor" was clicked: point at that phrase in the document. */
	onQuoteClick?: (phrase: string) => void;
}) {
	const { value, onChange, highlight, onQuoteClick } = props;
	const [editing, setEditing] = useState(false);
	const markRef = useRef<HTMLElement | null>(null);
	const padRef = useRef<HTMLDivElement | null>(null);

	// Bring the agent's focus into view when it changes.
	useEffect(() => {
		if (highlight)
			markRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}, [highlight]);

	if (editing) {
		return (
			<textarea
				autoFocus
				style={S.textarea}
				value={value}
				placeholder={PLACEHOLDER}
				onChange={(e) => onChange(e.target.value)}
				onBlur={() => setEditing(false)}
			/>
		);
	}

	const lines = value.split('\n');

	/** Scroll the panel to the heading a [[link]] names (writer's words). */
	const jumpToHeading = (label: string) => {
		const needle = label.trim().toLowerCase();
		const idx = lines.findIndex(
			(l) => /^#+\s/.test(l) && l.toLowerCase().includes(needle),
		);
		const el = padRef.current?.querySelector(`[data-line="${idx}"]`);
		el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	};

	// Wrap the first occurrence of the agent's highlight in a <mark>. Best
	// effort: within one plain-text token (a phrase spanning tokens is skipped).
	let marked = false;
	const withHighlight = (text: string, key: string): ReactNode => {
		if (!highlight || marked) return text;
		const at = text.indexOf(highlight);
		if (at === -1) return text;
		marked = true;
		return (
			<span key={key}>
				{text.slice(0, at)}
				<mark
					ref={(el) => {
						markRef.current = el;
					}}
					style={S.mark}
				>
					{highlight}
				</mark>
				{text.slice(at + highlight.length)}
			</span>
		);
	};

	const renderContent = (text: string, lineKey: number): ReactNode[] =>
		text.split(TOKEN).map((part, i) => {
			const key = `${lineKey}-${i}`;
			if (part.startsWith('[[') && part.endsWith(']]')) {
				const label = part.slice(2, -2);
				return (
					<button
						key={key}
						type="button"
						style={S.link}
						onClick={(e) => {
							e.stopPropagation();
							jumpToHeading(label);
						}}
					>
						{label}
					</button>
				);
			}
			if (/^["“]/.test(part) && /["”]$/.test(part)) {
				const phrase = part.slice(1, -1);
				return (
					<button
						key={key}
						type="button"
						style={S.quote}
						title="Show this in the document"
						onClick={(e) => {
							e.stopPropagation();
							onQuoteClick?.(phrase);
						}}
					>
						{part}
					</button>
				);
			}
			return <span key={key}>{withHighlight(part, key)}</span>;
		});

	return (
		<div
			ref={padRef}
			style={S.pad}
			title="Click to edit your scratchpad"
			onClick={() => setEditing(true)}
		>
			{value.trim().length === 0 ? (
				<div style={S.empty}>{PLACEHOLDER}</div>
			) : (
				lines.map((line, i) => {
					const heading = /^(#+)\s+(.*)$/.exec(line);
					if (heading) {
						return (
							<div
								key={i}
								data-line={i}
								style={S.heading(heading[1].length)}
							>
								{renderContent(heading[2], i)}
							</div>
						);
					}
					const bullet = /^[-*]\s+(.*)$/.exec(line);
					if (bullet) {
						return (
							<div key={i} data-line={i} style={S.bullet}>
								<span style={S.bulletDot}>•</span>
								<span>{renderContent(bullet[1], i)}</span>
							</div>
						);
					}
					return (
						<div key={i} data-line={i} style={S.plain}>
							{line.length > 0 ? renderContent(line, i) : ' '}
						</div>
					);
				})
			)}
		</div>
	);
}

const PLACEHOLDER =
	'Your words — a scratchpad you and the voice partner share. # starts an idea, - adds a related note, [[idea words]] links ideas, "quoted phrases" point into the document.';

const chipBase = {
	border: 'none',
	padding: '0 0.15rem',
	borderRadius: 4,
	cursor: 'pointer',
	font: 'inherit',
} as const;

const S = {
	pad: {
		flex: 1,
		minHeight: 0,
		overflowY: 'auto',
		padding: '0.6rem 0.75rem',
		fontSize: '0.85rem',
		lineHeight: 1.45,
		cursor: 'text',
		background: '#fffbeb',
		borderBottom: '1px solid #e5e7eb',
	} as const,
	textarea: {
		flex: 1,
		minHeight: 0,
		padding: '0.6rem 0.75rem',
		fontSize: '0.85rem',
		lineHeight: 1.45,
		fontFamily: 'inherit',
		border: 'none',
		outline: 'none',
		resize: 'none',
		background: '#fffbeb',
		borderBottom: '1px solid #e5e7eb',
	} as const,
	empty: { color: '#92700c', fontStyle: 'italic', opacity: 0.8 } as const,
	heading: (level: number) =>
		({
			fontWeight: 700,
			fontSize: level === 1 ? '0.95rem' : '0.85rem',
			margin: '0.4rem 0 0.15rem',
		}) as const,
	bullet: {
		display: 'flex',
		gap: '0.35rem',
		paddingLeft: '0.6rem',
	} as const,
	bulletDot: { color: '#b45309' } as const,
	plain: { margin: '0.1rem 0' } as const,
	mark: { background: '#fde68a', borderRadius: 3, padding: '0 2px' } as const,
	link: {
		...chipBase,
		background: '#e0e7ff',
		color: '#4338ca',
	} as const,
	quote: {
		...chipBase,
		background: 'transparent',
		color: '#92400e',
		textDecoration: 'underline dotted',
		padding: 0,
	} as const,
};
