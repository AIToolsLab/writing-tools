import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useRef, useState } from 'react';

import { SERVER_URL } from '@/api';
import classes from './styles.module.css';

interface Log {
	username: string;
	event: string;
	interaction?: string;
	prompt: string;
	result: string;
	completion: string;
	timestamp: number;
	isBackend: boolean;
	generation_type?: string;
	currentDocumentState?: any;
}

interface LogWithAnnotatedTimestamp extends Log {
	secondsSinceLast: number;
	secondsSinceStart: number;
}

// Collapsible component for prompt/result/completion
function Collapsible({
	text,
	maxWidth = 75,
	truncateEnd = true,
}: {
	text: unknown;
	maxWidth?: number;
	truncateEnd?: boolean;
}) {
	// If text is an object, render as JSON
	let displayText: string;
	if (typeof text === 'object' && text !== null) {
		displayText = JSON.stringify(text, null, 2);
	} else {
		if (text == null) {
			displayText = '';
		} else if (typeof text === 'string') {
			displayText = text;
		} else if (typeof text === 'number' || typeof text === 'boolean') {
			displayText = String(text);
		} else {
			displayText = JSON.stringify(text);
		}
	}

	let summaryText = displayText;
	if (displayText.length > maxWidth) {
		if (truncateEnd) {
			summaryText = displayText.slice(0, maxWidth - 3) + '…';
		} else {
			summaryText =
				'…' + displayText.slice(displayText.length - maxWidth + 3);
		}
	}

	return (
		<details
			className={classes.collapsible}
			style={{ maxWidth }}
			title={displayText}
		>
			<summary className={classes.summary}>{summaryText}</summary>
			<pre className={classes.pre}>{displayText}</pre>
		</details>
	);
}

function secondsToHMS(seconds: number) {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	const pad = (x: number) => x.toString().padStart(2, '0');
	return `${pad(m)}m${pad(s)}`;
}

function EntriesTable({ entries }: { entries: Log[] }) {
	let lastTimestamp: number | null = null;
	let lastDocContext: any = null;
	const annotatedEntries = entries
		.map((entry) => {
			const newEntry = { ...entry } as LogWithAnnotatedTimestamp;
			if (lastTimestamp !== null) {
				newEntry.secondsSinceLast = entry.timestamp - lastTimestamp;
			}
			newEntry.secondsSinceStart = entry.timestamp - entries[0].timestamp;
			lastTimestamp = entry.timestamp;
			if (entry.currentDocumentState) {
				lastDocContext = entry.currentDocumentState;
			} else {
				newEntry.currentDocumentState = lastDocContext;
			}
			return newEntry;
		})
		.filter((x) => x.event === 'suggestion_generated');

	// Regenerations are tracked by index. null means requested but not yet completed (loading)
	const [regenResults, setRegenResults] = useState<
		Record<number, string | null>
	>({});

	// Which type of generation to regenerate
	const uniqueGenerationTypes = [
		'example_sentences',
		'analysis_describe',
		'proposal_advice',
	];
	const [regenType, setRegenType] = useState<string>(
		uniqueGenerationTypes[0],
	);

	const regenerateSuggestion = async (gtype: string, docContext: any) => {
		const resp = await fetch('/api/get_suggestion', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: 'regenerate',
				gtype,

				doc_context: docContext,
			}),
		});
		if (!resp.ok) throw new Error(`Error: ${resp.status}`);
		const data = await resp.json();
		return data && typeof data === 'object' && 'result' in data
			? (data as { result: string }).result
			: JSON.stringify(data, null, 2);
	};

	// Regenerate all handler
	const handleRegenerateAll = async () => {
		const indices = annotatedEntries
			.map((entry, idx) => ({ entry, idx }))
			.map(({ idx }) => idx);
		// Set all to loading (null) first
		const loadingResults: Record<number, string | null> = {};
		for (const i of indices) {
			loadingResults[i] = null;
		}
		setRegenResults(loadingResults);
		await Promise.all(
			indices.map(async (i) => {
				const entry = annotatedEntries[i];
				let result: string;
				try {
					result = await regenerateSuggestion(
						regenType,
						entry.currentDocumentState,
					);
				} catch (err) {
					result = (err as Error).message;
				}
				setRegenResults((prev) => {
					const updated = { ...prev };
					updated[i] = result;
					return updated;
				});
			}),
		);
	};

	return (
		<div>
			<div className={classes.regenRow}>
				<span className={classes.regenLabel}>Regenerate All:</span>
				<select
					className={classes.select}
					value={regenType}
					onChange={(e) => setRegenType(e.target.value)}
				>
					{uniqueGenerationTypes.map((type) => (
						<option key={type} value={type}>
							{type}
						</option>
					))}
				</select>
				<button
					className={classes.btnGreen}
					onClick={() => {
						void handleRegenerateAll();
					}}
					disabled={annotatedEntries.length === 0}
				>
					Regenerate All
				</button>
			</div>
			<table className={classes.table}>
				<thead>
					<tr>
						<th className={classes.cell}>Timestamp</th>
						<th className={classes.cell}>Event</th>
						<th className={classes.cell}>Type</th>
						<th className={classes.cell}>Prompt</th>
						<th className={classes.cell}>Result</th>
						<th className={classes.cell}>Regen</th>
					</tr>
				</thead>
				<tbody>
					{annotatedEntries.map(
						(entry: LogWithAnnotatedTimestamp, i: number) => (
							<tr key={i}>
								<td className={classes.cell}>
									{secondsToHMS(entry.secondsSinceStart)}
								</td>
								<td className={classes.cell}>
									{entry.event}
									{entry.interaction
										? ` (${entry.interaction})`
										: null}
								</td>
								<td className={classes.cell}>
									{entry.generation_type}
								</td>
								<td className={classes.cell}>
									<Collapsible
										text={entry.prompt}
										truncateEnd={false}
									/>
								</td>
								<td className={classes.cell}>
									<Collapsible text={entry.result} />
								</td>
								<td className={classes.cell}>
									{regenResults[i] === null && (
										<div className={classes.textBlue}>
											Regenerating...
										</div>
									)}
									{regenResults[i] ? (
										<div className={classes.regenResult}>
											{regenResults[i]}
										</div>
									) : null}
									<button
										className={classes.btnBlue}
										onClick={() => {
											void (async () => {
												setRegenResults((prev) => ({
													...prev,
													[i]: null,
												}));
												let result: string;
												try {
													result =
														await regenerateSuggestion(
															regenType,
															entry.currentDocumentState,
														);
												} catch (err) {
													result = (err as Error)
														.message;
												}
												setRegenResults((prev) => ({
													...prev,
													[i]: result,
												}));
											})();
										}}
										disabled={regenResults[i] === null}
									>
										Regenerate
									</button>
								</td>
							</tr>
						),
					)}
				</tbody>
			</table>
		</div>
	);
}

function App() {
	const [logs, setLogs] = useState<Log[]>([]);
	const [username, setUsername] = useState('');
	const [logSecret, setLogSecret] = useState<string>(
		() => localStorage.getItem('logSecret') || '',
	);
	const logsRef = useRef<Log[]>([]);
	const pollingRef = useRef<NodeJS.Timeout | null>(null);
	const [dragActive, setDragActive] = useState(false);
	const [dragError, setDragError] = useState<string | null>(null);
	const [fileMode, setFileMode] = useState(false);

	// Helper: get log counts per username
	const getLogCounts = (logs: Log[]) => {
		const counts: Record<string, number> = {};
		for (const log of logs) {
			counts[log.username] = (counts[log.username] || 0) + 1;
		}
		return counts;
	};

	// Helper: parse a log object (normalize timestamp, isBackend)
	const parseLog = (x: unknown): Log => {
		const logData = x as Record<string, unknown>;
		const ts =
			typeof logData.timestamp === 'string'
				? new Date(logData.timestamp).getTime() / 1000
				: (logData.timestamp as number);
		const isBackend = [
			'suggestion_generated',
			'reflection_generated',
			'reflection_generated',
		].includes(logData.event as string);
		return { ...logData, timestamp: ts, isBackend } as Log;
	};

	// Helper: parse a JSONL string into Log[]
	const parseLogFile = (text: string): Log[] => {
		const lines = text.split(/\r?\n/).filter(Boolean);
		return lines.map((line) => parseLog(JSON.parse(line)));
	};

	// Poll logs from server (disabled if fileMode)
	useEffect(() => {
		if (!logSecret || fileMode) return;
		let stopped = false;
		async function pollLogs() {
			if (stopped) return;
			const logCounts = getLogCounts(logsRef.current);
			try {
				const resp = await fetch(`${SERVER_URL}/logs_poll`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},

					body: JSON.stringify({
						log_positions: logCounts,
						secret: logSecret,
					}),
				});
				if (resp.ok) {
					const updates = (await resp.json()) as Array<{
						logs: Log[];
					}>;
					const newLogs: Log[] = updates
						.map((log: { logs: Log[] }) => log.logs)
						.flat()
						.map(parseLog);
					// Just append new logs (no deduplication)
					const allLogs = [...logsRef.current, ...newLogs];
					logsRef.current = allLogs;
					setLogs(allLogs);
				}
			} catch (_e) {
				// Optionally handle error
			}
			if (!stopped) {
				pollingRef.current = setTimeout(() => {
					void pollLogs();
				}, 2000);
			}
		}
		pollLogs();
		return () => {
			stopped = true;
			if (pollingRef.current) clearTimeout(pollingRef.current);
		};
	}, [logSecret, fileMode]);

	// Drag and drop file handler
	const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		setDragActive(true);
	};
	const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		setDragActive(false);
	};
	const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		setDragActive(false);
		setDragError(null);
		const file = e.dataTransfer.files[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (event) => {
			try {
				// Try to parse as JSONL (one JSON per line)
				const text = event.target?.result as string;
				const parsed: Log[] = parseLogFile(text);
				setLogs(parsed);
				logsRef.current = parsed;
				setFileMode(true);
			} catch (err) {
				setDragError('Failed to parse file: ' + (err as Error).message);
			}
		};
		reader.readAsText(file);
	};
	// Username datalist
	const availableUsernames = useMemo(() => {
		return Array.from(new Set(logs.map((x) => x.username))).sort();
	}, [logs]);

	// Filtered logs
	const desiredEntries = useMemo(() => {
		return logs.filter((x) => !username || x.username === username);
	}, [logs, username]);

	// Generation type counts
	const generationTypeCounts = useMemo(() => {
		return Object.entries(
			desiredEntries.reduce(
				(acc: Record<string, number>, x) => {
					if (x.isBackend && x.generation_type) {
						acc[x.generation_type] =
							(acc[x.generation_type] || 0) + 1;
					}
					return acc;
				},
				{} as Record<string, number>,
			),
		)
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => ({ generationType: k, count: v }));
	}, [desiredEntries]);

	return (
		<div
			className={`${classes.page} ${dragActive ? classes.dragActive : ''}`}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			style={{ minHeight: 400 }}
		>
			{dragActive ? (
				<div className={classes.dropOverlay}>
					<span className={classes.dropText}>
						Drop a log file to view it
					</span>
				</div>
			) : null}
			{dragError ? (
				<div className={classes.dragError}>{dragError}</div>
			) : null}
			<div className={classes.block}>
				<label className={classes.fieldLabel}>
					Log Secret:
					<input
						type="text"
						value={logSecret}
						onChange={(e) => {
							setLogSecret(e.target.value);
							localStorage.setItem('logSecret', e.target.value);
						}}
						placeholder="Enter log secret"
						className={classes.textInput}
						disabled={fileMode}
					/>
				</label>
				{fileMode ? (
					<span className={classes.fileModeNote}>
						Viewing logs from file. Drag a new file to replace, or
						reload to return to server mode.
					</span>
				) : null}
			</div>
			<div className={classes.rowGap}>
				<label className={classes.fieldLabel}>
					Username:
					<input
						list="usernames"
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						placeholder="Select or type username"
						className={classes.textInput}
					/>
					<datalist id="usernames">
						{availableUsernames.map((u) => (
							<option key={u} value={u} />
						))}
					</datalist>
				</label>
			</div>
			<div className={classes.block}>
				<strong>{desiredEntries.length}</strong> entries selected of{' '}
				<strong>{logs.length}</strong> total entries.
				<br />
				Last entry:{' '}
				{desiredEntries.length > 0
					? new Date(
							desiredEntries[desiredEntries.length - 1]
								.timestamp * 1000,
						).toLocaleString()
					: 'No entries'}
			</div>
			<div className={classes.block}>
				<strong>Generation Type Counts:</strong>
				<ul>
					{generationTypeCounts.map(
						({
							generationType,
							count,
						}: {
							generationType: string;
							count: number;
						}) => (
							<li key={generationType}>
								{generationType}: {count}
							</li>
						),
					)}
				</ul>
			</div>
			<EntriesTable entries={desiredEntries} />
		</div>
	);
}

createRoot(document.getElementById('container')!).render(<App />);

// Add styles for collapsible
