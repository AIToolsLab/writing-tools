'use client';

import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import { useAtomValue } from 'jotai';
import { studyParamsAtom } from '@/contexts/StudyContext';
import { getScenario } from '@/lib/studyConfig';
import type { TextEditorState } from '@/types';

export interface WritingAreaRef {
  getEditorState: () => TextEditorState;
}

interface WritingAreaProps {
  onSend?: (content: string) => Promise<void>;
  onUpdate?: (state: TextEditorState) => Promise<void>;
  showSendButton?: boolean;
}

const WritingArea = forwardRef<WritingAreaRef, WritingAreaProps>(
  function WritingArea(
    { onSend, onUpdate, showSendButton = false },
    ref
  ) {
    const studyParams = useAtomValue(studyParamsAtom);
    const scenario = getScenario(studyParams.scenario);

    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [isSending, setIsSending] = useState(false);
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

    const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newBody = e.target.value;
      setBody(newBody);
      if (onUpdate) {
        onUpdate(getEditorState()).catch((e) =>
          console.error('Failed to log document update:', e)
        );
      }
    };

    const handleSend = async () => {
      if (onSend) {
        setIsSending(true);
        try {
          await onSend(body);
        } catch (error) {
          console.error('Failed to send:', error);
        } finally {
          setIsSending(false);
        }
      }
    };

    return (
      <div className="flex-1 bg-white border border-gray-300 rounded flex flex-col shadow-sm overflow-hidden">
        <div className="border-b border-gray-200 p-4 bg-gray-50">
          <div className="flex mb-2 text-sm">
            <label htmlFor="to-field" className="w-16 text-gray-700 font-medium">To:</label>
            <input
              id="to-field"
              type="text"
              className="flex-1 border border-gray-300 px-2 py-1 rounded text-sm bg-white text-gray-900"
              value={`${scenario.recipient.name} <${scenario.recipient.email}>`}
              readOnly
            />
          </div>
          <div className="flex mb-2 text-sm">
            <label htmlFor="from-field" className="w-16 text-gray-700 font-medium">From:</label>
            <input
              id="from-field"
              type="text"
              className="flex-1 border border-gray-300 px-2 py-1 rounded text-sm bg-white text-gray-900"
              value="Me"
              readOnly
            />
          </div>
          <div className="flex text-sm">
            <label htmlFor="subject-field" className="w-16 text-gray-700 font-medium">Subject:</label>
            <input
              id="subject-field"
              type="text"
              className="flex-1 border border-gray-300 px-2 py-1 rounded text-sm bg-white text-gray-900 placeholder-gray-400"
              placeholder="Enter subject..."
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-hidden p-4 flex flex-col">
          <textarea
            ref={textareaRef}
            className="flex-1 border border-gray-200 p-2.5 resize-none text-sm rounded leading-relaxed focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-200 bg-white text-gray-900 placeholder-gray-400"
            placeholder="Write your message here..."
            value={body}
            onChange={handleBodyChange}
          />
        </div>
        {showSendButton && (
          <div className="border-t border-gray-200 p-4 bg-gray-50 flex gap-2">
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending || !body.trim()}
              className="flex-1 px-4 py-2 bg-green-600 text-white font-medium rounded hover:bg-green-700 active:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </div>
        )}
      </div>
    );
  }
);

WritingArea.displayName = 'WritingArea';

export default WritingArea;
