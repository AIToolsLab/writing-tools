import * as ReactDOM from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';

import { SERVER_URL } from '@/api';

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
			className="whitespace-pre-wrap"
			style={{ maxWidth }}
			title={displayText}
		>
			<summary className="truncate text-gray-500">{summaryText}</summary>
			<pre className="whitespace-pre-wrap">{displayText}</pre>
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
			? (data as {result: string}).result
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
			<div className="mb-2 flex items-center gap-2">
				<span className="font-semibold">Regenerate All:</span>
				<select
					className="border rounded px-2 py-1"
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
					className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition duration-150"
					onClick={handleRegenerateAll}
					disabled={annotatedEntries.length === 0}
				>
					Regenerate All
				</button>
			</div>
			<table className="max-w-full border border-gray-300">
				<thead>
					<tr>
						<th className="p-2">Timestamp</th>
						<th className="p-2">Event</th>
						<th className="p-2">Type</th>
						<th className="p-2">Prompt</th>
						<th className="p-2">Result</th>
						<th className="p-2">Regen</th>
					</tr>
				</thead>
				<tbody>
					{annotatedEntries.map(
						(entry: LogWithAnnotatedTimestamp, i: number) => (
							<tr key={i}>
								<td className="p-2">
									{secondsToHMS(entry.secondsSinceStart)}
								</td>
								<td className="p-2">
									{entry.event}
									{entry.interaction ? ` (${entry.interaction})` : null}
								</td>
								<td className="p-2">{entry.generation_type}</td>
								<td className="p-2">
									<Collapsible
										text={entry.prompt}
										truncateEnd={false}
									/>
								</td>
								<td className="p-2">
									<Collapsible text={entry.result} />
								</td>
								<td className="p-2">
									{regenResults[i] === null && (
										<div className="text-blue-500">
											Regenerating...
										</div>
									)}
									{regenResults[i] ? <div className="mb-2 p-2 bg-gray-100 rounded text-sm text-gray-800 whitespace-pre-wrap">
											{regenResults[i]}
										</div> : null}
									<button
										className="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition duration-150"
										onClick={async () => {
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
												result = (err as Error).message;
											}
											setRegenResults((prev) => ({
												...prev,
												[i]: result,
											}));
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
					const updates = await resp.json() as Array<{ logs: Log[] }>;
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
				pollingRef.current = setTimeout(pollLogs, 2000);
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
			.sort((a, b) => (b[1]) - (a[1]))
			.map(([k, v]) => ({ generationType: k, count: v }));
	}, [desiredEntries]);

	return (
		<div
			className={`p-6 relative ${dragActive ? 'bg-blue-50 border-2 border-blue-400' : ''}`}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			style={{ minHeight: 400 }}
		>
			{dragActive ? <div className="absolute inset-0 flex items-center justify-center bg-blue-100 bg-opacity-80 z-10 border-2 border-blue-400 rounded">
					<span className="text-lg font-bold text-blue-700">
						Drop a log file to view it
					</span>
				</div> : null}
			{dragError ? <div className="mb-4 text-red-600">{dragError}</div> : null}
			<div className="mb-4">
				<label className="flex items-center gap-2">
					Log Secret:
					<input
						type="text"
						value={logSecret}
						onChange={(e) => {
							setLogSecret(e.target.value);
							localStorage.setItem('logSecret', e.target.value);
						}}
						placeholder="Enter log secret"
						className="px-3 py-2 border border-gray-300 rounded transition duration-150 cursor-pointer focus:cursor-text focus:outline-none focus:border-black hover:border-black"
						disabled={fileMode}
					/>
				</label>
				{fileMode ? <span className="ml-4 text-sm text-blue-700">
						Viewing logs from file. Drag a new file to replace, or
						reload to return to server mode.
					</span> : null}
			</div>
			<div className="mb-4 flex items-center gap-6">
				<label className="flex items-center gap-2">
					Username:
					<input
						list="usernames"
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						placeholder="Select or type username"
						className="px-3 py-2 border border-gray-300 rounded transition duration-150 cursor-pointer focus:cursor-text focus:outline-none focus:border-black hover:border-black"
					/>
					<datalist id="usernames">
						{availableUsernames.map((u) => (
							<option key={u} value={u} />
						))}
					</datalist>
				</label>
			</div>
			<div className="mb-4">
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
			<div className="mb-4">
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

ReactDOM.render(<App />, document.getElementById('container'));

// Add styles for collapsible
