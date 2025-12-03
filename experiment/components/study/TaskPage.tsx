'use client';

import { useSearchParams } from 'next/navigation';
import { useRef } from 'react';
import type { WritingAreaRef } from '@/components/WritingArea';
import type { TextEditorState } from '@/types';
import AIPanel from '@/components/AIPanel';
import ChatPanel from '@/components/ChatPanel';
import WritingArea from '@/components/WritingArea';
import { log } from '@/lib/logging';
import { letterToCondition } from '@/lib/studyConfig';

export default function TaskPage() {
  const searchParams = useSearchParams();
  const writingAreaRef = useRef<WritingAreaRef>(null);
  const username = searchParams.get('username') || '';
  const conditionCode = (searchParams.get('condition') || 'n') as keyof typeof letterToCondition; // TODO: don't default!
  const condition = letterToCondition[conditionCode];
  const autoRefreshInterval = parseInt(searchParams.get('autoRefreshInterval') || '', 10) || 15000;

  const handleSendTask = async (content: string) => {
    // Log task completion
    await log({
      username,
      event: 'taskComplete',
      extra_data: {
        wordCount: content.split(/\s+/).length,
        documentLength: content.length,
      },
    });

    // Navigate to post-task survey
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', 'post-task-survey');
    window.location.href = `/study?${params.toString()}`;
  };

  const handleDocumentUpdate = async (editorState: TextEditorState) => {
    const fullContent = editorState.beforeCursor + editorState.selectedText + editorState.afterCursor;
    await log({
      username,
      event: 'documentUpdate',
      extra_data: {
        editorState,
        wordCount: fullContent.split(/\s+/).length,
        documentLength: fullContent.length,
      },
    });
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left column - Writing Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          <WritingArea
            ref={writingAreaRef}
            onSend={handleSendTask}
            onUpdate={handleDocumentUpdate}
            showSendButton={true}
          />
        </div>

        {/* Right column - Chat and AI panels */}
        <div className="w-96 flex flex-col border-l border-gray-300 overflow-hidden">
          {/* Chat panel - top portion */}
          <div className="flex-1 overflow-hidden border-b border-gray-300">
            <ChatPanel />
          </div>

          {/* AI panel - bottom portion (only if not no_ai condition) */}
          {condition !== 'no_ai' && (
            <div className="flex-1 overflow-hidden">
              <AIPanel
                writingAreaRef={writingAreaRef}
                mode={condition}
                autoRefreshInterval={autoRefreshInterval}
                isStudyMode={true}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
