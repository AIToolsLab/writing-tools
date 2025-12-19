'use client';

import { useState } from 'react';
import { useAtom } from 'jotai';
import { pageNameAtom } from '@/lib/atoms';
import { PageName } from '@/lib/types';

/**
 * Main taskpane page with tab navigation
 * This is the entry point for the Office add-in
 */
export default function TaskpanePage() {
  const [currentPage, setCurrentPage] = useAtom(pageNameAtom);

  return (
    <div className="h-screen flex flex-col">
      {/* Navigation Tabs */}
      <nav className="bg-blue-600 text-white shadow-md">
        <div className="flex">
          <button
            onClick={() => setCurrentPage(PageName.Draft)}
            className={`flex-1 py-3 px-4 font-medium transition-colors ${
              currentPage === PageName.Draft
                ? 'bg-blue-700'
                : 'hover:bg-blue-500'
            }`}
          >
            Draft
          </button>
          <button
            onClick={() => setCurrentPage(PageName.Chat)}
            className={`flex-1 py-3 px-4 font-medium transition-colors ${
              currentPage === PageName.Chat
                ? 'bg-blue-700'
                : 'hover:bg-blue-500'
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setCurrentPage(PageName.Revise)}
            className={`flex-1 py-3 px-4 font-medium transition-colors ${
              currentPage === PageName.Revise
                ? 'bg-blue-700'
                : 'hover:bg-blue-500'
            }`}
          >
            Revise
          </button>
        </div>
      </nav>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {currentPage === PageName.Draft && <DraftPage />}
        {currentPage === PageName.Chat && <ChatPage />}
        {currentPage === PageName.Revise && <RevisePage />}
      </div>
    </div>
  );
}

function DraftPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Draft Mode</h2>
      <p className="text-gray-700 mb-4">
        Get AI-powered suggestions for your next sentence as you write.
      </p>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800">
          💡 Place your cursor in the document and click "Get Suggestions" to receive
          three possible next sentences.
        </p>
      </div>
      <button className="mt-6 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
        Get Suggestions
      </button>
    </div>
  );
}

function ChatPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Chat Mode</h2>
      <p className="text-gray-700 mb-4">
        Have a conversation with your AI writing assistant.
      </p>
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 h-64 overflow-y-auto">
        <p className="text-gray-500 text-center mt-12">
          No messages yet. Start a conversation!
        </p>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Type your message..."
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          Send
        </button>
      </div>
    </div>
  );
}

function RevisePage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Revise Mode</h2>
      <p className="text-gray-700 mb-4">
        Analyze and visualize your document structure.
      </p>
      <div className="space-y-3">
        <button className="w-full px-6 py-3 bg-white border-2 border-gray-300 rounded-lg hover:border-blue-500 transition-colors text-left">
          <div className="font-medium">Hierarchical Outline</div>
          <div className="text-sm text-gray-600">Generate an outline of your document</div>
        </button>
        <button className="w-full px-6 py-3 bg-white border-2 border-gray-300 rounded-lg hover:border-blue-500 transition-colors text-left">
          <div className="font-medium">Possible Structures</div>
          <div className="text-sm text-gray-600">Explore alternative document structures</div>
        </button>
        <button className="w-full px-6 py-3 bg-white border-2 border-gray-300 rounded-lg hover:border-blue-500 transition-colors text-left">
          <div className="font-medium">Reader Questions</div>
          <div className="text-sm text-gray-600">What might a reader ask about your document?</div>
        </button>
      </div>
    </div>
  );
}
