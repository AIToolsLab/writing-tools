import { AiOutlineAlignLeft, AiOutlineQuestion, AiOutlineHighlight } from 'react-icons/ai';

export const iconFunc = (generationType: string) => {
    switch (generationType) {
        case 'Completion':
            return<AiOutlineAlignLeft />;
        case 'Question':
            return <AiOutlineQuestion />;
        case 'Keywords':
            return <AiOutlineHighlight />;
    }
};

