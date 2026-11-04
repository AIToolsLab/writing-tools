'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { WritingAreaRef } from '@/components/WritingArea';
import type { ConversationMessage, TextEditorState } from '@/types';
import AIPanel from '@/components/AIPanel';
import ChatPanel from '@/components/ChatPanel';
import WritingArea from '@/components/WritingArea';
import { log, logThenRedirect } from '@/lib/logging';
import { letterToCondition } from '@/lib/studyConfig';
import { useAtomValue } from 'jotai';
import { studyParamsAtom } from '@/contexts/StudyContext';
import { useNextPageUrl } from './useNextPage';

export default function TaskPage() {
  const studyParams = useAtomValue(studyParamsAtom);
  const nextUrl = useNextPageUrl();
  const writingAreaRef = useRef<WritingAreaRef>(null);
  const username = studyParams.username;
  const conditionCode = studyParams.condition;
  const condition = letterToCondition[conditionCode];

  // Conversation history for AI assistant
  const [chatConversation, setChatConversation] = useState<ConversationMessage[]>([]);
  const handleConversationChange = useCallback((conversation: ConversationMessage[]) => {
    setChatConversation(conversation);
  }, []);

  // Warn before an accidental reload or back navigation (e.g. a trackpad
  // swipe or Alt+Left) discards the draft and chat. Browsers only show the
  // prompt once the participant has interacted with the page.
  const isSendingRef = useRef(false);
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isSendingRef.current) return;
      event.preventDefault();
      event.returnValue = ''; // older browsers
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const handleSendTask = async (content: string, subject: string) => {
    isSendingRef.current = true;
    await logThenRedirect({
      username,
      event: 'taskComplete',
      extra_data: {
        finalText: content,
        subject,
        wordCount: content.split(/\s+/).length,
        documentLength: content.length,
      },
    }, nextUrl);
  };

  const handleDocumentUpdate = (editorState: TextEditorState, subject: string) => {
    const fullContent = editorState.beforeCursor + editorState.selectedText + editorState.afterCursor;
    log({
      username,
      event: 'documentUpdate',
      extra_data: {
        editorState,
        subject,
        wordCount: fullContent.split(/\s+/).length,
        documentLength: fullContent.length,
      },
    });
  };

  return (
    <div className="flex h-screen gap-5 p-10 bg-gray-100 overflow-hidden">
      {/* Left side - Colleague chat in sidebar */}
      <div className="flex flex-col w-110 border border-gray-300 rounded overflow-hidden shadow-sm bg-white">
        <ChatPanel onConversationChange={handleConversationChange} />
      </div>

      {/* Center - Writing Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <WritingArea
          ref={writingAreaRef}
          onSend={handleSendTask}
          onUpdate={handleDocumentUpdate}
          showSendButton={true}
        />
      </div>

      {/* Right side - AI Panel in sidebar (only for non-no_ai conditions) */}
      {condition !== 'no_ai' && (
        <div className="flex flex-col gap-2.5 w-110 border border-gray-300 rounded overflow-hidden shadow-sm bg-white">
          <AIPanel
            writingAreaRef={writingAreaRef}
            isStudyMode={true}
            chatConversation={studyParams.conversationHistory ? chatConversation : undefined}
          />
        </div>
      )}
    </div>
  );
}
