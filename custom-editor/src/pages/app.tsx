import { useState } from 'react';

import Editor from '@/components/editor';
import Comment from '@/components/comment';

import classes from './styles.module.css';
import LogoutButton from '@/logout';
import LoginButton from '@/login';
import Profile from '@/profile';
import ProtectedRoute from '@/protectedRoute';
import { useAuth0 } from '@auth0/auth0-react';

export default function App() {
    const [comments, updateComments] = useState<Comment[]>([]); // TODO: Currently these are auto-created by the app, not the user

    const [focusedComment, updateFocusedComment] = useState<number>(-1); // The index of the comment that is currently focused

    const { isLoading, error } = useAuth0();

    return (
        <div className={ classes.container }>
            <div className={ classes.essayContainer }>
                <ProtectedRoute>
                <Editor
                    comment={ focusedComment >= 0 ? comments[focusedComment] : null }
                    commentIndex = { focusedComment }
                    updateComments={ updateComments }
                />
                </ProtectedRoute>

                <div className={ classes.cardsContainer }>
                    {
                        comments.map(
                            (card, index) => (
                                <Comment
                                    key={ index }
                                    commentIndex={ index }
                                    comment={ card }
                                    selected={ index === focusedComment }
                                    onClick={ updateFocusedComment }
                                />
                            )
                        )
                    }
                </div>
            </div>
            <main className="column">
                <h1>Auth0 Login</h1>
                { error && <p>Authentication Error</p> }
                { !error && isLoading && <p>Loading...</p> }
                { !error && !isLoading && (
                    <>
                        <LoginButton />
                        <LogoutButton />
                        <Profile />
                    </>
                ) }
            </main>
        </div>
    );
}
