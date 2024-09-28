import { type PropsWithChildren, createContext, useState } from 'react';

const usernameFromQuery = new URLSearchParams(window.location.search).get('username') || '';

export const UserContext = createContext<{
	username: string;
	updateUsername: (username: string) => void;
}>({
	username: usernameFromQuery,
	updateUsername: (_username: string) => {}
});

export default function UserContextWrapper({
	children
}: PropsWithChildren<any>) {
	const [username, updateUsername] = useState(usernameFromQuery);

	return (
		<UserContext.Provider value={ { username, updateUsername } }>
			{ children }
		</UserContext.Provider>
	);
}
