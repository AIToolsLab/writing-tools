import React from 'react';
import Remark from 'react-remark';
import classes from './styles.module.css';

interface ReflectionCardProps {
  cardData: { body: string; paragraphIndex: number };
  className?: string;
}

function ReflectionCard(props: ReflectionCardProps) {
  const { cardData, className } = props;

  async function handlePinAction(paragraphIndex: number, body: string) {
    // existing pin logic (left as-is)
  }

  return (
    <div className={`${className ?? ''} flex flex-row justify-between items-start gap-2 p-2 rounded-md border border-gray-400`}>
      <div className={`${classes.text} flex-1`}>
        <Remark>{cardData.body}</Remark>
      </div>

      <div>
        <button
          className={`${classes.pinButton} px-2 py-1 rounded hover:bg-gray-100`}
          onClick={() => {
            void handlePinAction(cardData.paragraphIndex, cardData.body);
          }}
        >
          Pin
        </button>
      </div>
    </div>
  );
}

export default ReflectionCard;
export { ReflectionCard };