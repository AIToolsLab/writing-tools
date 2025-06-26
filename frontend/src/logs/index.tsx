import * as ReactDOM from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';

import { SERVER_URL } from '@/api';

interface Log {
    username: string;
    event: string;
    prompt: string;
    result: string;
    completion: string;
    timestamp: number;
    isBackend: boolean;
    generation_type?: string;
}

// Collapsible component for prompt/result/completion
function Collapsible({ text, maxWidth = 200 }: { text: any, maxWidth?: number }) {
    // If text is an object, render as JSON
    let displayText: string;
    if (typeof text === 'object' && text !== null) {
        displayText = JSON.stringify(text, null, 2);
    } else {
        displayText = String(text ?? '');
    }
    return (
        <details className="whitespace-pre-wrap" style={{ maxWidth }} title={displayText}>
            <summary className="truncate text-gray-500">{displayText.length > 100 ? displayText.slice(0, 100) + '…' : displayText}</summary>
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
    const annotatedEntries = entries.map((entry) => {
        const newEntry = { ...entry } as any;
        if (lastTimestamp !== null) {
            newEntry.secondsSinceLast = (entry.timestamp - lastTimestamp) / 1000;
        }
        newEntry.secondsSinceStart = (entry.timestamp - entries[0].timestamp) / 1000;
        lastTimestamp = entry.timestamp;
        return newEntry;
    }).reverse();

    return (
        <table className="max-w-full border border-gray-300">
            <thead>
                <tr>
                    <th className="p-2">Timestamp</th>
                    <th className="p-2">Event</th>
                    <th className="p-2">Prompt</th>
                    <th className="p-2">Result</th>
                    <th className="p-2">Completion</th>
                </tr>
            </thead>
            <tbody>
                {annotatedEntries.map((entry: any, i: number) => (
                    <tr key={i}>
                        <td className="p-2">{secondsToHMS(entry.secondsSinceStart)}</td>
                        <td className="p-2">{entry.event}{entry.interaction && ` (${entry.interaction})`}</td>
                        <td className="p-2"><Collapsible text={entry.prompt} /></td>
                        <td className="p-2"><Collapsible text={entry.result} /></td>
                        <td className="p-2"><Collapsible text={entry.completion} /></td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function App() {
    const [logs, setLogs] = useState<Log[]>([]);
    const [username, setUsername] = useState('');
    const [logSecret, setLogSecret] = useState<string>(() => localStorage.getItem('logSecret') || '');
    const logsRef = useRef<Log[]>([]);
    const pollingRef = useRef<NodeJS.Timeout | null>(null);

    // Helper: get log counts per username
    const getLogCounts = (logs: Log[]) => {
        const counts: Record<string, number> = {};
        for (const log of logs) {
            counts[log.username] = (counts[log.username] || 0) + 1;
        }
        return counts;
    };

    // Poll logs from server
    useEffect(() => {
        if (!logSecret) return;
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
                    // eslint-disable-next-line camelcase
                    body: JSON.stringify({ log_positions: logCounts, secret: logSecret }),
                });
                if (resp.ok) {
                    const updates = await resp.json();
                    let newLogs: Log[] = updates.map((log: { logs: Log[] }) => log.logs).flat();
                    newLogs = newLogs.map((x) => {
                        const ts = typeof x.timestamp === 'string' ? new Date(x.timestamp).getTime() / 1000 : x.timestamp;
                        const isBackend = ['suggestion_generated', 'reflection_generated', 'reflection_generated'].includes(x.event);
                        return {
                            ...x,
                            timestamp: ts,
                            isBackend,
                        };
                    });
                    // Just append new logs (no deduplication)
                    const allLogs = [...logsRef.current, ...newLogs];
                    logsRef.current = allLogs;
                    setLogs(allLogs);
                }
            } catch (e) {
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
    }, [logSecret]);

    // Username datalist
    const availableUsernames = useMemo(() => {
        return Array.from(new Set(logs.map(x => x.username))).sort();
    }, [logs]);

    // Filtered logs
    const desiredEntries = useMemo(() => {
        return logs.filter(x =>
            (!username || x.username === username)
        );
    }, [logs, username]);

    // Generation type counts
    const generationTypeCounts = useMemo(() => {
        return Object.entries(
            desiredEntries.reduce((acc: Record<string, number>, x) => {
                if (x.isBackend && x.generation_type) {
                    acc[x.generation_type] = (acc[x.generation_type] || 0) + 1;
                }
                return acc;
            }, {} as Record<string, number>)
        ).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([k, v]) => ({ generationType: k, count: v as number }));
    }, [desiredEntries]);

    return (
        <div className="p-6">
            <div className="mb-4">
                <label className="flex items-center gap-2">
                    Log Secret:
                    <input
                        type="text"
                        value={logSecret}
                        onChange={e => {
                            setLogSecret(e.target.value);
                            localStorage.setItem('logSecret', e.target.value);
                        }}
                        placeholder="Enter log secret"
                        className="px-3 py-2 border border-gray-300 rounded transition duration-150 cursor-pointer focus:cursor-text focus:outline-none focus:border-black hover:border-black"
                    />
                </label>
            </div>
            <div className="mb-4 flex items-center gap-6">
                <label className="flex items-center gap-2">
                    Username:
                    <input
                        list="usernames"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        placeholder="Select or type username"
                        className="px-3 py-2 border border-gray-300 rounded transition duration-150 cursor-pointer focus:cursor-text focus:outline-none focus:border-black hover:border-black"
                    />
                    <datalist id="usernames">
                        {availableUsernames.map(u => <option key={u} value={u} />)}
                    </datalist>
                </label>
            </div>
            <div className="mb-4">
                <strong>{desiredEntries.length}</strong> entries selected of <strong>{logs.length}</strong> total entries.<br />
                Last entry: {desiredEntries.length > 0 ? new Date(desiredEntries[desiredEntries.length - 1].timestamp * 1000).toLocaleString() : 'No entries'}
            </div>
            <div className="mb-4">
                <strong>Generation Type Counts:</strong>
                <ul>
                    {generationTypeCounts.map(({ generationType, count }: { generationType: string, count: number }) => (
                        <li key={generationType}>{generationType}: {count}</li>
                    ))}
                </ul>
            </div>

            <EntriesTable entries={desiredEntries} />
        </div>
    );
}

ReactDOM.render(<App />, document.getElementById('container'));

// Add styles for collapsible
