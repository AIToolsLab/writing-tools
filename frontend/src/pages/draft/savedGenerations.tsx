import classes from './styles.module.css';
import { AiOutlineStar, 
    AiOutlineUp, 
    AiOutlineDown, 
    AiOutlineClose, 
} from 'react-icons/ai';

import { Remark } from 'react-remark';
import { iconFunc } from './iconFunc';
import { useState } from 'react';



export default function SavedGenerations({ 
    docContext,  
    saved, 
    isLoading,
    savedItems, 
    deleteSavedItem,
}: { 
    docContext: DocContext, 
    saved: boolean, 
    isLoading: boolean 
    savedItems: SavedItem[],
    deleteSavedItem: (dateSaved: Date) => void,
}) {
    const [isSavedOpen, setSavedOpen] = useState(false);

function GenerationResult({ generation }: { generation: GenerationResult }) {
	return <Remark>{ generation.result }</Remark>;
}


    return (
        <div className={ classes.historyContainer }>
            <div className={ classes.historyButtonWrapper }>
                <button
                    className={ classes.historyButton }
                    disabled={ docContext.beforeCursor === '' || isLoading }
                    onClick={ () => {
                        // Toggle between the current page and the saved page
                        setSavedOpen(!isSavedOpen);
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
                            <AiOutlineUp className={ classes.savedPageIconIndicator } />
                        ) : (
                            <AiOutlineDown className={ classes.savedPageIconIndicator } />
                        ) }
                    </div>
                    { isSavedOpen && (
                    <div className={ classes.savedPageTooltip }>
                        Show Saved Items
                    </div>
                    ) }
                    { !isSavedOpen && (
                    <div className={ classes.savedPageTooltip }>
                        Hide Saved Items
                    </div>
                    ) }
                </button>

            </div>

            <div className={ classes.historyItemContainer }>

                { /* can we use || ? */ }

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
                                <p className={ classes.historyDoc }  
                                onClick={ () => { 
                                    // Show the whole document text
                                } }     >
                                    ...
                                    { savedItem.document.substring(savedItem.document.length - 100    ) }
                                </p>

                                <GenerationResult generation={ savedItem.generation } />
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
                                        classes.genTypeIconWrapper
                                    }
                                >
                                    { iconFunc(savedItem.generation.generation_type) }
                                </div>
                            </div>
                        </div>
                    ))
                ) }
            </div>
        </div>

    );
}
