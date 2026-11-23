import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, act } from '@testing-library/react';
import WritingArea, { type WritingAreaRef } from '@/components/WritingArea';
import { renderWithJotai } from '../utils/test-utils';

function setup() {
  const ref = createRef<WritingAreaRef>();
  const onUpdate = vi.fn();
  renderWithJotai(<WritingArea ref={ref} onUpdate={onUpdate} />);
  const textarea = screen.getByPlaceholderText('Write your message here...') as HTMLTextAreaElement;
  return { ref, onUpdate, textarea };
}

describe('WritingArea document context', () => {
  it('starts with empty context', () => {
    const { ref } = setup();
    expect(ref.current?.getEditorState()).toEqual({ beforeCursor: '', selectedText: '', afterCursor: '' });
  });

  it.each([
    [0, 0, '', '', 'Hello\nworld'],
    [5, 5, 'Hello', '', '\nworld'],
    [6, 11, 'Hello\n', 'world', ''],
    [0, 11, '', 'Hello\nworld', ''],
    [11, 11, 'Hello\nworld', '', ''],
  ])('reads the current selection %i–%i without requiring another keystroke', (start, end, before, selected, after) => {
    const { ref, textarea } = setup();
    fireEvent.change(textarea, { target: { value: 'Hello\nworld' } });
    textarea.setSelectionRange(start as number, end as number);
    expect(ref.current?.getEditorState()).toEqual({ beforeCursor: before, selectedText: selected, afterCursor: after });
  });

  it('reports inserted text and the new cursor position with the latest subject', () => {
    const { ref, textarea, onUpdate } = setup();
    fireEvent.change(screen.getByLabelText('Subject:'), { target: { value: 'Library hours' } });
    fireEvent.change(textarea, { target: { value: 'Hello world' } });
    fireEvent.change(textarea, { target: { value: 'Hello new world', selectionStart: 10, selectionEnd: 10 } });
    const expected = { beforeCursor: 'Hello new ', selectedText: '', afterCursor: 'world' };
    expect(onUpdate).toHaveBeenLastCalledWith(expected, 'Library hours');
    expect(ref.current?.getEditorState()).toEqual(expected);
  });

  it('reports a replacement and keeps body text when the subject changes', () => {
    const { ref, textarea, onUpdate } = setup();
    fireEvent.change(textarea, { target: { value: 'Hello old world' } });
    textarea.setSelectionRange(6, 9);
    fireEvent.change(textarea, { target: { value: 'Hello new world', selectionStart: 9, selectionEnd: 9 } });
    fireEvent.change(screen.getByLabelText('Subject:'), { target: { value: 'Updated' } });
    expect(onUpdate).toHaveBeenLastCalledWith({ beforeCursor: 'Hello new', selectedText: '', afterCursor: ' world' }, 'Updated');
    expect(ref.current?.getEditorState().selectedText).toBe('');
  });

  it('sends the current body and subject and prevents a duplicate while pending', async () => {
    let finish!: () => void;
    const onSend = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderWithJotai(<WritingArea onSend={onSend} showSendButton />);
    expect(screen.getByRole('button', { name: 'Send email' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Subject:'), { target: { value: 'Subject' } });
    fireEvent.change(screen.getByPlaceholderText('Write your message here...'), { target: { value: 'My draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
    expect(onSend).toHaveBeenCalledWith('My draft', 'Subject');
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sending...' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.getByRole('button', { name: 'Send email' })).toBeEnabled();
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
