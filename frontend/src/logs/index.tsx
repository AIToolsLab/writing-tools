import * as ReactDOM from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';

import { SERVER_URL } from '@/api';

import classes from './styles.module.css';

interface Log {
    username: string;
    interaction: string;
    prompt: string;
    result: string;
    completion: string;
    timestamp: number; // Use number for easier calculations
    isBackend?: boolean;
    generationType?: string;
    isPlayground?: boolean;
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
        <details className={classes.collapsible} style={{ maxWidth }} title={displayText}>
            <summary>{displayText.length > 100 ? displayText.slice(0, 100) + '…' : displayText}</summary>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{displayText}</pre>
        </details>
    );
}

function secondsToHMS(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const pad = (x: number) => x.toString().padStart(2, '0');
    return `${pad(m)}m${pad(s)}`;
}

function getInteractionColor(interaction: string) {
    if (interaction.includes('Backend')) return '#BBE9FF';
    if (interaction.includes('Frontend')) return '#FFEADD';
    if (interaction.includes('Sensitivity')) return '#FFFED3';
    return '#FFFFFF';
}

function deduplicateLogs(logs: Log[]): Log[] {
    const seen = new Set<string>();
    return logs.filter(log => {
        const key = `${log.timestamp}|${log.interaction}|${log.username}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
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
        <table className={classes.table}>
            <thead>
                <tr>
                    <th>Timestamp</th>
                    <th>Interaction</th>
                    <th>Prompt</th>
                    <th>Result</th>
                    <th>Completion</th>
                </tr>
            </thead>
            <tbody>
                {annotatedEntries.map((entry: any, i: number) => (
                    <tr key={i}>
                        <td>{secondsToHMS(entry.secondsSinceStart)}</td>
                        <td style={{ backgroundColor: getInteractionColor(entry.interaction) }}>{entry.interaction}</td>
                        <td><Collapsible text={entry.prompt} /></td>
                        <td><Collapsible text={entry.result} /></td>
                        <td><Collapsible text={entry.completion} /></td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function App() {
    const [logs, setLogs] = useState<Log[]>([]);
    const [username, setUsername] = useState('');
    const [includePlayground, setIncludePlayground] = useState(false);
    const [logSecret, setLogSecret] = useState<string>(() => localStorage.getItem('logSecret') || '');
    const logsRef = useRef<Log[]>([]);

    // Fetch logs via SSE
    useEffect(() => {
        if (!logSecret) return;
        const streamer = new EventSource(`${SERVER_URL}/logs?secret=${encodeURIComponent(logSecret)}`);
        streamer.onmessage = (event) => {
            const parsedLogs = JSON.parse(event.data);
            let newLogs: Log[] = parsedLogs.map((log: { logs: Log[] }) => log.logs).flat();
            // Convert timestamp to number (seconds)
            newLogs = newLogs.map((x) => {
                const ts = typeof x.timestamp === 'string' ? new Date(x.timestamp).getTime() / 1000 : x.timestamp;
                const isBackend = x.interaction.endsWith('_Backend');
                return {
                    ...x,
                    timestamp: ts,
                    isBackend,
                    generationType: isBackend ? x.interaction.replace('_Backend', '') : undefined,
                    isPlayground: ((x.prompt || '').trim().startsWith('From the Wikipedia page on Calvin University')),
                };
            });
            // Deduplicate
            const allLogs = deduplicateLogs([...logsRef.current, ...newLogs]);
            logsRef.current = allLogs;
            setLogs(allLogs);
        };
        return () => streamer.close();
    }, [logSecret]);

    // Username datalist
    const availableUsernames = useMemo(() => {
        return Array.from(new Set(logs.map(x => x.username))).sort();
    }, [logs]);

    // Filtered logs
    const desiredEntries = useMemo(() => {
        return logs.filter(x =>
            (!username || x.username === username) &&
            (includePlayground || !x.isPlayground)
        );
    }, [logs, username, includePlayground]);

    // Generation type counts
    const generationTypeCounts = useMemo(() => {
        return Object.entries(
            desiredEntries.reduce((acc: Record<string, number>, x) => {
                if (x.isBackend && x.generationType) {
                    acc[x.generationType] = (acc[x.generationType] || 0) + 1;
                }
                return acc;
            }, {} as Record<string, number>)
        ).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([k, v]) => ({ generationType: k, count: v as number }));
    }, [desiredEntries]);

    return (
        <div className={classes.container}>
            <div style={{ marginBottom: 16 }}>
                <label>
                    Username:
                    <input
                        list="usernames"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        placeholder="Select or type username"
                        style={{ marginLeft: 8 }}
                    />
                    <datalist id="usernames">
                        {availableUsernames.map(u => <option key={u} value={u} />)}
                    </datalist>
                </label>
                <label style={{ marginLeft: 24 }}>
                    <input
                        type="checkbox"
                        checked={includePlayground}
                        onChange={e => setIncludePlayground(e.target.checked)}
                        style={{ marginRight: 4 }}
                    />
                    Include Playground
                </label>
            </div>
            <div style={{ marginBottom: 16 }}>
                <strong>{desiredEntries.length}</strong> entries selected of <strong>{logs.length}</strong> total entries.<br />
                Last entry: {desiredEntries.length > 0 ? new Date(desiredEntries[desiredEntries.length - 1].timestamp * 1000).toLocaleString() : 'No entries'}
            </div>
            <div style={{ marginBottom: 16 }}>
                <strong>Generation Type Counts:</strong>
                <ul>
                    {generationTypeCounts.map(({ generationType, count }: { generationType: string, count: number }) => (
                        <li key={generationType}>{generationType}: {count}</li>
                    ))}
                </ul>
            </div>
            <div style={{ marginBottom: 16 }}>
                <label>
                    Log Secret:
                    <input
                        type="text"
                        value={logSecret}
                        onChange={e => {
                            setLogSecret(e.target.value);
                            localStorage.setItem('logSecret', e.target.value);
                        }}
                        placeholder="Enter log secret"
                        style={{ marginLeft: 8 }}
                    />
                </label>
            </div>
            <EntriesTable entries={desiredEntries} />
        </div>
    );
}

ReactDOM.render(<App />, document.getElementById('container'));

// Add styles for collapsible
