import { createRoot } from 'react-dom/client';

import VoiceSpike from './VoiceSpike';

const container = document.getElementById('container');
if (container) {
	createRoot(container).render(<VoiceSpike />);
}
