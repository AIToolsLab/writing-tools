'use client';

/**
 * Standalone demo page for AI writing assistance.
 * This page is NOT used in the study - see components/study/TaskPage.tsx for the study task page.
 */

import { useRef } from 'react';
import AIPanel from '@/components/AIPanel';
import WritingArea from '@/components/WritingArea';
import type { WritingAreaRef } from '@/components/WritingArea';

export default function Home() {
  const writingAreaRef = useRef<WritingAreaRef>(null);

  return (
    <div className="flex h-screen gap-5 p-10 bg-gray-100 overflow-hidden">
      {/* Left side - Writing Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <WritingArea ref={writingAreaRef} />
      </div>

      {/* Right side - AI Panel */}
      <div className="flex flex-col gap-2.5 w-110 border border-gray-300 rounded overflow-hidden shadow-sm bg-white">
        <AIPanel writingAreaRef={writingAreaRef} />
      </div>
    </div>
  );
}
