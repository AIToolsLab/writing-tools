import { useState } from 'react';

import Editor from '@/components/editor';
import Comment from '@/components/comment';

import classes from './styles.module.css';

export default function App() {
    const [comments, updateComments] = useState<Comment[]>([]); // TODO: Currently these are auto-created by the app, not the user

    const [focusedComment, updateFocusedComment] = useState<number>(-1); // The index of the comment that is currently focused

    return (
        <div className={ classes.container }>
            <div className={ classes.essayContainer }>
                <Editor
                    comment={ focusedComment >= 0 ? comments[focusedComment] : null }
                    commentIndex = { focusedComment }
                    updateComments={ updateComments }
                />

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
        </div>
    );
}
