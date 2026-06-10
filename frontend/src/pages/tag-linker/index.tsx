import { useContext, useEffect, useRef, useState } from 'react';
import { EditorContext } from '@/contexts/editorContext';

interface TabEntry {
	id: string;
	title: string;
	text: string;
}

// One result row = one occurrence of the keyword in a tab.
interface Occurrence {
	tabId: string;
	title: string;
	snippet: string;
	occurrenceIndex: number; // 0-based: which occurrence within this tab
}

// Build one entry per occurrence of the keyword in the tab's text (case-insensitive),
// each with a snippet of surrounding context. Capped to avoid runaway on common words.
function getOccurrences(tab: TabEntry, keyword: string, radius = 80): Occurrence[] {
	const lowerText = tab.text.toLowerCase();
	const lowerKw = keyword.toLowerCase();
	if (!lowerKw) return [];

	const out: Occurrence[] = [];
	const MAX = 50;
	let from = 0;
	while (out.length < MAX) {
		const idx = lowerText.indexOf(lowerKw, from);
		if (idx === -1) break;
		const start = Math.max(0, idx - radius);
		const end = Math.min(tab.text.length, idx + keyword.length + radius);
		const raw = tab.text.slice(start, end).replace(/\n/g, ' ').trim();
		out.push({
			tabId: tab.id,
			title: tab.title,
			snippet: (start > 0 ? '…' : '') + raw + (end < tab.text.length ? '…' : ''),
			occurrenceIndex: out.length,
		});
		from = idx + lowerKw.length;
	}
	return out;
}

function detectCurrentTab(tabs: TabEntry[], beforeCursor: string, selectedText: string, afterCursor: string): string | null {
	const sample = (beforeCursor.slice(-200) + selectedText + afterCursor.slice(0, 200))
		.replace(/\s+/g, ' ')
		.trim();

	if (!sample) return null;

	let bestTab: string | null = null;
	let bestScore = 0;

	tabs.forEach(tab => {
		const tabText = tab.text.replace(/\s+/g, ' ');
		let score = 0;
		for (let i = 0; i < sample.length - 30; i += 20) {
			const chunk = sample.slice(i, i + 30).toLowerCase();
			if (tabText.toLowerCase().includes(chunk)) score++;
		}
		if (score > bestScore) {
			bestScore = score;
			bestTab = tab.id;
		}
	});

	return bestScore > 0 ? bestTab : null;
}

export default function TagLinker() {
	const editorAPI = useContext(EditorContext);

	const [tabs, setTabs] = useState<TabEntry[]>([]);
	const [keyword, setKeyword] = useState<string>('');
	const [results, setResults] = useState<Occurrence[]>([]);
	const [loadingTabs, setLoadingTabs] = useState<boolean>(true);
	const [searching, setSearching] = useState<boolean>(false);
	const [error, setError] = useState<string | null>(null);

	// Keep a ref to tabs so the selection handler always sees latest value
	const tabsRef = useRef<TabEntry[]>([]);
	const documentIdRef = useRef<string>('');

	// On mount: fetch document ID and all tabs, then start listening
	useEffect(() => {
		async function init() {
			if (!window.GoogleAppsScript) {
				setLoadingTabs(false);
				return;
			}
			try {
				const [docId, allTabs] = await Promise.all([
					window.GoogleAppsScript.getDocumentId(),
					window.GoogleAppsScript.getAllTabs(),
				]);
				setTabs(allTabs);
				tabsRef.current = allTabs;
				documentIdRef.current = docId;
			} catch {
				setError('Failed to load tabs.');
			} finally {
				setLoadingTabs(false);
			}
		}
		void init();
	}, []);

	// Listen for selection changes and auto-search
	useEffect(() => {
		let debounceTimer: ReturnType<typeof setTimeout> | null = null;

		const handleSelectionChange = () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				void runSearch();
			}, 400);
		};

		async function runSearch() {
			const currentTabs = tabsRef.current;
			if (currentTabs.length === 0) return;

			let context;
			try {
				context = await editorAPI.getDocContext();
			} catch {
				return;
			}

			const selected = context.selectedText.trim();
			if (!selected) {
				setKeyword('');
				setResults([]);
				setError(null);
				return;
			}

			setKeyword(selected);
			setSearching(true);
			setError(null);

			const detectedTabId = detectCurrentTab(
				currentTabs,
				context.beforeCursor,
				context.selectedText,
				context.afterCursor,
			);

			const matched: Occurrence[] = currentTabs
				.filter(tab => tab.id !== detectedTabId)
				.flatMap(tab => {
					const occ = getOccurrences(tab, selected);
					// Title-only match (keyword in the tab name but not its body):
					// still offer one jump to that tab.
					if (
						occ.length === 0 &&
						tab.title.toLowerCase().includes(selected.toLowerCase())
					) {
						return [{ tabId: tab.id, title: tab.title, snippet: '', occurrenceIndex: 0 }];
					}
					return occ;
				});

			setResults(matched);
			setSearching(false);

			if (matched.length === 0) {
				setError(`No other tabs found for "${selected}".`);
			}
		}

		editorAPI.addSelectionChangeHandler(handleSelectionChange);
		return () => {
			editorAPI.removeSelectionChangeHandler(handleSelectionChange);
			if (debounceTimer) clearTimeout(debounceTimer);
		};
	}, [editorAPI]);

	function buildTabUrl(tabId: string) {
		// Google Docs switches tabs via the ?tab= query param, not a #hash fragment.
		return `https://docs.google.com/document/d/${documentIdRef.current}/edit?tab=${tabId}`;
	}

	// Jump to a tab by selecting the keyword there — this switches the tab in the
	// same window and highlights the match. If the Apps Script select can't reach
	// across tabs, fall back to opening the tab in a new browser tab.
	async function jumpToTab(tabId: string, occurrenceIndex: number) {
		try {
			const ok = await window.GoogleAppsScript.selectInTab(
				tabId,
				keyword,
				occurrenceIndex,
			);
			if (ok) return;
		} catch {
			// fall through to the new-tab fallback
		}
		window.open(buildTabUrl(tabId), '_blank', 'noopener');
	}

	if (loadingTabs) {
		return (
			<div style={styles.container}>
				<p style={styles.muted}>Loading tabs…</p>
			</div>
		);
	}

	return (
		<div style={styles.container}>
			<h3 style={styles.heading}>Tag Linker</h3>

			{tabs.length === 0 ? (
				<p style={styles.muted}>No tabs found in this document.</p>
			) : (
				<>
					<p style={styles.hint}>
						Select a word or phrase to find it in other tabs.
					</p>
					<div style={styles.tabCount}>
						{tabs.length} tab{tabs.length !== 1 ? 's' : ''} in this document
					</div>

					{searching ? <p style={styles.muted}>Searching…</p> : null}

					{!searching && !!keyword && results.length === 0 && !!error && (
						<p style={styles.muted}>{error}</p>
					)}

					{!searching && results.length > 0 && (
						<div style={styles.results}>
							<p style={styles.resultsHeader}>
								<strong>"{keyword}"</strong> found in {results.length}{' '}
								place{results.length !== 1 ? 's' : ''}:
							</p>
							{results.map((occ, i) => (
								<div key={`${occ.tabId}-${occ.occurrenceIndex}-${i}`} style={styles.card}>
									<div style={styles.cardTitle}>{occ.title}</div>
									{occ.snippet ? (
										<div style={styles.snippet}>"{occ.snippet}"</div>
									) : null}
									<button
										type="button"
										onClick={() => {
											void jumpToTab(occ.tabId, occ.occurrenceIndex);
										}}
										style={styles.jumpLink}
									>
										Jump to tab ↗
									</button>
								</div>
							))}
						</div>
					)}

					{!searching && !keyword && (
						<p style={styles.muted}>Select text in the document to see related tabs.</p>
					)}
				</>
			)}
		</div>
	);
}

const styles: Record<string, React.CSSProperties> = {
	container: {
		padding: '16px',
		fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
		fontSize: '13px',
		color: '#202124',
	},
	heading: {
		fontSize: '15px',
		fontWeight: 600,
		margin: '0 0 8px',
	},
	hint: {
		color: '#5f6368',
		margin: '0 0 8px',
		lineHeight: 1.5,
	},
	tabCount: {
		color: '#5f6368',
		marginBottom: '12px',
		fontSize: '12px',
	},
	muted: {
		color: '#5f6368',
		lineHeight: 1.4,
	},
	results: {
		marginTop: '8px',
	},
	resultsHeader: {
		margin: '0 0 10px',
		color: '#5f6368',
	},
	card: {
		border: '1px solid #dadce0',
		borderRadius: '6px',
		padding: '10px 12px',
		marginBottom: '10px',
		backgroundColor: '#f8f9fa',
	},
	cardTitle: {
		fontWeight: 600,
		marginBottom: '6px',
		fontSize: '13px',
	},
	snippet: {
		color: '#5f6368',
		fontStyle: 'italic',
		fontSize: '12px',
		marginBottom: '8px',
		lineHeight: 1.4,
	},
	jumpLink: {
		background: 'none',
		border: 'none',
		padding: 0,
		color: '#1a73e8',
		cursor: 'pointer',
		fontSize: '12px',
		fontWeight: 500,
	},
};
