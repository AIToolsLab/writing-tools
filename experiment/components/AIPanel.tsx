'use client';

import { Fragment, useCallback, useRef, useState, useEffect } from 'react';
import type { RefObject } from 'react';
import type { WritingAreaRef } from '@/components/WritingArea';
import type { GenerationResult, SavedItem, TextEditorState } from '@/types';
import { log } from '@/lib/logging';
import { API_TIMEOUT_MS } from '@/lib/studyConfig';
import { useAtom } from 'jotai';
import { studyParamsAtom } from '@/contexts/StudyContext';
import type { ConditionName } from '@/types/study';

const visibleNameForMode = {
  example_sentences: 'Examples of what you could write next:',
  analysis_readerPerspective: 'Possible questions your reader might have:',
  proposal_advice: 'Advice for your next words:',
};

const modes = ['example_sentences', 'analysis_readerPerspective', 'proposal_advice'] as const;

function GenerationResultDisplay({ generation }: { generation: GenerationResult }) {
  return (
    <div className="prose prose-sm max-w-none">
      <div className="font-bold text-sm mb-2 text-gray-900">
        {visibleNameForMode[generation.generation_type as keyof typeof visibleNameForMode]}
      </div>
      <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{generation.result}</div>
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
          <div className="text-sm text-gray-500 font-medium">No suggestions yet...</div>
        </div>
      ) : (
        savedItems.map((savedItem) => {
          const key = savedItem.dateSaved.toString();
          return (
            <div
              key={key}
              className="bg-blue-50 border border-blue-200 rounded p-3 hover:bg-blue-100 hover:shadow-md transition-all"
            >
              <div className="text-xs font-semibold text-blue-700 mb-2">
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
                className="text-xs px-2 py-1 rounded font-medium bg-red-100 text-red-800 hover:bg-red-200 active:bg-red-300 transition-colors"
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

interface AIPanelProps {
  writingAreaRef?: RefObject<WritingAreaRef | null>;
  mode?: ConditionName;
  autoRefreshInterval?: number;
  isStudyMode?: boolean;
}

export default function AIPanel({
  writingAreaRef,
  mode,
  autoRefreshInterval = 15000,
  isStudyMode = false,
}: AIPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const docContextRef = useRef<TextEditorState | null>(null);
  const [studyParams] = useAtom(studyParamsAtom);
  const autoRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const previousRequestRef = useRef<{ editorState: TextEditorState; mode: string } | null>(null);

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
    async (suggestionMode?: string) => {
      setErrorMsg('');
      setIsLoading(true);

      // Use provided mode or fall back to component mode
      const modeToUse = suggestionMode || mode;
      if (!modeToUse) {
        setErrorMsg('No mode specified');
        setIsLoading(false);
        return;
      }

      try {
        // Get current editor state
        const editorState = writingAreaRef?.current?.getEditorState();
        if (!editorState) {
          setErrorMsg('Unable to read editor state');
          return;
        }

        // Check if this is a duplicate request (same content and mode)
        if (
          previousRequestRef.current &&
          JSON.stringify(previousRequestRef.current.editorState) === JSON.stringify(editorState) &&
          previousRequestRef.current.mode === modeToUse
        ) {
          setIsLoading(false);
          return;
        }

        docContextRef.current = editorState;
        previousRequestRef.current = { editorState, mode: modeToUse };

        // Log AI request in study mode
        if (isStudyMode && modeToUse) {
          await log({
            username: studyParams.username,
            event: `aiRequest:${modeToUse}`,
          });
        }

        const response = await fetch('/api/writing-support', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            editorState,
            context: modeToUse,
          }),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = (await response.json()) as { suggestions: string[] };

        // Convert response to GenerationResult
        const result = data.suggestions[0] || '';
        const generation: GenerationResult = {
          result,
          generation_type: modeToUse as GenerationResult['generation_type'],
        };

        if (result) {
          save(generation, editorState);

          // Log AI response in study mode
          if (isStudyMode) {
            await log({
              username: studyParams.username,
              event: `aiResponse:${modeToUse}`,
            });
          }
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
    [writingAreaRef, save, mode, isStudyMode, studyParams]
  );

  // Auto-refresh logic for study mode
  useEffect(() => {
    if (!isStudyMode || !mode || mode === 'no_ai') {
      return;
    }

    // Set up auto-refresh interval
    autoRefreshIntervalRef.current = setInterval(() => {
      log({
        username: studyParams.username,
        event: `aiAutoRefresh:${mode}`,
      }).catch((e) => console.error('Failed to log auto-refresh:', e));

      getSuggestion(mode);
    }, autoRefreshInterval);

    return () => {
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
      }
    };
  }, [isStudyMode, mode, autoRefreshInterval, getSuggestion, studyParams]);

  let alerts = null;

  if (errorMsg !== '') {
    alerts = (
      <div className="p-3 bg-red-100 border-l-4 border-red-600 rounded">
        <div className="text-sm font-semibold text-red-900 text-center">{errorMsg}</div>
      </div>
    );
  } else if (savedItems.length === 0) {
    alerts = (
      <div className="p-3 bg-blue-50">
        <div className="text-xs font-medium text-gray-700 text-center">
          Click a button above to generate a suggestion.
        </div>
      </div>
    );
  }

  if (isLoading) {
    alerts = (
      <div className="flex justify-center py-4">
        <div className="w-5 h-5 border-2 border-blue-400 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white border-l border-gray-300 p-4 text-sm text-gray-700 flex flex-col overflow-hidden">
      <h3 className="text-sm font-bold text-gray-900 mb-3">AI Writing Assistant</h3>

      {!isStudyMode && (
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {modes.map((mode) => (
            <Fragment key={mode}>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => getSuggestion(mode)}
                className="px-3 py-1.5 text-xs font-semibold text-gray-700 border border-gray-400 rounded bg-gray-50 hover:bg-blue-50 hover:border-blue-400 active:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
      )}

      {alerts}

      <SavedGenerations savedItems={savedItems} deleteSavedItem={deleteSavedItem} />

      <div className="text-xs text-gray-500 text-center mt-3 pt-2 border-t border-gray-300 font-medium">
        AI-generated text may vary in quality
      </div>
    </div>
  );
}
