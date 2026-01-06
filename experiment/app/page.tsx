'use client';

import { useRef, useState } from 'react';
import WritingArea from '@/components/WritingArea';
import ChatPanel from '@/components/ChatPanel';
import AIPanel from '@/components/AIPanel';
import type { WritingAreaRef } from '@/components/WritingArea';

function ChatIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default function Home() {
  const writingAreaRef = useRef<WritingAreaRef>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);

  const [hasUnread, setHasUnread] = useState(false);

  return (
    <div className="flex h-screen gap-5 p-10 bg-gray-100 overflow-hidden relative">
      <div className="relative flex-1 flex flex-col min-w-0">
        <WritingArea ref={writingAreaRef} />
        
        {/* Collapsible Chat Window */}
        <div className="absolute bottom-0 right-8 z-50 flex flex-col items-end pointer-events-none">
          <div 
            className={`rounded-t-lg bg-white border border-gray-300 pointer-events-auto flex flex-col transition-all duration-300 ease-in-out ${
              isChatOpen ? 'w-[450px] h-[650px]' : 'w-[350px] h-12'
            }`}
          >
            {/* Window Header (Tab) */}
            <div 
              onClick={() => {
                if (!isChatOpen) {
                  setHasUnread(false);
                  setIsChatOpen(true);
                }
              }}
              className={`h-12 flex items-center justify-between px-4 select-none transition-colors rounded-t-lg ${
                 isChatOpen ? 'bg-gray-50 border-b border-gray-300 cursor-default' : 'bg-white hover:bg-gray-50 cursor-pointer'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-gray-700 text-sm">
                <span>Chat with Sarah</span>
                {hasUnread && !isChatOpen && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm">
                    1
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-gray-500">
                {isChatOpen ? (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsChatOpen(false);
                    }}
                    className="p-1 hover:bg-gray-200 rounded cursor-pointer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                )}
              </div>
            </div>

            {/* Window Body */}
            <div className={`flex-1 overflow-hidden bg-white ${isChatOpen ? 'block' : 'hidden'}`}>
              <ChatPanel onNewMessage={() => {
                if (!isChatOpen) {
                  setHasUnread(true);
                }
              }} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 w-110 border border-gray-300 rounded overflow-hidden shadow-sm bg-white">
        <AIPanel writingAreaRef={writingAreaRef} />
      </div>
    </div>
  );
}
