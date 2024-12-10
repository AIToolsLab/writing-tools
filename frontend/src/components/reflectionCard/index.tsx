import classes from './styles.module.css';
import { Remark } from 'react-remark';

interface ReflectionCardProps {
	cardData: CardData;
	className: string;
}

interface ReflectionCardsProps {
	cardDataList: CardData[];
	isHighlighted: boolean;
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

function ReflectionCard(props: ReflectionCardProps) {
	const { cardData, className } = props;

	return (
		<div
			className={ className }
		>
			<div className={ classes.text }><Remark>{ cardData.body }</Remark></div>

			<div>
				<button
					className={ classes.pinButton }
					onClick={ () =>
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
	const { cardDataList, isHighlighted } = props;

	return (
		<div>
			{ cardDataList.length === 0 ? (
				<div className={ classes.spinnerWrapper }>
					<div className={ classes.loader }></div>
				</div>
			) : (
				cardDataList.map((cardData: CardData, index: number) => (
					<ReflectionCard
						key={ index }
						cardData={ cardData }
						className={
							isHighlighted
								? classes.isHighlighted
								: classes.card
						}
					/>
				))
			) }
		</div>
	);
}
