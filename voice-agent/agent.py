"""LiveKit voice agent for the "My Words" voice tab.

An OpenAI Realtime model holds the spoken conversation; its five editor tools
(`view`, `str_replace`, `insert`, `move`, `highlight`) don't run here — they are
**forwarded to the browser over RPC** (see
https://docs.livekit.io/agents/logic/tools/forwarding). The browser owns the
real document (the `EditorAPI` seam) and enforces the word-bank rule
(`validateOp`), returning a short report string that we hand straight back to the
model. So this worker stays thin: prompt + turn-taking + a forwarding shim.

The worker registers WITHOUT an agent name, so LiveKit auto-dispatches it to
every room the browser opens (a named agent would require explicit dispatch).

Run: `uv run python agent.py dev`  (see README.md).
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    RunContext,
    ToolError,
    function_tool,
    get_job_context,
)
from livekit.plugins import openai

# Reuse the backend's LiveKit + OpenAI credentials so there's one place to set
# them. A voice-agent/.env.local (if present) wins for local overrides;
# load_dotenv never overrides an already-set var, so the first file takes
# precedence and the second fills the gaps.
_HERE = Path(__file__).parent
load_dotenv(_HERE / ".env.local")
load_dotenv(_HERE.parent / "backend" / ".env")

logger = logging.getLogger("my-words-voice")

# Override as OpenAI ships new realtime ids (gpt-realtime, gpt-realtime-2, …).
REALTIME_MODEL = os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime-2")
REALTIME_VOICE = os.environ.get("OPENAI_REALTIME_VOICE", "marin")

# The word-bank stance, ported from BASE_PROMPT in the text path
# (frontend/src/pages/my-words/interaction/liveResponder.ts). The rule itself is
# enforced in the browser (validateOp), so this spends its words on stance, not
# policing — plus the voice-specific "one small move, then hand back the floor".
INSTRUCTIONS = """\
You help a writer shape their OWN words in a spoken conversation. You never \
contribute new words: every word you place in the document is lifted from the \
writer's corpus — the document, their scratchpad, and what they say to you — \
joined only by punctuation and small glue words. The app enforces this and \
REJECTS anything else, so don't spend attention policing it; spend it on being a \
good partner.

Work like a tutor in a writing conference: curious, reflective, non-directive. \
Make ONE small, concrete move at a time — a single edit, or a short spoken \
question — then hand the floor back. Prefer moving and tightening the writer's \
existing words over piling on new material. Because this is spoken, keep replies \
to one or two sentences and never read punctuation, symbols, or paragraph \
numbers aloud.

Every edit is tentative: the app shows the writer where an edit will land just \
before it does (they can cancel it), so apply your move, say in a few words what \
changed, and invite a reaction. If the writer hesitates or objects, `undo` it \
without fuss and ask what they'd prefer.

There are two surfaces, chosen with `target`. The DOCUMENT (default) is the \
piece itself. The SCRATCHPAD is the writer's thinking space — their ideas in \
their own words. It does not need to stay in sync with the document; it's where \
spoken phrasing gets parked verbatim before it's lost, where scraps without a \
home collect, and where structure gets sketched without committing the piece. \
Light conventions, not rules: a `#` line is one idea in the writer's words; \
`-` lines under it are related notes; a "quoted phrase" points at the \
document's wording; `[[idea words]]` links to another idea — but the writer \
owns those links, so suggest one aloud rather than writing it unasked. When the \
writer says something worth keeping that doesn't belong in the document yet, \
offer to jot it on the scratchpad — in their words, not yours.

Tools (they act on the writer's live surfaces in their browser): `view` reads \
the numbered paragraphs; `str_replace` / `insert` / `move` make small edits \
drawn from the writer's words; `highlight` points at a passage while you talk \
about it; `undo` reverts your most recent edit. In edit text, a newline starts \
a new paragraph — so `str_replace` can split a paragraph (newline in the new \
text) or join two (match across the boundary by putting a newline in the old \
text). Re-`view` before an edit when paragraph numbers may have shifted. The \
bracketed numbers like [2] are an internal coordinate for your tools only — \
never say them to the writer; refer to a passage by quoting its words or by \
`highlight`ing it. If a tool comes back `REJECTED`, it means the words weren't \
the writer's — try again using only what they've actually said or written."""


async def _forward(method: str, args: dict, *, timeout: float = 10.0) -> str:
    """Forward a tool call to the writer's browser and return its report string.

    The browser registers an RPC handler per tool name; it maps the payload to
    an `EditOp`, validates it against the live corpus, applies it through the
    real editor, and returns a short string for the model to read.
    """
    room = get_job_context().room
    # In a My Words room the only remote participant is the writer.
    try:
        writer_identity = next(iter(room.remote_participants))
    except StopIteration:
        raise ToolError("No writer is connected to the document.")

    # Drop keys whose value is None so optional params don't reach the browser
    # as nulls (keeps the RPC payload clean and the TS handlers simple).
    payload = {k: v for k, v in args.items() if v is not None}
    try:
        return await room.local_participant.perform_rpc(
            destination_identity=writer_identity,
            method=method,
            payload=json.dumps(payload),
            response_timeout=timeout,
        )
    except Exception as e:  # RpcError, timeout, etc. — let the model re-orient.
        logger.warning("RPC %s failed: %s", method, e)
        return f"That tool call didn't go through ({e}). Try again or ask the writer."


class MyWordsAgent(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=INSTRUCTIONS)

    @function_tool()
    async def view(
        self,
        context: RunContext,
        target: str | None = None,
        around: int | None = None,
    ) -> str:
        """Read the current document (or scratchpad), paragraphs numbered like [3].

        Call this to re-read before an edit when paragraph numbers may have
        shifted. The numbers are for targeting `insert`/`move`; never say them
        aloud.

        Args:
            target: 'document' (default) or 'scratchpad'.
            around: Optional paragraph number — return just a short window
                around it instead of the whole text.
        """
        return await _forward("view", {"target": target, "around": around})

    @function_tool()
    async def str_replace(
        self,
        context: RunContext,
        old_str: str,
        new_str: str,
        paragraph: int | None = None,
        target: str | None = None,
    ) -> str:
        """Replace a SHORT span (a phrase or sentence within one paragraph).

        The replacement must be lifted from the writer's own words. Pass
        `paragraph` (the [n] from `view`) to scope the search there — more
        reliable than a bare search. A newline in `new_str` splits the
        paragraph; a newline in `old_str` matches across a paragraph boundary
        (which is how you join two paragraphs).

        Args:
            old_str: The exact existing text to replace.
            new_str: The replacement, drawn from the writer's words.
            paragraph: 1-based paragraph number from `view` to scope to.
            target: 'document' (default) or 'scratchpad'.
        """
        return await _forward(
            "str_replace",
            {
                "old_str": old_str,
                "new_str": new_str,
                "paragraph": paragraph,
                "target": target,
            },
        )

    @function_tool()
    async def insert(
        self,
        context: RunContext,
        text: str,
        after: str | None = None,
        paragraph: int | None = None,
        position: str | None = None,
        target: str | None = None,
    ) -> str:
        """Insert text lifted from the writer's words.

        Pass `paragraph` + `position` to place a new paragraph relative to an
        existing one, `after` to insert within a paragraph, or neither to
        append at the end. A newline in `text` starts another new paragraph.

        Args:
            text: The text to insert, drawn from the writer's words.
            after: Insert right after this existing text (within a paragraph).
            paragraph: 1-based paragraph number from `view` to position against.
            position: 'before' or 'after' the target paragraph. Defaults to after.
            target: 'document' (default) or 'scratchpad'.
        """
        return await _forward(
            "insert",
            {
                "text": text,
                "after": after,
                "paragraph": paragraph,
                "position": position,
                "target": target,
            },
        )

    @function_tool()
    async def move(
        self,
        context: RunContext,
        phrase: str,
        paragraph: int,
        position: str | None = None,
        target: str | None = None,
    ) -> str:
        """Relocate an existing passage (the writer's own words) elsewhere.

        Adds no words — it moves what's already there.

        Args:
            phrase: The exact existing passage to relocate.
            paragraph: 1-based paragraph number to move it next to.
            position: 'before' or 'after' the target paragraph. Defaults to after.
            target: 'document' (default) or 'scratchpad'.
        """
        return await _forward(
            "move",
            {
                "phrase": phrase,
                "paragraph": paragraph,
                "position": position,
                "target": target,
            },
        )

    @function_tool()
    async def highlight(
        self, context: RunContext, phrase: str, target: str | None = None
    ) -> str:
        """Point at a passage while you talk about it (selects/highlights it).

        Args:
            phrase: The exact existing text to highlight.
            target: 'document' (default) or 'scratchpad'.
        """
        return await _forward("highlight", {"phrase": phrase, "target": target})

    @function_tool()
    async def undo(self, context: RunContext) -> str:
        """Revert your most recent edit (document or scratchpad).

        Use it freely when the writer hesitates or objects — edits are meant to
        be tentative. Undoing something the writer has since hand-edited is
        refused rather than guessed at.
        """
        return await _forward("undo", {})


server = AgentServer()


# No agent_name -> LiveKit auto-dispatches this worker to every room the browser
# opens. (Setting a name would require explicit dispatch from the backend.)
@server.rtc_session()
async def entrypoint(ctx: agents.JobContext):
    session = AgentSession(
        llm=openai.realtime.RealtimeModel(
            model=REALTIME_MODEL,
            voice=REALTIME_VOICE,
        ),
    )

    await session.start(room=ctx.room, agent=MyWordsAgent())

    # A short spoken greeting so the writer hears the pipe is live.
    await session.generate_reply(
        instructions=(
            "Greet the writer warmly in one short sentence and invite them to "
            "talk about what they're working on. Do not use any tools yet."
        )
    )


if __name__ == "__main__":
    agents.cli.run_app(server)
