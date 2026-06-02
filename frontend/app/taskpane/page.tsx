// Word task pane surface. Reached via the `/taskpane.html` -> `/taskpane` rewrite that
// the Office manifest points at. This placeholder is replaced by the Office.js-backed
// editor app (onReady gating + wordEditorAPI) in a later migration commit.
export default function TaskPane() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Thoughtful</h1>
      <p className="text-zinc-600">
        Task pane scaffold. Office.js integration lands in a subsequent migration
        commit.
      </p>
    </main>
  );
}
