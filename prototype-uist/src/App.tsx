import { useEffect, useMemo, useRef, useState } from "react";
import { coachAndExtractFromUserMessage, suggestInsertionPlacement } from "./api";
import {
  addUserTextToBank,
  resolveApprovedBankText,
  setBankItemStatus,
  updateBankItem,
} from "./bank";
import {
  describeTarget,
  findFocusRangeForAnchor,
  getFocusRangeForTarget,
  insertBankText,
} from "./document";
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
  anchorText?: string,
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
    case "before_paragraph":
      return { kind: "before_paragraph", anchorText };
    case "after_paragraph":
      return { kind: "after_paragraph", anchorText };
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
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(
    null,
  );
  const [placementRequestText, setPlacementRequestText] = useState("");
  const [showRejectedBankItems, setShowRejectedBankItems] = useState(false);
  const [wordBankDraft, setWordBankDraft] = useState("");
  const [selectedWordBankText, setSelectedWordBankText] = useState("");
  const [editingBankItemId, setEditingBankItemId] = useState<string | null>(
    null,
  );
  const [pendingAlert, setPendingAlert] = useState(0);

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
          suggestion.id === activeSuggestionId &&
          suggestion.status === "suggested",
      ) ?? null,
    [activeSuggestionId, suggestions],
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

  function focusDraftRange(start: number, end: number, nextDraft = draft) {
    requestAnimationFrame(() => {
      const textarea = draftRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(start, end);
      syncEditorSelection(nextDraft);
    });
  }

  function focusDraftQuote(anchorText?: string) {
    const focusRange = findFocusRangeForAnchor(draft, anchorText);
    if (!focusRange) {
      return false;
    }

    focusDraftRange(focusRange.start, focusRange.end);
    return true;
  }

  function resolveInsertionBankItem(candidateText: string): WordBankItem | null {
    return resolveApprovedBankText(candidateText, groupedBankItems.approved);
  }

  function pushMessage(message: ChatMessage) {
    setMessages((currentMessages) => [...currentMessages, message]);
  }

  function handleClearContext() {
    const confirmed = window.confirm(
      "Clear the current chat context, placement suggestions, and rejected additions?",
    );
    if (!confirmed) {
      return;
    }

    const clearBankToo = window.confirm(
      "Also clear the shared word bank and pending additions for a fresh essay?",
    );

    setMessages([starterMessage]);
    setSuggestions([]);
    setComposerText("");
    setComposerInputType("typed");
    setNotice(
      clearBankToo
        ? "Cleared the context and emptied the word bank for a fresh start."
        : "Cleared the context and kept only the approved word bank.",
    );
    setBankDrafts({});
    setActiveSuggestionId(null);
    setPlacementRequestText("");
    setShowRejectedBankItems(false);
    setSelectedWordBankText("");
    setEditingBankItemId(null);
    setPendingAlert(0);
    setTargetKind("append");
    setPlaceholderTarget("");
    speech.reset();

    if (clearBankToo) {
      setBankItems([]);
      setWordBankDraft("");
      return;
    }

    setBankItems((currentItems) =>
      currentItems.filter((item) => item.status === "approved"),
    );
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
        setPendingAlert(extractedItems.length);
      }
      if (guardrailNotes.length > 0) {
        setNotice(guardrailNotes[0]);
      }

      const primedItem =
        response.coachMode === "placement" && response.placementCandidateText
          ? resolveInsertionBankItem(response.placementCandidateText)
          : null;

      if (primedItem && !activeSuggestionId) {
        setPlacementRequestText(primedItem.text);
        if (response.focusQuote) {
          focusDraftQuote(response.focusQuote);
        }
        setNotice(
          "The coach is pointing at a spot for this — review the suggest box on the right.",
        );
      } else if (response.focusQuote) {
        focusDraftQuote(response.focusQuote);
      }

      pushMessage({
        id: createId("msg"),
        role: "assistant",
        text: response.reply,
        timestamp: Date.now(),
        coachMode: response.coachMode,
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
    if (
      activeSuggestionId &&
      !suggestions.some(
        (suggestion) =>
          suggestion.id === activeSuggestionId &&
          approvedIds.has(suggestion.bankItemId),
      )
    ) {
      setActiveSuggestionId(null);
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
        recentMessages: messages,
      });

      const concreteTarget = buildInsertionTarget(
        response.target.kind,
        editorSelection.start,
        editorSelection.end,
        response.target.placeholder ?? "",
        response.target.anchorText,
      );
      const highlightRange = getFocusRangeForTarget(draft, concreteTarget) ?? undefined;

      const suggestion: InsertionSuggestion = {
        id: createId("suggestion"),
        bankItemId: item.id,
        bankText: item.text,
        target: concreteTarget,
        reason: response.reason,
        status: "suggested",
        createdAt: Date.now(),
        highlightRange,
      };

      setSuggestions((currentSuggestions) => {
        const remainingSuggestions = currentSuggestions.filter(
          (currentSuggestion) => currentSuggestion.bankItemId !== item.id,
        );
        return [...remainingSuggestions, suggestion];
      });
      setActiveSuggestionId(suggestion.id);
      setPlacementRequestText(item.text);
      if (
        concreteTarget.kind === "selection" ||
        concreteTarget.kind === "cursor" ||
        concreteTarget.kind === "append" ||
        concreteTarget.kind === "placeholder"
      ) {
        setTargetKind(concreteTarget.kind);
      }
      if (concreteTarget.kind === "placeholder") {
        setPlaceholderTarget(concreteTarget.placeholder ?? "");
      }
      if (highlightRange) {
        focusDraftRange(highlightRange.start, highlightRange.end);
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

  async function handleSuggestPlacementFromBox() {
    const matchedItem = resolveInsertionBankItem(placementRequestText);
    if (!matchedItem) {
      setNotice(
        "The suggest-placement box must contain text that already exists inside one approved word-bank entry.",
      );
      return;
    }

    await handleSuggestPlacement(matchedItem);
  }

  function handleDismissPlacementSuggestion() {
    if (activeSuggestionId) {
      setSuggestions((currentSuggestions) =>
        currentSuggestions.map((currentSuggestion) =>
          currentSuggestion.id === activeSuggestionId
            ? { ...currentSuggestion, status: "dismissed" }
            : currentSuggestion,
        ),
      );
    }
    setActiveSuggestionId(null);
    setPlacementRequestText("");
    setNotice("Cleared the current placement suggestion.");
  }

  function handleInsertExactText() {
    if (!selectedSuggestion) {
      setNotice("Ask for a placement suggestion before inserting.");
      return;
    }

    const matchedItem = resolveInsertionBankItem(selectedSuggestion.bankText);
    if (!matchedItem) {
      setNotice(
        "The suggested text no longer exists inside the approved word bank.",
      );
      return;
    }

    const result = insertBankText({
      draft,
      bankItem: matchedItem,
      target: selectedSuggestion.target,
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
        currentSuggestion.id === selectedSuggestion.id
          ? { ...currentSuggestion, status: "accepted" }
          : currentSuggestion,
      ),
    );
    setActiveSuggestionId(selectedSuggestion.id);
    setNotice(result.guardrail.message);
    focusDraftRange(insertedRange.start, insertedRange.end, result.nextDraft);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-copy">
          <p className="eyebrow">User-Owned Words Prototype</p>
          <h1>Writing coach with hard authorship guardrails</h1>
          <p className="topbar-note">
            AI can coach, extract, and suggest placement, but only validated
            user-owned wording can enter the bank or the draft.
          </p>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={handleClearContext}>
            Clear context
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="pane chat-pane">
          <div className="pane-header">
            <div>
              <p className="pane-kicker">Chat + Voice</p>
              <h2>Think out loud</h2>
            </div>
            <p>
              Speak or type naturally. The AI replies in text and only exact
              user wording can be lifted into the bank.
            </p>
          </div>

          {pendingAlert > 0 && groupedBankItems.proposed.length > 0 ? (
            <div className="pending-banner" role="status">
              <span>
                {groupedBankItems.proposed.length} word-bank suggestion
                {groupedBankItems.proposed.length === 1 ? "" : "s"} waiting for
                approval.
              </span>
              <button type="button" onClick={() => setPendingAlert(0)}>
                Dismiss
              </button>
            </div>
          ) : null}

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
                  {message.coachMode ? (
                    <span className="coach-mode-tag">{message.coachMode}</span>
                  ) : null}
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
              Plain-text drafting for v1. The coach can point at a paragraph
              and suggest a placement without writing new prose for you.
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
              Approved text lives in one shared bank box. Pending additions sit
              right beneath it so you can review and approve them quickly.
            </p>
          </div>

          <div className="bank-layout">
            <div className="bank-priority-stack">
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
                    <span>One shared box for approved wording</span>
                    <span>Select any span and send it into the suggest box</span>
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
                  <h3>Approve additions before they enter the bank</h3>
                  <span
                    className={
                      groupedBankItems.proposed.length > 0
                        ? "section-count pending-badge"
                        : "section-count"
                    }
                  >
                    {groupedBankItems.proposed.length} pending
                  </span>
                </div>
                <div className="pending-list">
                  {groupedBankItems.proposed.length === 0 ? (
                    <p className="empty-state">
                      No pending additions right now. Meta chat requests are
                      filtered out before they reach this area.
                    </p>
                  ) : (
                    groupedBankItems.proposed.map((item) => (
                      <article className="bank-card pending-card" key={item.id}>
                        {editingBankItemId === item.id ? (
                          <>
                            <textarea
                              rows={4}
                              value={bankDrafts[item.id] ?? item.text}
                              onChange={(event) =>
                                handleBankDraftChange(item.id, event.target.value)
                              }
                            />
                            <div className="bank-actions">
                              <button
                                type="button"
                                onClick={() => {
                                  handleSaveProposedEdit(item);
                                  setEditingBankItemId(null);
                                }}
                              >
                                Save edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingBankItemId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="pending-text">{item.text}</p>
                            <div className="bank-actions">
                              <button
                                type="button"
                                onClick={() => handleApprove(item)}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReject(item)}
                              >
                                Reject
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingBankItemId(item.id)}
                              >
                                Edit
                              </button>
                            </div>
                          </>
                        )}
                      </article>
                    ))
                  )}
                </div>
              </div>

              <div className="bank-section">
                <div className="section-row">
                  <h3>Suggest placement from the bank</h3>
                  <span className="section-count">One suggestion at a time</span>
                </div>
                <div className="bank-card suggestion-workspace">
                  <textarea
                    rows={4}
                    value={placementRequestText}
                    onChange={(event) => setPlacementRequestText(event.target.value)}
                    placeholder="Paste or select user-owned text from the word bank here. The suggestion tool will only use text that already exists inside an approved bank entry."
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
                      {selectedSuggestion.highlightRange ? (
                        <p className="suggestion-highlight-note">
                          The draft has been narrowed to the region the AI is pointing to.
                        </p>
                      ) : null}
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
                      Ask for a suggestion and the AI will point to a likely
                      region in the draft based on the current document and the
                      recent conversation.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="bank-support-scroll">
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
