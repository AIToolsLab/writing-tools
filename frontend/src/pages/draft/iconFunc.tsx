import {
	AiOutlineAim,
	AiOutlineAlignLeft,
	AiOutlineAudit,
} from 'react-icons/ai';

export const iconFunc = (generationType: string) => {
	switch (generationType) {
		case 'example_sentences':
			return <AiOutlineAlignLeft />;
		case 'analysis_describe':
			return <AiOutlineAudit />;
		case 'proposal_advice':
			return <AiOutlineAim />;
		default:
			return null;
	}
};
