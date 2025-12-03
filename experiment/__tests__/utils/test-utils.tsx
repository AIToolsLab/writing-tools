import { render, RenderOptions } from '@testing-library/react';
import { Provider } from 'jotai';
import { ReactElement } from 'react';

/**
 * Custom render that wraps component with Jotai Provider
 * Allows setting initial atom values for testing
 */
export function renderWithJotai(
  ui: ReactElement,
  options?: RenderOptions & {
    initialValues?: Array<[any, any]>;
  }
) {
  const { initialValues = [], ...renderOptions } = options || {};

  function Wrapper({ children }: { children: React.ReactNode }) {
    return <Provider initialValues={initialValues}>{children}</Provider>;
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

// Re-export everything from testing-library
export * from '@testing-library/react';
export { renderWithJotai as render };
