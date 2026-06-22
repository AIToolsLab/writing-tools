import { useEffect, useMemo, useRef, useState } from "react";
import { coachAndExtractFromUserMessage, suggestInsertionPlacement } from "./api";
import {
  addUserTextToBank,
  setBankItemStatus,
  updateBankItem,
} from "./bank";
import { describeTarget, insertBankText } from "./document";
import type {
  ChatInputType,
  ChatMessage,
  InsertionSuggestion,
  InsertionTarget,
  InsertionTargetKind,
  WordBankItem,
} from "./types";

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: { 0: { transcript: string }; isFinal: boolean };
  };
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onend: () => void;
  onerror: () => void;
}

type SpeechConstructor = new () => SpeechRecognition;

const STORAGE_KEYS = {
  draft: "owned-words-draft",
  messages: "owned-words-messages",
  bank: "owned-words-bank",
  suggestions: "owned-words-suggestions",
};

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSpeechConstructor(): SpeechConstructor | null {
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechConstructor;
    webkitSpeechRecognition?: SpeechConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function useLocalStorageState<T>(storageKey: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? (JSON.parse(stored) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(value));
  }, [storageKey, value]);

  return [value, setValue] as const;
}

function useSpeechToText(language: string) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalTranscriptRef = useRef("");

  useEffect(() => {
    const Constructor = getSpeechConstructor();
    if (!Constructor) {
      setSupported(false);
      return undefined;
    }

    setSupported(true);
    const recognition = new Constructor();
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let nextInterim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) {
          finalTranscriptRef.current += `${result[0].transcript} `;
        } else {
          nextInterim += result[0].transcript;
        }
      }
      setTranscript(finalTranscriptRef.current.trim());
      setInterim(nextInterim.trim());
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
    };
  }, [language]);

  return {
    supported,
    listening,
    transcript,
    interim,
    start() {
      if (!recognitionRef.current || listening) {
        return;
      }
      setInterim("");
      recognitionRef.current.start();
      setListening(true);
    },
    stop() {
      recognitionRef.current?.stop();
      setListening(false);
    },
    reset() {
      finalTranscriptRef.current = "";
      setTranscript("");
      setInterim("");
    },
  };
}

function getPlaceholderOptions(draft: string): string[] {
  const matches = draft.match(/\[[^\]]+\]|\{\{[^}]+\}\}|<[^>]+>/g) ?? [];
  return Array.from(new Set(matches.map((match) => match.trim()))).slice(0, 10);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildInsertionTarget(
  targetKind: InsertionTargetKind,
  selectionStart: number,
  selectionEnd: number,
  placeholderText: string,
): InsertionTarget {
  switch (targetKind) {
    case "selection":
      return { kind: "selection", start: selectionStart, end: selectionEnd };
    case "cursor":
      return { kind: "cursor", start: selectionEnd };
    case "append":
      return { kind: "append" };
    case "placeholder":
      return { kind: "placeholder", placeholder: placeholderText };
  }
}

function buildWordBankText(items: WordBankItem[]): string {
  return items.map((item) => item.text.trim()).filter(Boolean).join("\n\n");
}

const starterMessage: ChatMessage = {
  id: createId("msg"),
  role: "assistant",
  text: "Talk me through the part of your draft you want to strengthen. I will coach you and capture only your own wording for the bank.",
  timestamp: Date.now(),
};

export default function App() {
  const [draft, setDraft] = useLocalStorageState(STORAGE_KEYS.draft, "");
  const [messages, setMessages] = useLocalStorageState<ChatMessage[]>(
    STORAGE_KEYS.messages,
    [starterMessage],
  );
  const [bankItems, setBankItems] = useLocalStorageState<WordBankItem[]>(
    STORAGE_KEYS.bank,
    [],
  );
  const [suggestions, setSuggestions] = useLocalStorageState<InsertionSuggestion[]>(
    STORAGE_KEYS.suggestions,
    [],
  );
  const [composerText, setComposerText] = useState("");
  const [composerInputType, setComposerInputType] =
    useState<ChatInputType>("typed");
  const [language, setLanguage] = useState("en-US");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [editorSelection, setEditorSelection] = useState({
    start: 0,
    end: 0,
    selectedText: "",
  });
  const [targetKind, setTargetKind] =
    useState<InsertionTargetKind>("append");
  const [placeholderTarget, setPlaceholderTarget] = useState("");
  const [bankDrafts, setBankDrafts] = useState<Record<string, string>>({});
  const [activeSuggestionItemId, setActiveSuggestionItemId] = useState<string | null>(
    null,
  );
  const [placementRequestText, setPlacementRequestText] = useState("");
  const [showRejectedBankItems, setShowRejectedBankItems] = useState(false);
  const [wordBankDraft, setWordBankDraft] = useState("");
  const [selectedWordBankText, setSelectedWordBankText] = useState("");

  const speech = useSpeechToText(language);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const wordBankRef = useRef<HTMLTextAreaElement | null>(null);

  const groupedBankItems = useMemo(
    () => ({
      proposed: bankItems.filter((item) => item.status === "proposed"),
      approved: bankItems.filter((item) => item.status === "approved"),
      rejected: bankItems.filter((item) => item.status === "rejected"),
    }),
    [bankItems],
  );

  const placeholderOptions = useMemo(() => getPlaceholderOptions(draft), [draft]);
  const selectedSuggestion = useMemo(
    () =>
      suggestions.find(
        (suggestion) =>
          suggestion.bankItemId === activeSuggestionItemId &&
          suggestion.status === "suggested",
      ) ?? null,
    [activeSuggestionItemId, suggestions],
  );

  useEffect(() => {
    if (!speech.transcript && !speech.interim) {
      return;
    }
    const liveTranscript = `${speech.transcript} ${speech.interim}`.trim();
    setComposerText(liveTranscript);
    setComposerInputType("voice");
  }, [speech.interim, speech.transcript]);

  useEffect(() => {
    chatLogRef.current?.scrollTo({
      top: chatLogRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    setWordBankDraft(buildWordBankText(groupedBankItems.approved));
  }, [groupedBankItems.approved]);

  function syncEditorSelection(currentDraft = draft) {
    const textarea = draftRef.current;
    if (!textarea) {
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setEditorSelection({
      start,
      end,
      selectedText: currentDraft.slice(start, end),
    });
  }

  function syncWordBankSelection() {
    const textarea = wordBankRef.current;
    if (!textarea) {
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setSelectedWordBankText(wordBankDraft.slice(start, end));
  }

  function pushMessage(message: ChatMessage) {
    setMessages((currentMessages) => [...currentMessages, message]);
  }

  async function handleSend() {
    const trimmed = composerText.trim();
    if (!trimmed || busy) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createId("msg"),
      role: "user",
      text: trimmed,
      timestamp: Date.now(),
      inputType: composerInputType,
    };
    pushMessage(userMessage);
    setComposerText("");
    setComposerInputType("typed");
    speech.reset();
    setBusy(true);
    setNotice("");

    try {
      const response = await coachAndExtractFromUserMessage({
        draft,
        recentMessages: [...messages, userMessage],
        latestUserMessage: userMessage,
        bankItems,
      });

      const extractedItems: WordBankItem[] = [];
      const guardrailNotes: string[] = [];
      for (const candidateText of response.candidateTexts) {
        const result = addUserTextToBank({
          candidateText,
          existingItems: [...bankItems, ...extractedItems],
          messageId: userMessage.id,
          messages: [userMessage],
          origin: "ai",
        });

        if (result.item) {
          extractedItems.push(result.item);
        } else {
          guardrailNotes.push(result.guardrail.message);
        }
      }

      if (extractedItems.length > 0) {
        setBankItems((currentItems) => [...currentItems, ...extractedItems]);
      }
      if (guardrailNotes.length > 0) {
        setNotice(guardrailNotes[0]);
      }

      pushMessage({
        id: createId("msg"),
        role: "assistant",
        text: response.reply,
        timestamp: Date.now(),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "The AI request failed.";
      setNotice(errorMessage);
      pushMessage({
        id: createId("msg"),
        role: "assistant",
        text: "I hit a snag while processing that. Try sending it again.",
        timestamp: Date.now(),
      });
    } finally {
      setBusy(false);
    }
  }

  function handleApprove(item: WordBankItem) {
    setBankItems((currentItems) =>
      currentItems.map((currentItem) =>
        currentItem.id === item.id
          ? setBankItemStatus(currentItem, "approved")
          : currentItem,
      ),
    );
    setNotice("Approved the bank item and moved it into the shared word bank.");
  }

  function handleReject(item: WordBankItem) {
    setBankItems((currentItems) =>
      currentItems.map((currentItem) =>
        currentItem.id === item.id
          ? setBankItemStatus(currentItem, "rejected")
          : currentItem,
      ),
    );
    setNotice("Rejected the proposed bank addition.");
  }

  function handleBankDraftChange(itemId: string, value: string) {
    setBankDrafts((currentDrafts) => ({
      ...currentDrafts,
      [itemId]: value,
    }));
  }

  function handleSaveProposedEdit(item: WordBankItem) {
    const nextText = bankDrafts[item.id] ?? item.text;
    const result = updateBankItem({
      candidateText: nextText,
      currentItem: item,
      existingItems: bankItems,
      messages,
      origin: "user",
    });

    if (!result.item) {
      setNotice(result.guardrail.message);
      return;
    }

    setBankItems((currentItems) =>
      currentItems.map((currentItem) =>
        currentItem.id === item.id ? result.item ?? currentItem : currentItem,
      ),
    );
    setBankDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[item.id];
      return nextDrafts;
    });
    setNotice("Saved your edit to the proposed addition.");
  }

  function handleSaveWordBank() {
    const nextEntries = wordBankDraft
      .split(/\n\s*\n/g)
      .map((entry) => entry.trim())
      .filter(Boolean);

    const preservedApprovedItems = nextEntries.map((entryText) => {
      const matchingItem = groupedBankItems.approved.find(
        (item) => item.text.trim() === entryText,
      );

      if (matchingItem) {
        return {
          ...matchingItem,
          status: "approved" as const,
          lastEditedBy: "user" as const,
          updatedAt: Date.now(),
        };
      }

      return {
        id: createId("bank"),
        text: entryText,
        sourceMessageIds: [],
        status: "approved" as const,
        createdBy: "user" as const,
        lastEditedBy: "user" as const,
        updatedAt: Date.now(),
      };
    });

    const approvedIds = new Set(preservedApprovedItems.map((item) => item.id));
    setBankItems((currentItems) => {
      const nonApprovedItems = currentItems.filter(
        (item) => item.status !== "approved",
      );
      return [...nonApprovedItems, ...preservedApprovedItems];
    });
    setSuggestions((currentSuggestions) =>
      currentSuggestions.filter((suggestion) => approvedIds.has(suggestion.bankItemId)),
    );
    if (activeSuggestionItemId && !approvedIds.has(activeSuggestionItemId)) {
      setActiveSuggestionItemId(null);
    }
    setNotice("Saved the shared word bank.");
  }

  async function handleSuggestPlacement(item: WordBankItem) {
    setBusy(true);
    setNotice("");
    try {
      const textarea = draftRef.current;
      const cursorIndex = textarea?.selectionEnd ?? draft.length;
      const cursorBefore = draft.slice(Math.max(0, cursorIndex - 120), cursorIndex);
      const cursorAfter = draft.slice(cursorIndex, cursorIndex + 120);
      const response = await suggestInsertionPlacement({
        draft,
        bankItemText: item.text,
        selectedText: editorSelection.selectedText,
        cursorBefore,
        cursorAfter,
        placeholderOptions,
      });

      const suggestion: InsertionSuggestion = {
        id: createId("suggestion"),
        bankItemId: item.id,
        target: response.target,
        reason: response.reason,
        status: "suggested",
        createdAt: Date.now(),
      };

      setSuggestions((currentSuggestions) => {
        const remainingSuggestions = currentSuggestions.filter(
          (currentSuggestion) => currentSuggestion.bankItemId !== item.id,
        );
        return [...remainingSuggestions, suggestion];
      });
      setActiveSuggestionItemId(item.id);
      setTargetKind(response.target.kind);
      if (response.target.kind === "placeholder") {
        setPlaceholderTarget(response.target.placeholder ?? "");
      }
      setNotice("AI suggested a placement target for the chosen bank text.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Placement suggestion failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  function findApprovedBankItemByText(candidateText: string): WordBankItem | null {
    const trimmedCandidate = candidateText.trim();
    if (!trimmedCandidate) {
      return null;
    }

    return (
      groupedBankItems.approved.find(
        (item) => item.text.trim() === trimmedCandidate,
      ) ?? null
    );
  }

  async function handleSuggestPlacementFromBox() {
    const matchedItem = findApprovedBankItemByText(placementRequestText);
    if (!matchedItem) {
      setNotice(
        "Placement suggestions only work from exact approved bank text. Select text from the word bank or paste it exactly.",
      );
      return;
    }

    await handleSuggestPlacement(matchedItem);
  }

  function handleDismissPlacementSuggestion() {
    if (activeSuggestionItemId) {
      setSuggestions((currentSuggestions) =>
        currentSuggestions.map((currentSuggestion) =>
          currentSuggestion.bankItemId === activeSuggestionItemId
            ? { ...currentSuggestion, status: "dismissed" }
            : currentSuggestion,
        ),
      );
    }
    setActiveSuggestionItemId(null);
    setPlacementRequestText("");
    setNotice("Cleared the current placement suggestion.");
  }

  function handleInsertExactText() {
    const matchedItem = findApprovedBankItemByText(placementRequestText);
    if (!matchedItem) {
      setNotice(
        "The text in the suggest-placement box no longer matches an approved bank entry.",
      );
      return;
    }

    const target = buildInsertionTarget(
      targetKind,
      editorSelection.start,
      editorSelection.end,
      placeholderTarget,
    );
    const result = insertBankText({
      draft,
      bankItem: matchedItem,
      target,
      textToInsert: matchedItem.text,
    });

    if (!result.nextDraft || !result.insertedRange) {
      setNotice(result.guardrail.message);
      return;
    }

    setDraft(result.nextDraft);
    const insertedRange = result.insertedRange;
    setSuggestions((currentSuggestions) =>
      currentSuggestions.map((currentSuggestion) =>
        currentSuggestion.bankItemId === matchedItem.id
          ? { ...currentSuggestion, status: "accepted" }
          : currentSuggestion,
      ),
    );
    setActiveSuggestionItemId(matchedItem.id);
    setNotice(result.guardrail.message);

    requestAnimationFrame(() => {
      const textarea = draftRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(
        insertedRange.start,
        insertedRange.end,
      );
      syncEditorSelection(result.nextDraft);
    });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">User-Owned Words Prototype</p>
          <h1>Writing coach with hard authorship guardrails</h1>
        </div>
        <p className="topbar-note">
          The AI can coach, extract, and suggest placement. Only validated
          user-owned wording can enter the bank or the draft.
        </p>
      </header>

      <main className="workspace">
        <section className="pane chat-pane">
          <div className="pane-header">
            <div>
              <p className="pane-kicker">Chat + Voice</p>
              <h2>Think out loud</h2>
            </div>
            <p>
              Speak or type naturally. The AI replies in text and can only lift
              exact wording from your submitted message.
            </p>
          </div>

          <div className="chat-log" ref={chatLogRef}>
            {messages.map((message) => (
              <article
                key={message.id}
                className={`chat-bubble ${message.role === "user" ? "user" : "assistant"}`}
              >
                <div className="bubble-meta">
                  <span>{message.role === "user" ? "You" : "Coach"}</span>
                  <span>{formatTime(message.timestamp)}</span>
                  {message.inputType ? <span>{message.inputType}</span> : null}
                </div>
                <p>{message.text}</p>
              </article>
            ))}
            {busy ? (
              <article className="chat-bubble assistant">
                <div className="bubble-meta">
                  <span>Coach</span>
                  <span>working</span>
                </div>
                <p>Thinking through your draft and your latest wording...</p>
              </article>
            ) : null}
          </div>

          <div className="composer-panel">
            <div className="voice-controls">
              <button
                className={`voice-button ${speech.listening ? "live" : ""}`}
                type="button"
                disabled={!speech.supported}
                onClick={() => {
                  if (speech.listening) {
                    speech.stop();
                  } else {
                    speech.start();
                  }
                }}
              >
                {speech.listening ? "Stop dictation" : "Use voice"}
              </button>
              <select
                aria-label="Voice input language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option value="en-US">English</option>
                <option value="zh-CN">Chinese</option>
              </select>
            </div>

            <textarea
              className="composer"
              rows={5}
              value={composerText}
              onChange={(event) => {
                setComposerText(event.target.value);
                if (!speech.listening) {
                  setComposerInputType("typed");
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Say or type the next thing you want to explore. Ctrl/Cmd + Enter sends it."
            />

            <div className="composer-footer">
              <p>
                Voice fills the composer first so you can confirm the transcript
                before it becomes user-owned source text.
              </p>
              <button
                className="primary-button"
                type="button"
                disabled={busy || !composerText.trim()}
                onClick={() => {
                  void handleSend();
                }}
              >
                Send to coach
              </button>
            </div>
          </div>
        </section>

        <section className="pane document-pane">
          <div className="pane-header">
            <div>
              <p className="pane-kicker">Document</p>
              <h2>Draft editor</h2>
            </div>
            <p>
              Plain-text drafting for v1. AI placement suggestions feed the
              insertion controls below, but the insert tool only accepts exact
              approved bank text.
            </p>
          </div>

          <div className="target-toolbar">
            <div className="target-options">
              {(
                [
                  ["selection", "Replace selection"],
                  ["cursor", "Insert at cursor"],
                  ["append", "Append to end"],
                  ["placeholder", "Replace placeholder"],
                ] as Array<[InsertionTargetKind, string]>
              ).map(([kind, label]) => (
                <label
                  key={kind}
                  className={targetKind === kind ? "target-chip active" : "target-chip"}
                >
                  <input
                    checked={targetKind === kind}
                    name="target-kind"
                    type="radio"
                    value={kind}
                    onChange={() => setTargetKind(kind)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            {targetKind === "placeholder" ? (
              <div className="placeholder-row">
                <input
                  value={placeholderTarget}
                  onChange={(event) => setPlaceholderTarget(event.target.value)}
                  placeholder="[Insert here]"
                />
                {placeholderOptions.length > 0 ? (
                  <select
                    value={placeholderTarget}
                    onChange={(event) => setPlaceholderTarget(event.target.value)}
                  >
                    <option value="">Choose existing placeholder</option>
                    {placeholderOptions.map((placeholder) => (
                      <option key={placeholder} value={placeholder}>
                        {placeholder}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : null}
          </div>

          <textarea
            ref={draftRef}
            className="draft-editor"
            value={draft}
            onChange={(event) => {
              const nextDraft = event.target.value;
              setDraft(nextDraft);
              syncEditorSelection(nextDraft);
            }}
            onClick={() => syncEditorSelection()}
            onKeyUp={() => syncEditorSelection()}
            onSelect={() => syncEditorSelection()}
            placeholder="Paste an existing draft here or start writing. Highlight text, place your cursor, or use placeholders to control bank insertions."
          />

          <div className="editor-meta">
            <span>
              Selection: {editorSelection.start}-{editorSelection.end}
            </span>
            <span>
              Characters in selection: {editorSelection.selectedText.length}
            </span>
            <span>Draft length: {draft.length}</span>
          </div>
        </section>

        <section className="pane bank-pane">
          <div className="pane-header">
            <div>
              <p className="pane-kicker">Word Bank</p>
              <h2>User-owned text</h2>
            </div>
            <p>
              Proposed text enters only after approval. Approved text lives in
              one shared bank box so you can read and edit it in one place.
            </p>
          </div>

          <div className="bank-columns">
            <div className="bank-section">
              <h3>Approve additions before they enter the bank</h3>
              {groupedBankItems.proposed.length === 0 ? (
                <p className="empty-state">No proposed snippets yet.</p>
              ) : (
                groupedBankItems.proposed.map((item) => (
                  <article className="bank-card" key={item.id}>
                    <textarea
                      rows={4}
                      value={bankDrafts[item.id] ?? item.text}
                      onChange={(event) =>
                        handleBankDraftChange(item.id, event.target.value)
                      }
                    />
                    <div className="bank-meta">
                      <span>{item.sourceMessageIds.length} source message(s)</span>
                      <span>added by AI extraction</span>
                    </div>
                    <div className="bank-actions">
                      <button type="button" onClick={() => handleApprove(item)}>
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveProposedEdit(item)}
                      >
                        Save edit
                      </button>
                      <button type="button" onClick={() => handleReject(item)}>
                        Reject
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="bank-section">
              <div className="section-row">
                <h3>Word bank</h3>
                <span className="section-count">
                  {groupedBankItems.approved.length} approved item(s)
                </span>
              </div>
              <div className="bank-card approved word-bank-textbox">
                <textarea
                  ref={wordBankRef}
                  rows={12}
                  value={wordBankDraft}
                  onChange={(event) => setWordBankDraft(event.target.value)}
                  onClick={syncWordBankSelection}
                  onKeyUp={syncWordBankSelection}
                  onSelect={syncWordBankSelection}
                  placeholder="Approved user-owned text will live here. Separate entries with a blank line."
                />
                <div className="bank-meta">
                  <span>One shared box for all approved wording</span>
                  <span>Separate entries with a blank line</span>
                </div>
                <div className="bank-actions">
                  <button type="button" onClick={handleSaveWordBank}>
                    Save word bank
                  </button>
                  <button
                    type="button"
                    disabled={!selectedWordBankText.trim()}
                    onClick={() => setPlacementRequestText(selectedWordBankText.trim())}
                  >
                    Use selected text in suggest box
                  </button>
                </div>
              </div>
            </div>

            <div className="bank-section">
              <div className="section-row">
                <h3>Suggest placement from the bank</h3>
                <span className="section-count">One suggestion at a time</span>
              </div>
              <div className="bank-card suggestion-workspace">
                <textarea
                  rows={5}
                  value={placementRequestText}
                  onChange={(event) => setPlacementRequestText(event.target.value)}
                  placeholder="Paste exact approved bank text here or select text from the word bank and send it here for a placement suggestion."
                />
                <div className="bank-actions">
                  <button
                    type="button"
                    disabled={!selectedWordBankText.trim()}
                    onClick={() => setPlacementRequestText(selectedWordBankText.trim())}
                  >
                    Use selected bank text
                  </button>
                  <button
                    type="button"
                    disabled={busy || !placementRequestText.trim()}
                    onClick={() => {
                      void handleSuggestPlacementFromBox();
                    }}
                  >
                    Ask for suggestion
                  </button>
                </div>

                {selectedSuggestion ? (
                  <div className="bank-suggestion-panel">
                    <p className="suggestion-label">Suggested placement</p>
                    <strong>
                      Do you want to insert this text as {describeTarget(selectedSuggestion.target).toLowerCase()}?
                    </strong>
                    <p>{selectedSuggestion.reason}</p>
                    <div className="bank-actions">
                      <button
                        className="primary-button"
                        type="button"
                        onClick={handleInsertExactText}
                      >
                        Insert exact text
                      </button>
                      <button
                        type="button"
                        onClick={handleDismissPlacementSuggestion}
                      >
                        No
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="empty-state">
                    Ask for a suggestion and the AI will propose one placement here,
                    based on the current chat context and the bank text you chose.
                  </p>
                )}
              </div>
            </div>

            <div className="bank-section">
              <button
                type="button"
                className="drawer-toggle"
                onClick={() => setShowRejectedBankItems((current) => !current)}
              >
                {showRejectedBankItems ? "Hide rejected additions" : "View rejected additions"}
              </button>
              {showRejectedBankItems ? (
                groupedBankItems.rejected.length === 0 ? (
                  <p className="empty-state">No rejected bank additions yet.</p>
                ) : (
                  groupedBankItems.rejected.map((item) => (
                    <article className="bank-card rejected" key={item.id}>
                      <p className="rejected-text">{item.text}</p>
                      <div className="bank-actions">
                        <button type="button" onClick={() => handleApprove(item)}>
                          Re-approve
                        </button>
                      </div>
                    </article>
                  ))
                )
              ) : null}
            </div>
          </div>
        </section>
      </main>

      <footer className="statusbar">
        <p>
          {notice ||
            "Guardrails are active: AI-origin bank writes must match user messages, and draft insertions must exactly match an approved bank item."}
        </p>
      </footer>
    </div>
  );
}
