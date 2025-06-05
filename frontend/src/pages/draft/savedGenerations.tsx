import classes from './styles.module.css';
import { AiOutlineStar, 
    AiOutlineUp, 
    AiOutlineDown, 
    AiOutlineClose, 
} from 'react-icons/ai';

import { Remark } from 'react-remark';
import { iconFunc } from './iconFunc';



export default function SavedGenerations({ 
    savedItems, 
    deleteSavedItem,
}: { 
    savedItems: SavedItem[],
    deleteSavedItem: (dateSaved: Date) => void,
}) {

function GenerationResult({ generation }: { generation: GenerationResult }) {
	return <Remark>{ generation.result }</Remark>;
}


    return (
        <div className={ classes.historyContainer }>


            <div className={ classes.historyItemContainer }>

                { /* can we use || ? */ }

                { savedItems.length === 0 ? (
                    <div className={ classes.historyEmptyWrapper }>
                        <div className={ classes.historyText }>
                            No saved generations... 
                        </div>
                    </div>
                ) : (
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
