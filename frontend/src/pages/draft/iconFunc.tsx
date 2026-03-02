import {
	AiOutlineAim,
	AiOutlineAlignLeft,
	AiOutlineAudit,
	AiOutlineRetweet,
} from 'react-icons/ai';
import type { IconType } from 'react-icons';

export const iconFunc = (generationType: string): IconType | undefined => {
	if (generationType.includes('rewording')) {
		return AiOutlineRetweet;
	}
	if (generationType.includes('example')) {
		return AiOutlineAlignLeft;
	}
	if (generationType.includes('analysis')) {
		return AiOutlineAudit;
	}
	if (generationType.includes('proposal')) {
		return AiOutlineAim;
	}
	return undefined;
};
