import { type PropsWithChildren, createContext } from 'react';

// Provides editor API functionality through context
export const EditorContext = createContext<EditorAPI>({
  doLogin: async () => {},
  doLogout: async () => {},
  getDocContext: () => (new Promise<DocContext>(resolve => resolve({
    beforeCursor: '',
    selectedText: '',
    afterCursor: ''
  }))),
  addSelectionChangeHandler: () => {},
  removeSelectionChangeHandler: () => {}
});

export default function EditorContextWrapper({
  children,
  editorAPI
}: PropsWithChildren<{ editorAPI: EditorAPI }>) {
  return (
    <EditorContext.Provider value={ editorAPI }>
      { children }
    </EditorContext.Provider>
  );
}
