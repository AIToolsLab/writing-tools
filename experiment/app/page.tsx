'use client';

import { useRef } from 'react';
import WritingArea from '@/components/WritingArea';
import ChatPanel from '@/components/ChatPanel';
import AIPanel from '@/components/AIPanel';
import type { WritingAreaRef } from '@/components/WritingArea';

export default function Home() {
  const writingAreaRef = useRef<WritingAreaRef>(null);

  return (
    <div className="flex h-screen gap-2.5 p-2.5 bg-gray-100">
      <WritingArea ref={writingAreaRef} />
      <div className="flex flex-col gap-2.5 w-80">
        <ChatPanel />
        <AIPanel writingAreaRef={writingAreaRef} />
      </div>
    </div>
  );
}
