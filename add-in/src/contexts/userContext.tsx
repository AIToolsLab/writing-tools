import { type PropsWithChildren, createContext, useState } from 'react';

export const UserContext = createContext<{
	username: string;
	updateUsername: (username: string) => void;
}>({
	username: '',
	updateUsername: (_username: string) => {}
});

export default function UserContextWrapper({
	children
}: PropsWithChildren<any>) {
	const [username, updateUsername] = useState('');

	return (
		<UserContext.Provider value={ { username, updateUsername } }>
			{ children }
		</UserContext.Provider>
	);
}
