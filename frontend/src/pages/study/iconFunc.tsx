import { AiOutlineAlignLeft, AiOutlineQuestion, AiOutlineHighlight, AiOutlineBank } from 'react-icons/ai';

export const iconFunc = (generationType: string) => {
    switch (generationType) {
        case 'Completion':
            return<AiOutlineAlignLeft />;
        case 'Question':
            return <AiOutlineQuestion />;
        case 'Keywords':
            return <AiOutlineHighlight />;
        case 'RMove':
            return <AiOutlineBank />;
        default:
            return null;
    }
};

