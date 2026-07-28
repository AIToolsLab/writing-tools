import { createRoot } from 'react-dom/client';

import DemoApp from './DemoApp';

// No StrictMode: the autoplay runs in an effect and we don't want it
// double-invoked in dev. The production build (what Playwright records) wouldn't
// double-invoke anyway.
const container = document.getElementById('container');
if (container) {
	createRoot(container).render(<DemoApp />);
}
