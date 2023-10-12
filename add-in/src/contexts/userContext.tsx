import { createContext, useState } from 'react';

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
}
