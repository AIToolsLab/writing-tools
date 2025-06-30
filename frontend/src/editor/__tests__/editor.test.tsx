/**
 * Test to validate that the editor renders with Tailwind classes instead of CSS modules
 */
import { render } from '@testing-library/react';
import React from 'react';
import LexicalEditor from '../editor';

// Mock the required dependencies
jest.mock('@/api', () => ({
  log: jest.fn(),
}));

jest.mock('@/contexts/pageContext', () => ({
  overallModeAtom: {},
  pageNameAtom: {},
}));

jest.mock('@/contexts/userContext', () => ({
  usernameAtom: {},
}));

jest.mock('jotai', () => ({
  useAtomValue: jest.fn(() => 'editor'),
}));

describe('LexicalEditor with Tailwind', () => {
  const mockUpdateDocContext = jest.fn();
  
  it('should render with Tailwind classes instead of CSS modules', () => {
    const { container } = render(
      <LexicalEditor
        updateDocContext={mockUpdateDocContext}
        initialState={null}
      />
    );

    // Check that the editor container has Tailwind classes
    const editorContainer = container.querySelector('.m-5.bg-white.text-black');
    expect(editorContainer).toBeInTheDocument();

    // Check that the inner editor has Tailwind classes
    const innerEditor = container.querySelector('.resize-none.text-base.relative.outline-none');
    expect(innerEditor).toBeInTheDocument();

    // Check that placeholder has Tailwind classes
    const placeholder = container.querySelector('.text-gray-500.overflow-hidden.absolute');
    expect(placeholder).toBeInTheDocument();
  });

  it('should not contain CSS module class references', () => {
    const { container } = render(
      <LexicalEditor
        updateDocContext={mockUpdateDocContext}
        initialState={null}
      />
    );

    // Ensure no CSS module class names are present
    expect(container.innerHTML).not.toContain('editorContainer');
    expect(container.innerHTML).not.toContain('editor_');
    expect(container.innerHTML).not.toContain('placeholder_');
    expect(container.innerHTML).not.toContain('paragraph_');
  });

  it('should apply custom scrollbar class', () => {
    const { container } = render(
      <LexicalEditor
        updateDocContext={mockUpdateDocContext}
        initialState={null}
      />
    );

    const scrollableDiv = container.querySelector('.editor-scrollbar');
    expect(scrollableDiv).toBeInTheDocument();
  });
});