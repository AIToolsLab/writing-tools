import {
	AiOutlineAim,
	AiOutlineAlignLeft,
	AiOutlineAudit,
} from 'react-icons/ai';

export const iconFunc = (generationType: string) => {
	if (generationType.includes('example')) {
		return <AiOutlineAlignLeft />;
	}
	if (generationType.includes('analysis')) {
		return <AiOutlineAudit />;
	}
	if (generationType.includes('proposal')) {
		return <AiOutlineAim />;
	}
	return null;
};
