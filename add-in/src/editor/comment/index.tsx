import { GrClose } from 'react-icons/gr';

import classes from './styles.module.css';

type CommentProps = {
    commentIndex: number;
    comment: TextComment;
    selected: boolean;
    onClick: (_: number) => void;
    onDelete?: () => void; // TODO: Make non-optional
}

export default function Comment(props: CommentProps) {
    return (
        <div
            className={
                `${ classes.container }
                ${ props.selected && classes.selected }`
            }
            onClick={
                () => props.onClick(!props.selected ? props.commentIndex : -1)
            }
        >
            <div className={ classes.header }>
                <h1>{ props.comment.title }</h1>

                <GrClose
                    onClick={ props.onDelete }
                    fontSize={ 20 }
                    className={ classes.closeBtn }
                />
            </div>

            <div onClick={ props.onDelete } className={ classes.cardContent }>
                <p>{ props.comment.content }</p>
            </div>
        </div>
    );
}
