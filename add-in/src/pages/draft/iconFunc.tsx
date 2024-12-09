import { AiOutlineAlignLeft, AiOutlineQuestion, AiOutlineHighlight } from 'react-icons/ai';

export const iconFunc = (generation_type: string) => {
    switch (generation_type) {
        case 'Completion':
            return<AiOutlineAlignLeft />;
        case 'Question':
            return <AiOutlineQuestion />;
        case 'Keywords':
            return <AiOutlineHighlight />;
    }
};

