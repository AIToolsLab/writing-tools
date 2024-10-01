import classes from './styles.module.css';
import { AiOutlineStar, 
    AiOutlineUp, 
    AiOutlineDown, 
    AiOutlineClose, 
    AiOutlineQuestion, 
    AiOutlineHighlight, 
    AiOutlineAlignLeft,
    AiOutlineBank
} from 'react-icons/ai';

import ReactWordcloud from 'react-wordcloud';
import { Remark } from 'react-remark';





export default function SavedGenerations( 
    { 
        docContext, 
        isSavedOpen, 
        setSavedOpen, 
        saved, 
        isLoading, 
        tooltipVisible, 
        setTooltipVisible, 
        setCopyWarningTooltipVisible, 
        savedItems, 
        IS_OBSCURED,
        deleteSavedItem,
        USE_WORDCLOUD
    }: 
    { 
        docContext: string, 
        isSavedOpen: boolean, 
        setSavedOpen: (isSavedOpen: boolean) => void, 
        saved: boolean, 
        isLoading: boolean 
        tooltipVisible: string | null,
        setTooltipVisible: (tooltipVisible: string | null) => void,
        setCopyWarningTooltipVisible: (copyWarningTooltipVisible: boolean) => void,
        savedItems: SavedItem[],
        IS_OBSCURED: boolean,
        deleteSavedItem: (dateSaved: Date) => void,
        USE_WORDCLOUD: boolean,
    }  
    ) {


        // TODO: need to refactor this 
function GenerationResult({ generation }: { generation: GenerationResult }) {
	if (USE_WORDCLOUD && generation.generation_type === 'Keywords') {
		// Show all keywords as a word cloud
		const keywords = generation.extra_data.words_by_pos;
		// Collect all of the words
		const words: string[] = [];
		for (const pos in keywords) {
			words.push(...keywords[pos]);
		}
		return (
			<ReactWordcloud
				words={ words.map(word => ({ text: word, value: 1 })) }
				options={ {
					rotations: 0
				} }
			/>
		);
	}
	return <Remark>{ generation.result }</Remark>;
}



    return (
        <div className={ classes.historyContainer }>
            <div className={ classes.historyButtonWrapper }>
                <button
                    className={ classes.historyButton }
                    disabled={ docContext.trim() === '' || isLoading }
                    onClick={ () => {
                        // Toggle between the current page and the saved page
                        setSavedOpen(!isSavedOpen);
                    } }
                    onMouseEnter={ () => setTooltipVisible('Saved') }
                    onMouseLeave={ () => {
                        setTooltipVisible(null);
                        setCopyWarningTooltipVisible(false);
                    } }
                >
                    <div
                        className={
                            classes.savedPageIconIndicatorContainer
                        }
                    >
                        <AiOutlineStar
                            className={
                                isSavedOpen || saved
                                    ? classes.savedPageIconActive
                                    : classes.savedPageIcon
                            }
                        />
                        { isSavedOpen ? (
                            <AiOutlineUp
                                className={
                                    classes.savedPageIconIndicator
                                }
                            />
                        ) : (
                            <AiOutlineDown
                                className={
                                    classes.savedPageIconIndicator
                                }
                            />
                        ) }
                    </div>
                </button>
                { tooltipVisible === 'Saved' &&
                    (!isSavedOpen ? (
                        <div className={ classes.savedPageTooltip }>
                            Show Saved Items
                        </div>
                    ) : (
                        <div className={ classes.savedPageTooltip }>
                            Hide Saved Items
                        </div>
                    )) }
            </div>

            <div className={ classes.historyItemContainer }>
                { isSavedOpen && savedItems.length === 0 ? (
                    <div className={ classes.historyEmptyWrapper }>
                        <div className={ classes.historyText }>
                            No saved generations...
                        </div>
                    </div>
                ) : (
                    isSavedOpen &&
                    savedItems.length !== 0 &&
                    savedItems.map((savedItem, index) => (
                        <div
                            key={ index }
                            className={ classes.historyItem }
                        >
                            <div className={ classes.historyText }>
                                <p
                                    className={ classes.historyDoc }
                                    onClick={ () => {
                                        // Show the whole document text
                                    } }
                                >
                                    ...
                                    { savedItem.document.substring(
                                        savedItem.document.length - 100
                                    ) }
                                </p>

                                <GenerationResult
                                    generation={ savedItem.generation }
                                />
                            </div>
                            <div
                                className={ classes.savedIconsContainer }
                            >
                                <div
                                    className={
                                        classes.historyCloseButtonWrapper
                                    }
                                    onClick={ () =>
                                        deleteSavedItem(
                                            savedItem.dateSaved
                                        )
                                    }
                                >
                                    <AiOutlineClose
                                        className={
                                            classes.historyCloseButton
                                        }
                                    />
                                </div>
                                <div
                                    className={
                                        !IS_OBSCURED
                                            ? classes.genTypeIconWrapper
                                            : classes.genTypeIconWrapper_obscured
                                    }
                                >
                                    { savedItem.generation
                                        .generation_type ===
                                        'Completion' ? (
                                        IS_OBSCURED ? (
                                            'a'
                                        ) : (
                                            <AiOutlineAlignLeft
                                                className={
                                                    classes.savedTypeIcon
                                                }
                                            />
                                        )
                                    ) : savedItem.generation
                                        .generation_type ===
                                        'Question' ? (
                                        IS_OBSCURED ? (
                                            'b'
                                        ) : (
                                            <AiOutlineQuestion
                                                className={
                                                    classes.savedTypeIcon
                                                }
                                            />
                                        )
                                    ) : savedItem.generation
                                        .generation_type ===
                                        'Keywords' ? (
                                        IS_OBSCURED ? (
                                            'c'
                                        ) : (
                                            <AiOutlineHighlight
                                                className={
                                                    classes.savedTypeIcon
                                                }
                                            />
                                        )
                                    ) : savedItem.generation
                                        .generation_type ===
                                        'RMove' ? (
                                        IS_OBSCURED ? (
                                            'd'
                                        ) : (
                                            <AiOutlineBank
                                                className={
                                                    classes.savedTypeIcon
                                                }
                                            />
                                        )
                                    ) : null }
                                </div>
                            </div>
                        </div>
                    ))
                ) }
            </div>
        </div>

    );
}
