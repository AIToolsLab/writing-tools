import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  elaborateIdea,
  fitSentence,
  freshId,
  locateInDraft,
  proposeIdeas,
  reflectOnEdit,
  reflectPlanVsDraft,
  syncCheck,
  type CandidateIdea,
  type DraftLocation,
  type EditReflection,
  type IdeaEdge,
  type IdeaNode,
  type NodeStatus,
  type PlanDraftGap,
  type Proposal,
} from "./api";

// ── Voice input (Web Speech API) ───────────────────────────────────────────
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
  onresult: (e: SpeechRecognitionEvent) => void;
  onend: () => void;
  onerror: (e: Event) => void;
}
type SpeechCtor = new () => SpeechRecognition;
const speechCtor = (): SpeechCtor | null => {
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Voice-first dictation; pass "zh-CN" for Mandarin. Returns live transcript. */
function useSpeech(lang: string) {
  const supported = speechCtor() !== null;
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const recRef = useRef<SpeechRecognition | null>(null);
  const finalRef = useRef("");

  useEffect(() => {
    const Ctor = speechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let chunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript + " ";
        else chunk += r[0].transcript;
      }
      setTranscript(finalRef.current);
      setInterim(chunk);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    return () => rec.stop();
  }, [lang]);

  return {
    supported,
    listening,
    transcript,
    interim,
    start: () => {
      if (recRef.current && !listening) {
        setInterim("");
        recRef.current.start();
        setListening(true);
      }
    },
    stop: () => {
      recRef.current?.stop();
      setListening(false);
    },
    reset: () => {
      finalRef.current = "";
      setTranscript("");
      setInterim("");
    },
  };
}

// ── Mindmap node ───────────────────────────────────────────────────────────
interface EditableNodeData {
  label: string;
  expansions: string[];
  status: NodeStatus;
  selected: boolean;
  onCommit: (id: string, oldLabel: string, newLabel: string) => void;
  onSelect: (id: string) => void;
  onExpand: (id: string, direction: string) => void;
  onDelete: (id: string) => void;
  onInsert: (id: string) => void;
  [key: string]: unknown;
}

/** One idea. Click selects; double-click the title edits; editing → reflection. */
function EditableNode({ id, data }: NodeProps) {
  const d = data as EditableNodeData;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(d.label);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== d.label) d.onCommit(id, d.label, next);
    else setDraft(d.label);
  };

  return (
    <div
      className={`idea-node ${d.status} ${d.selected ? "sel" : ""}`}
      onClick={() => d.onSelect(id)}
    >
      <Handle type="target" position={Position.Left} />
      <button
        className="node-del"
        title="Delete this idea"
        onClick={(e) => {
          e.stopPropagation();
          d.onDelete(id);
        }}
      >
        ×
      </button>
      {editing ? (
        <input
          autoFocus
          className="node-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(d.label);
              setEditing(false);
            }
          }}
        />
      ) : (
        <div
          className="node-label"
          title="Double-click to edit"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setDraft(d.label);
            setEditing(true);
          }}
        >
          {d.label}
        </div>
      )}
      {d.expansions.length > 0 && (
        <div className="node-expansions">
          {d.expansions.map((ex, i) => (
            <button
              key={i}
              className="exp-chip"
              title="Branch this direction into a new idea"
              onClick={(e) => {
                e.stopPropagation();
                d.onExpand(id, ex);
              }}
            >
              + {ex}
            </button>
          ))}
        </div>
      )}
      {d.status === "new" && (
        <button
          className="node-insert"
          title="Insert this idea into the draft"
          onClick={(e) => {
            e.stopPropagation();
            d.onInsert(id);
          }}
        >
          Insert into draft →
        </button>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes: NodeTypes = { idea: EditableNode };
const layout = (i: number) => ({ x: 60 + (i % 3) * 280, y: 40 + Math.floor(i / 3) * 200 });

// ── App ────────────────────────────────────────────────────────────────────
interface PendingEdit {
  oldLabel: string;
  newLabel: string;
}

export default function App() {
  const [nodes, setNodes] = useState<IdeaNode[]>([]);
  const [edges, setEdges] = useState<IdeaEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Candidate-selection state (input-stage authorship). `candidates` is null
  // until the AI has proposed; the writer checks which to keep before any node
  // is created.
  const [candidates, setCandidates] = useState<CandidateIdea[] | null>(null);
  const [propEdges, setPropEdges] = useState<Proposal["edges"]>([]);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [other, setOther] = useState("");

  // Signature-interaction state.
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [reflection, setReflection] = useState<EditReflection | null>(null);
  const [reflectError, setReflectError] = useState<string | null>(null);

  // The essay draft — the destination of all this thinking. Persisted locally so
  // an existing draft survives reloads.
  const [draft, setDraft] = useState(
    () => localStorage.getItem("uist-draft") ?? "",
  );
  useEffect(() => {
    localStorage.setItem("uist-draft", draft);
  }, [draft]);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const [syncBusy, setSyncBusy] = useState(false);

  // Mindmap → Draft insertion state.
  const [insertTarget, setInsertTarget] = useState<IdeaNode | null>(null);
  const [insertLoc, setInsertLoc] = useState<DraftLocation | null>(null);
  const [insertMode, setInsertMode] = useState<"verbatim" | "minimal">("verbatim");
  const [insertBusy, setInsertBusy] = useState(false);
  // The draft range to highlight (overlay), independent of textarea focus.
  const [highlightRange, setHighlightRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  // A bubble awaiting more detail from the chat before it can be inserted.
  const [pendingBubble, setPendingBubble] = useState<string | null>(null);

  // Plan-vs-draft reflection state.
  const [gapOpen, setGapOpen] = useState(false);
  const [gap, setGap] = useState<PlanDraftGap | null>(null);
  const [gapBusy, setGapBusy] = useState(false);
  const [gapError, setGapError] = useState<string | null>(null);

  // Conversational input surface.
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const [lang, setLang] = useState("en-US");
  const speech = useSpeech(lang);
  const [text, setText] = useState("");
  useEffect(() => {
    if (speech.transcript) setText(speech.transcript);
  }, [speech.transcript]);
  const live = (text + (speech.interim ? " " + speech.interim : "")).trim();
  const say = (role: "user" | "assistant", t: string) =>
    setMessages((m) => [...m, { role, text: t }]);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [messages, busy]);

  const essayContext = useMemo(() => nodes.map((n) => n.label).join("; "), [nodes]);

  // Send a chat message. If a bubble is awaiting more detail (from an insert
  // nudge), the message develops THAT bubble and retries the insert. Otherwise
  // the AI proposes candidate ideas from the message.
  const send = async () => {
    const msg = live.trim();
    if (!msg || busy) return;
    say("user", msg);
    setText("");
    speech.reset();

    if (pendingBubble) {
      const targetId = pendingBubble;
      setPendingBubble(null);
      const targetNode = nodes.find((n) => n.id === targetId);
      if (targetNode) {
        // Fold the new detail into the bubble, then retry the insert with the
        // updated node (state hasn't flushed yet, so pass it explicitly).
        const updated: IdeaNode = {
          ...targetNode,
          expansions: [...targetNode.expansions, msg],
        };
        setNodes((p) => p.map((n) => (n.id === targetId ? updated : n)));
        say("assistant", "Got it — let me place that for you.");
        startInsert(targetId, updated);
      }
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const p = await proposeIdeas(msg);
      setCandidates(p.ideas);
      setPropEdges(p.edges);
      setChecked(p.ideas.map(() => false)); // default unchecked = active choice
      say(
        "assistant",
        p.ideas.length
          ? `I picked out ${p.ideas.length} possible idea${
              p.ideas.length > 1 ? "s" : ""
            } — choose which are truly yours.`
          : "I couldn't pull distinct ideas from that. Try saying a bit more.",
      );
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m);
      say("assistant", `⚠ ${m}`);
    } finally {
      setBusy(false);
    }
  };

  // Append the writer's own idea to the candidate list, pre-checked.
  const addOther = () => {
    const label = other.trim();
    if (!label || !candidates) return;
    setCandidates([...candidates, { label, expansions: [] }]);
    setChecked([...checked, true]);
    setOther("");
  };

  // Only the checked candidates become real nodes; suggested edges survive only
  // if both endpoints were kept. Accumulates onto the existing map.
  const confirmSelection = () => {
    if (!candidates) return;
    const idByIndex = new Map<number, string>();
    const newNodes: IdeaNode[] = [];
    candidates.forEach((c, i) => {
      if (!checked[i]) return;
      const id = freshId("node");
      idByIndex.set(i, id);
      newNodes.push({ id, label: c.label, expansions: c.expansions, status: "new" });
    });
    const newEdges: IdeaEdge[] = propEdges
      .filter((e) => idByIndex.has(e.source) && idByIndex.has(e.target))
      .map((e) => ({
        id: freshId("edge"),
        source: idByIndex.get(e.source)!,
        target: idByIndex.get(e.target)!,
        label: e.label,
      }));
    setNodes((p) => [...p, ...newNodes]);
    setEdges((p) => [...p, ...newEdges]);
    if (newNodes.length) setSelectedId(newNodes[newNodes.length - 1].id);
    say(
      "assistant",
      `Added ${newNodes.length} idea${
        newNodes.length > 1 ? "s" : ""
      } to your map. Keep going whenever you have more.`,
    );
    // Reset for the next round of input.
    setCandidates(null);
    setPropEdges([]);
    setChecked([]);
  };

  const checkedCount = checked.filter(Boolean).length;

  // The signature interaction: commit the edit, then ask the AI to reflect.
  const handleCommit = useCallback(
    async (id: string, oldLabel: string, newLabel: string) => {
      setNodes((p) => p.map((n) => (n.id === id ? { ...n, label: newLabel } : n)));
      setPendingEdit({ oldLabel, newLabel });
      setReflection(null);
      setReflectError(null);
      try {
        setReflection(await reflectOnEdit(oldLabel, newLabel, essayContext));
      } catch (e) {
        setReflectError(e instanceof Error ? e.message : String(e));
      }
    },
    [essayContext],
  );

  // Fill a bare node with AI-suggested directions + tradeoffs so it matches the
  // depth of proposed ideas. Non-fatal if it fails — the node still exists.
  const elaborateNode = useCallback(
    async (id: string, label: string) => {
      try {
        const e = await elaborateIdea(label, essayContext);
        setNodes((p) =>
          p.map((n) => (n.id === id ? { ...n, expansions: e.expansions } : n)),
        );
      } catch {
        /* keep the bare node */
      }
    },
    [essayContext],
  );

  // Promote a suggested direction into a new child idea node + edge, then fill
  // it out so it has its own directions and tradeoffs.
  const handleExpand = useCallback(
    (parentId: string, direction: string) => {
      const id = freshId("node");
      setNodes((p) => [
        ...p,
        { id, label: direction, expansions: [], status: "new" },
      ]);
      setEdges((p) => [...p, { id: freshId("edge"), source: parentId, target: id }]);
      setSelectedId(id);
      elaborateNode(id, direction);
    },
    [elaborateNode],
  );

  // Delete an idea and any connections touching it.
  const handleDelete = useCallback((id: string) => {
    setNodes((p) => p.filter((n) => n.id !== id));
    setEdges((p) => p.filter((e) => e.source !== id && e.target !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  // Recolor every bubble against the draft: synced / new, and (re)create the
  // draftOnly bubbles for draft points no bubble represents.
  const runSync = async () => {
    setSyncBusy(true);
    setError(null);
    try {
      const r = await syncCheck(
        nodes
          .filter((n) => n.status !== "draftOnly")
          .map((n) => ({ id: n.id, label: n.label })),
        draft,
      );
      const synced = new Set(r.syncedIds);
      setNodes((prev) => {
        const kept: IdeaNode[] = prev
          .filter((n) => n.status !== "draftOnly")
          .map((n) => ({ ...n, status: synced.has(n.id) ? "synced" : "new" }));
        const draftOnly: IdeaNode[] = r.draftOnly.map((label, k) => ({
          id: freshId("node") + k,
          label,
          expansions: [],
          status: "draftOnly",
        }));
        return [...kept, ...draftOnly];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncBusy(false);
    }
  };

  // Highlight a draft range via the overlay, and scroll it into view.
  const showHighlight = (start: number, end: number) => {
    setHighlightRange(start < end ? { start, end } : null);
    const ta = draftRef.current;
    if (!ta) return;
    // Focusing + selecting scrolls the textarea to the range; the overlay mark
    // keeps the highlight visible after focus leaves.
    ta.focus();
    ta.setSelectionRange(start, end);
    requestAnimationFrame(() => {
      if (backdropRef.current) backdropRef.current.scrollTop = ta.scrollTop;
    });
  };

  // Mindmap → Draft, step 1: locate where a bubble belongs and highlight it.
  const startInsert = async (id: string, override?: IdeaNode) => {
    const node = override ?? nodes.find((n) => n.id === id);
    if (!node) return;
    setSelectedId(id);
    setInsertTarget(node);
    setInsertLoc(null);
    setInsertBusy(true);
    setError(null);
    try {
      const loc = await locateInDraft(
        { label: node.label, expansions: node.expansions },
        draft,
      );
      setInsertLoc(loc);
      const at = loc.anchor ? draft.indexOf(loc.anchor) : -1;
      if (at >= 0) showHighlight(at, at + loc.anchor.length);
      else {
        // No anchor → it appends at the end; clear highlight and scroll there.
        setHighlightRange(null);
        const ta = draftRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(draft.length, draft.length);
          ta.scrollTop = ta.scrollHeight;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInsertTarget(null);
    } finally {
      setInsertBusy(false);
    }
  };

  const cancelInsert = () => {
    setHighlightRange(null);
    setInsertTarget(null);
    setInsertLoc(null);
  };

  // Mindmap → Draft, step 2: drop the bubble's own words into the draft. The
  // bubble then turns Synced.
  const applyInsert = async () => {
    if (!insertTarget || !insertLoc) return;
    setInsertBusy(true);
    try {
      const at = insertLoc.anchor ? draft.indexOf(insertLoc.anchor) : -1;
      const idx = at >= 0 ? at + insertLoc.anchor.length : draft.length;
      const before = draft.slice(0, idx);
      const after = draft.slice(idx);
      let text = insertTarget.label;
      if (insertMode === "minimal") {
        text = await fitSentence(
          insertTarget.label,
          before.slice(-160),
          after.slice(0, 160),
        );
      }
      const needsLead = before.length > 0 && !/\s$/.test(before);
      const piece = `${needsLead ? " " : ""}${text}${/[.!?]$/.test(text) ? "" : "."}`;
      const next = before + piece + after;
      setDraft(next);
      const tid = insertTarget.id;
      setNodes((p) => p.map((n) => (n.id === tid ? { ...n, status: "synced" } : n)));
      setInsertTarget(null);
      setInsertLoc(null);
      // Highlight what just landed so the writer sees it.
      setHighlightRange({ start: before.length, end: before.length + piece.length });
      requestAnimationFrame(() => {
        const ta = draftRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(before.length, before.length + piece.length);
          if (backdropRef.current) backdropRef.current.scrollTop = ta.scrollTop;
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInsertBusy(false);
    }
  };

  // Not enough info to insert → route the writer to the chat to develop it.
  const nudgeToChat = () => {
    if (!insertTarget) return;
    setPendingBubble(insertTarget.id);
    setSelectedId(insertTarget.id);
    say("assistant", `Tell me a bit more about "${insertTarget.label}" and I'll get it ready to insert.`);
    cancelInsert();
  };

  // Reverse-outline reflection: where do the idea map and the draft diverge?
  const reflectPlan = async () => {
    setGapOpen(true);
    setGap(null);
    setGapError(null);
    setGapBusy(true);
    try {
      setGap(await reflectPlanVsDraft(nodes.map((n) => n.label), draft));
    } catch (e) {
      setGapError(e instanceof Error ? e.message : String(e));
    } finally {
      setGapBusy(false);
    }
  };

  // A planned idea the draft skipped → drop the idea as a stub heading for the
  // writer to expand. The AI does NOT write the prose.
  const addIdeaToDraft = (label: string, i: number) => {
    setDraft((d) => `${d}${d.trim() ? "\n\n" : ""}${label}\n`);
    setGap((g) =>
      g ? { ...g, missingFromDraft: g.missingFromDraft.filter((_, j) => j !== i) } : g,
    );
  };

  // A draft point missing from the plan → fold it back into the idea map, then
  // flesh it out with directions and tradeoffs like any other idea.
  const addPointToMap = (label: string, i: number) => {
    const id = freshId("node");
    // It came from the draft, so it's present in both → synced.
    setNodes((p) => [...p, { id, label, expansions: [], status: "synced" }]);
    setSelectedId(id);
    setGap((g) => (g ? { ...g, notInMap: g.notInMap.filter((_, j) => j !== i) } : g));
    elaborateNode(id, label);
  };

  const flowNodes = useMemo<Node<EditableNodeData>[]>(
    () =>
      nodes.map((n, i) => ({
        id: n.id,
        type: "idea",
        position: layout(i),
        data: {
          label: n.label,
          expansions: n.expansions,
          status: n.status,
          selected: n.id === selectedId,
          onCommit: handleCommit,
          onSelect: setSelectedId,
          onExpand: handleExpand,
          onDelete: handleDelete,
          onInsert: startInsert,
        },
      })),
    [nodes, selectedId, handleCommit, handleExpand, handleDelete, startInsert],
  );
  const flowEdges = useMemo<Edge[]>(
    () => edges.map((e) => ({ ...e, animated: true })),
    [edges],
  );

  return (
    <div className="app">
      <header className="app-bar">
        <strong>UIST 2026</strong>
        <span className="tagline">
          AI augments your thinking — it never replaces you as the writer.
        </span>
      </header>

      <main className="layout">
        {/* LEFT: conversational input + the idea list it produces */}
        <section className="left">
          <div className="panel chat-panel">
            <header className="panel-head">
              <h2>Talk through your scattered thoughts</h2>
              <p className="hint">
                Speak or type the way you think. The AI proposes ideas — it never
                writes for you.
              </p>
            </header>

            <div className="chat-log" ref={logRef}>
              {messages.length === 0 ? (
                <p className="empty">
                  Start talking or typing below — your thoughts can be as
                  scattered as you like.
                </p>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={`bubble ${m.role}`}>
                    {m.text}
                  </div>
                ))
              )}
              {busy && <div className="bubble assistant typing">…</div>}
            </div>

            <div className="chat-input">
              <div className="voice-row">
                {speech.supported && (
                  <button
                    type="button"
                    className={`mic ${speech.listening ? "live" : ""}`}
                    onClick={speech.listening ? speech.stop : speech.start}
                  >
                    {speech.listening ? "■ Stop" : "🎙 Speak"}
                  </button>
                )}
                <select value={lang} onChange={(e) => setLang(e.target.value)} title="Dictation language">
                  <option value="en-US">English</option>
                  <option value="zh-CN">中文</option>
                </select>
                {speech.listening && <span className="rec-dot" />}
              </div>
              <div className="composer">
                <textarea
                  rows={2}
                  value={live}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={
                    pendingBubble
                      ? `Add more about "${
                          nodes.find((n) => n.id === pendingBubble)?.label ?? ""
                        }"…`
                      : "Talk through your essay…  (Enter to send · Shift+Enter for a new line)"
                  }
                />
                <button className="primary send" type="button" disabled={busy || !live} onClick={send}>
                  {busy ? "…" : "Send"}
                </button>
              </div>
              {error && <div className="error">{error}</div>}
            </div>
          </div>

          <div className="panel idea-panel">
            <header className="panel-head">
              <h2>Your idea list</h2>
              <p className="hint">
                The ideas you chose to keep — mirrored live as the mindmap on the
                right.
              </p>
            </header>
            {nodes.length === 0 ? (
              <p className="empty">
                No ideas yet. Talk it through and pick the ideas that are yours.
              </p>
            ) : (
              <ul className="idea-list">
                {nodes.map((n) => (
                  <li
                    key={n.id}
                    className={n.id === selectedId ? "on" : ""}
                    onClick={() => setSelectedId(n.id)}
                  >
                    <span>{n.label}</span>
                    <button
                      className="li-del"
                      title="Remove this idea"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(n.id);
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* RIGHT: editable mindmap */}
        <section className="right">
          <div className="map-bar">
            <div className="legend">
              <span className="dot synced" /> Synced
              <span className="dot new" /> New
              <span className="dot draftOnly" /> Draft-only
            </div>
            <button
              className="ghost"
              type="button"
              disabled={syncBusy || (nodes.length === 0 && !draft.trim())}
              onClick={runSync}
            >
              {syncBusy ? "Syncing…" : "⟳ Sync with draft"}
            </button>
          </div>
          <div className="mindmap">
            {nodes.length === 0 ? (
              <p className="empty centered">
                Your idea map appears here once you keep some ideas.
              </p>
            ) : (
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                fitView
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={20} />
                <Controls showInteractive={false} />
              </ReactFlow>
            )}
          </div>
        </section>

        {/* DRAFT: the essay itself — where the thinking lands as writing. */}
        <section className="draft-col">
          <div className="panel draft-panel">
            <header className="panel-head">
              <h2>Essay draft</h2>
              <p className="hint">
                Paste an existing draft or write here. It stays put while you
                reshape ideas on the left.
              </p>
            </header>
            <div className="actions">
              <button
                className="ghost"
                type="button"
                disabled={gapBusy || (nodes.length === 0 && !draft.trim())}
                onClick={reflectPlan}
              >
                {gapBusy ? "Comparing…" : "🔍 Reflect: plan vs draft"}
              </button>
            </div>

            {insertTarget && (
              <div className="insert-bar">
                <div className="insert-head">
                  Insert <strong>"{insertTarget.label}"</strong>
                  <span className="insert-where">
                    {insertBusy
                      ? " · locating…"
                      : insertLoc?.anchor
                        ? " · after the highlighted text"
                        : " · at the end of the draft"}
                  </span>
                </div>

                {insertLoc && !insertLoc.enough ? (
                  <div className="nudge">
                    ⚠ Need a bit more about this idea before it can go in.
                    <button className="ghost" type="button" onClick={nudgeToChat}>
                      Tell me in chat →
                    </button>
                  </div>
                ) : (
                  <div className="insert-actions">
                    <div className="mode-toggle">
                      <label className={insertMode === "verbatim" ? "on" : ""}>
                        <input
                          type="radio"
                          checked={insertMode === "verbatim"}
                          onChange={() => setInsertMode("verbatim")}
                        />
                        Verbatim
                      </label>
                      <label className={insertMode === "minimal" ? "on" : ""}>
                        <input
                          type="radio"
                          checked={insertMode === "minimal"}
                          onChange={() => setInsertMode("minimal")}
                        />
                        Minimal edit
                      </label>
                    </div>
                    <div className="actions">
                      <button
                        className="primary"
                        type="button"
                        disabled={insertBusy || !insertLoc}
                        onClick={applyInsert}
                      >
                        {insertBusy ? "Inserting…" : "Insert"}
                      </button>
                      <button className="ghost" type="button" onClick={cancelInsert}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="draft-wrap">
              <div className="draft-backdrop" ref={backdropRef} aria-hidden="true">
                {highlightRange ? (
                  <>
                    {draft.slice(0, highlightRange.start)}
                    <mark>{draft.slice(highlightRange.start, highlightRange.end)}</mark>
                    {draft.slice(highlightRange.end)}
                  </>
                ) : (
                  draft
                )}
                {"\n"}
              </div>
              <textarea
                ref={draftRef}
                className="draft-area"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (highlightRange) setHighlightRange(null);
                }}
                onScroll={(e) => {
                  if (backdropRef.current)
                    backdropRef.current.scrollTop = e.currentTarget.scrollTop;
                }}
                placeholder="Paste your existing draft, or start writing your essay here…"
              />
            </div>
          </div>
        </section>
      </main>

      {/* Input-stage authorship: choose which proposed ideas are truly yours. */}
      {candidates && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setCandidates(null);
            setChecked([]);
            setPropEdges([]);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="reflect-q">Which of these are truly yours?</h2>
            <p className="hint">
              The AI only proposes — you decide which enter your idea list. Add
              anything it missed under "Other".
            </p>
            <div className="candidates">
              {candidates.map((c, i) => (
                <label key={i} className={`cand ${checked[i] ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked[i]}
                    onChange={() =>
                      setChecked((cur) => cur.map((v, j) => (j === i ? !v : v)))
                    }
                  />
                  <span>{c.label}</span>
                </label>
              ))}
              <div className="other-row">
                <input
                  type="text"
                  value={other}
                  placeholder="Other — add an idea in your own words"
                  onChange={(e) => setOther(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addOther()}
                />
                <button className="ghost" type="button" disabled={!other.trim()} onClick={addOther}>
                  + Add
                </button>
              </div>
            </div>
            <div className="actions end">
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  setCandidates(null);
                  setChecked([]);
                  setPropEdges([]);
                }}
              >
                Discard
              </button>
              <button
                className="primary"
                type="button"
                disabled={checkedCount === 0}
                onClick={confirmSelection}
              >
                Add {checkedCount || ""} to my ideas →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reverse-outline reflection: the gap between plan and draft. */}
      {gapOpen && (
        <div className="modal-backdrop" onClick={() => setGapOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="reflect-q">Plan vs draft</h2>
            {gapBusy ? (
              <p className="empty">Comparing your idea map with your draft…</p>
            ) : gapError ? (
              <div className="error">{gapError}</div>
            ) : gap ? (
              <>
                <section className="gap-block">
                  <h3>In your idea map, but not yet in your draft</h3>
                  {gap.missingFromDraft.length === 0 ? (
                    <p className="hint">Your draft covers everything in your map.</p>
                  ) : (
                    <ul className="gap-list">
                      {gap.missingFromDraft.map((g, i) => (
                        <li key={i}>
                          <span>{g}</span>
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => addIdeaToDraft(g, i)}
                          >
                            + Add to draft
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="gap-block">
                  <h3>In your draft, but not in your idea map — intentional?</h3>
                  {gap.notInMap.length === 0 ? (
                    <p className="hint">Your draft stays within your plan.</p>
                  ) : (
                    <ul className="gap-list">
                      {gap.notInMap.map((g, i) => (
                        <li key={i}>
                          <span>{g}</span>
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => addPointToMap(g, i)}
                          >
                            + Add to idea map
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            ) : null}
            <div className="actions end">
              <button className="primary" type="button" onClick={() => setGapOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The signature interaction: reflect every edit back to the writer. */}
      {pendingEdit && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setPendingEdit(null);
            setReflection(null);
            setReflectError(null);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="diff">
              <span className="was">{pendingEdit.oldLabel}</span>
              <span className="arrow">→</span>
              <span className="now">{pendingEdit.newLabel}</span>
            </div>
            {reflectError ? (
              <div className="error">{reflectError}</div>
            ) : !reflection ? (
              <p className="empty">Reflecting on your change…</p>
            ) : (
              <>
                <h2 className="reflect-q">{reflection.question}</h2>
                <div className="pc-grid">
                  <div className="pc-col pros">
                    <h3>This edit gains</h3>
                    <ul>
                      {reflection.prosCons.pros.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="pc-col cons">
                    <h3>This edit costs</h3>
                    <ul>
                      {reflection.prosCons.cons.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            )}
            <div className="actions end">
              <button
                className="primary"
                type="button"
                onClick={() => {
                  setPendingEdit(null);
                  setReflection(null);
                  setReflectError(null);
                }}
              >
                Keep my edit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
