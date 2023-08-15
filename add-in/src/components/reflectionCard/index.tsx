import * as React from 'react';
import { Spinner } from '@fluentui/react/lib/Spinner';
import classes from './styles.module.css';

interface ReflectionCardProps {
    cardData: CardData;
    className: string;
}

interface ReflectionCardsProps {
    cardDataList: CardData[];
    toggleCardHighlight: boolean;
}

const handlePinAction = handleThumbsUpAction;

async function handleThumbsUpAction(
    paragraphIndex: number,
    comment: string
): Promise<void> {
    await Word.run(async (context: Word.RequestContext) => {
        // Retrieve and load all the paragraphs from the Word document
        const paragraphs: Word.ParagraphCollection =
            context.document.body.paragraphs;
        paragraphs.load();
        await context.sync();

        // Insert the reflection as a comment to the releated paragraph
        const target: Word.Paragraph = paragraphs.items[paragraphIndex];
        target.getRange('Start').insertComment(comment);
    });
}

// TODO: Might be useful in the future
async function handleThumbsDownAction(paragraphIndex: number): Promise<void> {
    await Word.run(async (context: Word.RequestContext) => {
        // Retrieve and load all the paragraphs from the Word document
        const paragraphs: Word.ParagraphCollection =
            context.document.body.paragraphs;
        paragraphs.load();
        await context.sync();

        // Let the user know that the thumbs-down feedback has been collected
        // as a comment to the related paragraph
        const target: Word.Paragraph = paragraphs.items[paragraphIndex];
        target.getRange('End').insertComment('Feedback collected.');
    });
}

async function toggleParagraphHighlight(
    paragraphIndex: number,
    needsHighlight: boolean
): Promise<void> {
    await Word.run(async (context: Word.RequestContext): Promise<void> => {
        // Retrieve and load all the paragraphs from the Word document
        const paragraphs: Word.ParagraphCollection =
            context.document.body.paragraphs;
        paragraphs.load();
        await context.sync();

        // Retrieve and load the paragraph to highlight
        const target: Word.Paragraph = paragraphs.items[paragraphIndex];
        target.load('font');
        await context.sync();

        // Highlight the paragraph if it needs highlight
        target.font.highlightColor = needsHighlight ? '#FFFF00' : '#FFFFFF';
    });
}

function ReflectionCard(props: ReflectionCardProps) {
    const { cardData, className } = props;

    const handleMouseEnter = () => {
        toggleParagraphHighlight(cardData.paragraphIndex, true);
    };

    const handleMouseLeave = () => {
        toggleParagraphHighlight(cardData.paragraphIndex, false);
    };

    return (
        <div
            className={className}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div className={classes.text}>{cardData.body}</div>
            <div>
                <button
                    className={classes.pinButton}
                    onClick={() =>
                        handlePinAction(cardData.paragraphIndex, cardData.body)
                    }
                >
                    Pin
                </button>
            </div>
        </div>
    );
}

export function ReflectionCards(props: ReflectionCardsProps) {
    const { cardDataList, toggleCardHighlight } = props;

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
                        className={
                            toggleCardHighlight
                                ? classes.toggleCardHighlight
                                : classes.card
                        }
                    />
                ))
            )}
        </div>
    );
}
