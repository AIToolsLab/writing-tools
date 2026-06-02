'use client';

import { useAtomValue } from 'jotai';
import { PageName, pageNameAtom } from '@/contexts/pageContext';
import Navbar from './Navbar';
import Chat from './pages/Chat';
import Draft from './pages/Draft';
import Revise from './pages/Revise';

function getComponent(pageName: PageName) {
	switch (pageName) {
		case PageName.Revise:
			return <Revise />;
		case PageName.Chat:
			return <Chat />;
		case PageName.Draft:
			return <Draft />;
	}
}

// The sidebar app: the tab bar plus the active panel. Surfaces (standalone / Word) supply
// the EditorContext that the panels read from.
export default function App() {
	const page = useAtomValue(pageNameAtom);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<Navbar />
			<div className="flex flex-1 flex-col overflow-y-auto">{getComponent(page)}</div>
		</div>
	);
}
