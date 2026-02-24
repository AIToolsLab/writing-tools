'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { overallModeAtom, usernameAtom, studyDataAtom } from '@/lib/atoms';
import { OverallMode, GenerationType } from '@/lib/types';

/**
 * Standalone editor page
 * Used for demo and user study modes
 *
 * URL parameters:
 * - page: study page name (e.g., study-intro, study-task)
 * - username: participant ID
 * - condition: condition code (g, a, p, n, f)
 * - contextToUse: true|false|mixed
 * - isProlific: true|false
 */
export default function EditorPage() {
  const searchParams = useSearchParams();
  const setOverallMode = useSetAtom(overallModeAtom);
  const setUsername = useSetAtom(usernameAtom);
  const setStudyData = useSetAtom(studyDataAtom);

  useEffect(() => {
    const page = searchParams.get('page');
    const username = searchParams.get('username');
    const condition = searchParams.get('condition');
    const contextToUse = searchParams.get('contextToUse') as 'true' | 'false' | 'mixed' | null;
    const isProlific = searchParams.get('isProlific') === 'true';

    // If we have study parameters, set up study mode
    if (page?.startsWith('study-') && username && condition) {
      setOverallMode(OverallMode.study);
      setUsername(username);

      // Map condition codes to generation types
      const conditionMap: Record<string, GenerationType> = {
        g: 'example_sentences',
        a: 'analysis_readerPerspective',
        p: 'proposal_advice',
        n: 'no_ai',
        f: 'complete_document',
      };

      setStudyData({
        condition: conditionMap[condition] || 'example_sentences',
        trueContext: [], // Would be loaded from task data
        falseContext: [], // Would be loaded from task data
        contextToUse: contextToUse || 'true',
        autoRefreshInterval: condition === 'n' || condition === 'f' ? undefined : 10000,
      });
    } else {
      setOverallMode(OverallMode.demo);
    }
  }, [searchParams, setOverallMode, setUsername, setStudyData]);

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">Writing Tools Editor</h1>
      </header>

      {/* Editor Area */}
      <div className="flex-1 flex">
        {/* Main Editor */}
        <div className="flex-1 p-6">
          <div className="max-w-4xl mx-auto">
            <div className="bg-white border border-gray-300 rounded-lg p-8 min-h-[600px] shadow-sm">
              <textarea
                className="w-full h-full resize-none focus:outline-none font-serif text-lg"
                placeholder="Start writing..."
              />
            </div>
          </div>
        </div>

        {/* Sidebar for suggestions */}
        <aside className="w-96 border-l border-gray-200 p-6 bg-gray-50">
          <h2 className="text-lg font-semibold mb-4">AI Suggestions</h2>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-gray-500 text-sm text-center">
              Start typing to get AI-powered suggestions
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
