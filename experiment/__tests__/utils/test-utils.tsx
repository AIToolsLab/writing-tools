import { render } from '@testing-library/react';
import { Provider } from 'jotai';
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

  return render(
    <Provider initialValues={initialValues}>{ui}</Provider>,
    renderOptions
  );
}

// Re-export everything from testing-library
export * from '@testing-library/react';
