import { render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactElement } from 'react';

import type { RenderOptions } from '@testing-library/react';

/**
 * Custom render that wraps component with Jotai Provider
 * Allows setting initial atom values for testing
 */
export function renderWithJotai(
  ui: ReactElement,
  options?: RenderOptions & {
    initialValues?: Array<[unknown, unknown]>;
  }
) {
  const { initialValues = [], ...renderOptions } = options || {};

  // Create a fresh store for each test
  const store = createStore();

  // Set initial values on the store
  initialValues.forEach(([atom, value]: [unknown, unknown]) => {
    store.set(atom as Parameters<typeof store.set>[0], value);
  });

  // Pass the Provider as `wrapper`, not wrapped around `ui`: rerender() keeps the
  // wrapper but replaces the whole element, so a hand-wrapped tree loses its
  // Provider on rerender and the component remounts with fresh state.
  return render(ui, {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    ...renderOptions,
  });
}

// Re-export everything from testing-library
export * from '@testing-library/react';
