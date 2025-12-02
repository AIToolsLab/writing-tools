'use client';

import { Fragment, useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { WritingAreaRef } from '@/components/WritingArea';
import type { GenerationResult, SavedItem, TextEditorState } from '@/types';

const visibleNameForMode = {
  example_sentences: 'Examples of what you could write next:',
  analysis_readerPerspective: 'Possible questions your reader might have:',
  proposal_advice: 'Advice for your next words:',
};

const modes = ['example_sentences', 'analysis_readerPerspective', 'proposal_advice'] as const;

function GenerationResultDisplay({ generation }: { generation: GenerationResult }) {
  return (
    <div className="prose prose-sm max-w-none">
      <div className="font-semibold text-sm mb-2">
        {visibleNameForMode[generation.generation_type as keyof typeof visibleNameForMode]}
      </div>
      <div className="text-sm text-gray-700 whitespace-pre-wrap">{generation.result}</div>
    </div>
  );
}

function SavedGenerations({
  savedItems,
  deleteSavedItem,
}: {
  savedItems: SavedItem[];
  deleteSavedItem: (dateSaved: Date) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto space-y-3">
      {savedItems.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-center">
          <div className="text-sm text-gray-400">No suggestions yet...</div>
        </div>
      ) : (
        savedItems.map((savedItem) => {
          const key = savedItem.dateSaved.toString();
          return (
            <div
              key={key}
              className="bg-gray-50 border border-gray-200 rounded p-3 hover:shadow-sm transition-shadow"
            >
              <div className="text-xs text-gray-600 mb-2">
                {savedItem.dateSaved.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
              <div className="mb-3">
                <GenerationResultDisplay generation={savedItem.generation} />
              </div>
              <button
                type="button"
                onClick={() => deleteSavedItem(savedItem.dateSaved)}
                className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
              >
                Delete
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

export default function AIPanel({
  writingAreaRef,
}: {
  writingAreaRef: RefObject<WritingAreaRef | null>;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const docContextRef = useRef<TextEditorState | null>(null);

  const save = useCallback((generation: GenerationResult, document: TextEditorState) => {
    setSavedItems((prev) => [
      {
        generation,
        document,
        dateSaved: new Date(),
      },
      ...prev,
    ]);
  }, []);

  const deleteSavedItem = useCallback((dateSaved: Date) => {
    setSavedItems((prev) => prev.filter((item) => item.dateSaved !== dateSaved));
  }, []);

  const getSuggestion = useCallback(
    async (mode: string) => {
      setErrorMsg('');
      setIsLoading(true);

      try {
        // Get current editor state
        const editorState = writingAreaRef.current?.getEditorState();
        if (!editorState) {
          setErrorMsg('Unable to read editor state');
          return;
        }

        docContextRef.current = editorState;

        const response = await fetch('/api/writing-support', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            editorState,
            context: mode,
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = (await response.json()) as { suggestions: string[] };

        // Convert response to GenerationResult
        const result = data.suggestions[0] || '';
        const generation: GenerationResult = {
          result,
          generation_type: mode as GenerationResult['generation_type'],
        };

        if (result) {
          save(generation, editorState);
        } else {
          setErrorMsg('Received empty suggestion.');
        }
      } catch (err: unknown) {
        let errMsg = '';
        if (err instanceof Error) {
          if (err.name === 'AbortError') {
            errMsg = 'Generating a suggestion took too long, please try again.';
          } else {
            errMsg = `${err.name}: ${err.message}. Please try again.`;
          }
        } else {
          errMsg = 'An error occurred while generating the suggestion.';
        }
        setErrorMsg(errMsg);
      } finally {
        setIsLoading(false);
      }
    },
    [writingAreaRef, save]
  );

  let alerts = null;

  if (errorMsg !== '') {
    alerts = (
      <div className="p-3 bg-red-50 border border-red-200 rounded">
        <div className="text-sm text-red-700 text-center">{errorMsg}</div>
      </div>
    );
  } else if (savedItems.length === 0) {
    alerts = (
      <div className="p-3">
        <div className="text-xs text-gray-600 text-center">
          Click a button above to generate a suggestion.
        </div>
      </div>
    );
  }

  if (isLoading) {
    alerts = (
      <div className="flex justify-center py-4">
        <div className="w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white border border-gray-300 p-3 text-sm text-gray-600 rounded shadow-sm flex flex-col">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">AI Writing Assistant</h3>

      <div className="flex gap-1.5 mb-3 flex-wrap">
        {modes.map((mode) => (
          <Fragment key={mode}>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => getSuggestion(mode)}
              className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={visibleNameForMode[mode]}
            >
              {mode === 'example_sentences'
                ? 'Examples'
                : mode === 'analysis_readerPerspective'
                  ? 'Reader Q&A'
                  : 'Advice'}
            </button>
          </Fragment>
        ))}
      </div>

      {alerts}

      <SavedGenerations savedItems={savedItems} deleteSavedItem={deleteSavedItem} />

      <div className="text-xs text-gray-400 text-center mt-3 pt-2 border-t border-gray-200">
        AI-generated text may vary in quality
      </div>
    </div>
  );
}
