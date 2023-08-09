import * as React from 'react';
import { Spinner } from '@fluentui/react/lib/Spinner';
import classes from './styles.module.css';

interface CardData {
    paragraph: number;
    body: string;
}

interface ReflectionCardProps {
    key: React.Key;
    cardData: CardData;
    className: string;
    changeParagraphHighlightColor: (paragraph: number, color: string) => void;
    pinAction: () => void;
}

interface ReflectionCardContainerProps {
    cardDataList: CardData[];
    className: string;
    changeParagraphHighlightColor: (paragraph: number, color: string) => void;
    pinAction: () => void;
}

export function ReflectionCard(props: ReflectionCardProps) {
    const {
        key,
        cardData,
        className,
        changeParagraphHighlightColor,
        pinAction,
    } = props;

    const handleMouseEnter = () => {
        changeParagraphHighlightColor(cardData.paragraph, 'highlight');
    };

    const handleMouseLeave = () => {
        changeParagraphHighlightColor(cardData.paragraph, 'dehighlight');
    };

    return (
        <div
            key={key}
            className={className}
            id={classes.reflectionCard}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div>{cardData.body}</div>
            <div>
                <button onClick={pinAction}>Pin</button>
            </div>
        </div>
    );
}

export default function ReflectionCardContainer(
    props: ReflectionCardContainerProps
) {
    const {
        cardDataList,
        className,
        changeParagraphHighlightColor,
        pinAction,
    } = props;

    return (
        <div>
            {cardDataList.length === 0 ? (
                <div className={classes.spinner}>
                    <Spinner label="Loading..." labelPosition="right" />
                </div>
            ) : (
                cardDataList.map((cardData: CardData, index: number) => (
                    <ReflectionCard
                        key={index}
                        cardData={cardData}
                        className={className}
                        changeParagraphHighlightColor={
                            changeParagraphHighlightColor
                        }
                        pinAction={pinAction}
                    />
                ))
            )}
        </div>
    );
}
