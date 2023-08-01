import React, { type PropsWithChildren, createContext, useState } from 'react';

export const UserContext = createContext<
    {
        userId: number;
        updateUserId: (userId: number) => void;
    }
>(
    {
        userId: -1,
        updateUserId: (_userId: number) => {},
    }
);

export default function UserContextWrapper({ children }: PropsWithChildren<any>) {
    const [userId, updateUserId] = useState(-1);

    return (
        <UserContext.Provider value={{ userId, updateUserId }}>
            {children}
        </UserContext.Provider>
    );
}
