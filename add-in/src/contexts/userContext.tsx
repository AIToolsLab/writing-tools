import { createContext, useState } from 'react';

<<<<<<< HEAD
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
=======
interface UserContextType {
  userId: string;
  updateUserId: (userId: string) => void;
}

export const UserContext = createContext<UserContextType>({
  userId: '',
  updateUserId: () => {},
});

export default function UserContextWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const [userId, setUserId] = useState('');

  const updateUserId = (newUserId: string) => {
    setUserId(newUserId);
  };

  return (
    <UserContext.Provider value={ { userId, updateUserId } }>
      { children }
    </UserContext.Provider>
  );
>>>>>>> 08b8b419002a8c2e55af13572447139c8dcaada4
}
