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

  return render(
    <Provider store={store}>{ui}</Provider>,
    renderOptions
  );
}

// Re-export everything from testing-library
export * from '@testing-library/react';
