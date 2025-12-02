'use client';

import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import type { TextEditorState } from '@/types';

export interface WritingAreaRef {
  getEditorState: () => TextEditorState;
}

const WritingArea = forwardRef<WritingAreaRef>(function WritingArea(_, ref) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const getEditorState = (): TextEditorState => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return { beforeCursor: '', selectedText: '', afterCursor: '' };
    }

    const text = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    return {
      beforeCursor: text.slice(0, start),
      selectedText: text.slice(start, end),
      afterCursor: text.slice(end),
    };
  };

  useImperativeHandle(ref, () => ({
    getEditorState,
  }));

  return (
    <div className="flex-1 bg-white border border-gray-300 rounded flex flex-col shadow-sm">
      <div className="border-b border-gray-200 p-4 bg-gray-50">
        <div className="flex mb-2 text-sm">
          <label className="w-16 text-gray-600 font-medium">To:</label>
          <input
            type="text"
            className="flex-1 border border-gray-300 px-2 py-1 rounded text-sm"
            value="Jaden Thompson <jaden.t@example.com>"
            readOnly
          />
        </div>
        <div className="flex mb-2 text-sm">
          <label className="w-16 text-gray-600 font-medium">From:</label>
          <input
            type="text"
            className="flex-1 border border-gray-300 px-2 py-1 rounded text-sm"
            value="you@company.com"
            readOnly
          />
        </div>
        <div className="flex text-sm">
          <label className="w-16 text-gray-600 font-medium">Subject:</label>
          <input
            type="text"
            className="flex-1 border border-gray-300 px-2 py-1 rounded text-sm"
            placeholder="Enter subject..."
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            autoFocus
          />
        </div>
      </div>
      <div className="flex-1 p-4 flex flex-col">
        <textarea
          ref={textareaRef}
          className="flex-1 border border-gray-200 p-2.5 resize-none text-sm rounded leading-relaxed focus:outline-none focus:border-green-500"
          placeholder="Write your message here..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
    </div>
  );
});

WritingArea.displayName = 'WritingArea';

export default WritingArea;
