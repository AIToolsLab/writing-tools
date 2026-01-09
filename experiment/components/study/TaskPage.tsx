'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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

  // Collapsible chat state
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);

  // Auto-expand chat after a short delay so participants see Sarah's messages
  useEffect(() => {
    const delayTime = 1000; // 1 second
    const timer = setTimeout(() => {
      setIsChatOpen(true);
    }, delayTime);

    return () => clearTimeout(timer);
  }, []);

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
    <div className="flex h-screen gap-5 p-10 bg-gray-100 overflow-hidden relative">
      {/* Left side - Writing Area with floating chat */}
      <div className="relative flex-1 flex flex-col min-w-0">
        <WritingArea
          ref={writingAreaRef}
          onSend={handleSendTask}
          onUpdate={handleDocumentUpdate}
          showSendButton={true}
        />

        {/* Collapsible Chat Window - floating over WritingArea */}
        <div className="absolute bottom-0 right-8 z-50 flex flex-col items-end pointer-events-none">
          <div
            className={`rounded-t-lg bg-white border border-gray-300 pointer-events-auto flex flex-col transition-all duration-300 ease-in-out ${
              isChatOpen ? 'w-[450px] h-[650px]' : 'w-[350px] h-12'
            }`}
          >
            {/* Window Header (Tab) */}
            <div
              className={`h-12 flex items-center justify-between px-4 select-none transition-colors rounded-t-lg ${
                isChatOpen ? 'bg-gray-50 border-b border-gray-300' : 'bg-white'
              }`}
            >
              {isChatOpen ? (
                <>
                  <div className="flex items-center gap-2 font-semibold text-gray-700 text-sm">
                    <span>Chat with Sarah</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsChatOpen(false)}
                    className="p-1 hover:bg-gray-200 rounded cursor-pointer text-gray-500"
                    aria-label="Minimize chat"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setHasUnread(false);
                    setIsChatOpen(true);
                  }}
                  className="flex-1 flex items-center justify-between hover:bg-gray-50 -mx-4 px-4 h-full cursor-pointer rounded-t-lg"
                  aria-label="Open chat with Sarah"
                >
                  <div className="flex items-center gap-2 font-semibold text-gray-700 text-sm">
                    <span>Chat with Sarah</span>
                    {hasUnread && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm">
                        1
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-gray-500">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  </div>
                </button>
              )}
            </div>

            {/* Window Body */}
            <div className={`flex-1 overflow-hidden bg-white ${isChatOpen ? 'block' : 'hidden'}`}>
              <ChatPanel
                onNewMessage={() => {
                  if (!isChatOpen) {
                    setHasUnread(true);
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Right side - AI Panel in sidebar (only for non-no_ai conditions) */}
      {condition !== 'no_ai' && (
        <div className="flex flex-col gap-2.5 w-110 border border-gray-300 rounded overflow-hidden shadow-sm bg-white">
          <AIPanel writingAreaRef={writingAreaRef} isStudyMode={true} />
        </div>
      )}
    </div>
  );
}
