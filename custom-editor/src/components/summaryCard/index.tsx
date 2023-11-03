import { GrClose } from 'react-icons/gr';

import classes from './styles.module.css';

type SummaryCardProps = {
    cardIndex: number;
    card: Card;
    onDelete?: () => void; // ! Make non-optional
    onClick: (_: number | null) => void;
    selected: boolean;
}

export default function SummaryCard(props: SummaryCardProps) {
    return (
        <div className={ `${ classes.container } ${ props.selected && classes.selected }` } onClick={ () => props.onClick(!props.selected ? props.cardIndex : null) }>
            <div className={ classes.header }>
                <h1>{ props.card.title }</h1>

                <GrClose onClick={ props.onDelete } fontSize={ 20 } className={ classes.closeBtn } />
            </div>

            <div onClick={ props.onDelete } className={ classes.cardContent }>
                <p>{ props.card.summary }</p>
            </div>
        </div>
    );
}
