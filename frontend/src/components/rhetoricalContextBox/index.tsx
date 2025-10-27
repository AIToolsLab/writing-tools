import { useState } from 'react';
import { BsCheck2Circle } from 'react-icons/bs';

import classes from './styles.module.css';
import { handleAutoResize } from '@/utilities';

interface RhetoricalContextBoxProps {
	curRhetCtxt: string;
	updateRhetCtxt: (rhetCtxt: string) => void;
}

export function RhetoricalContextBox(
	props: RhetoricalContextBoxProps,
): JSX.Element {
	const { curRhetCtxt: _curRhetCtxt, updateRhetCtxt } = props;
	const [rhetCtxtSaved, updateRhetCtxtSaved] = useState(false);
	const [searchBoxText, updateSearchBoxText] = useState('');

	return (
		<div
			className={`${classes.rhetoricalSituation} flex flex-col w-full`}
		>
			<div className={classes.situationBoxLabel}>
				Rhetorical Situation:
			</div>

			{/* Wrapper adjusts underline visibility */}
			<div
				className={`flex flex-row items-center w-full mb-5 transition duration-150 ${
					searchBoxText === ''
						? classes.situationBoxWrapper
						: classes.situationBoxWrapperContent
				}`}
			>
				<textarea
					defaultValue=""
					value={searchBoxText}
					placeholder="Enter Rhetorical Situation..."
					onChange={(event) => {
						if (rhetCtxtSaved) updateRhetCtxtSaved(false);
						if (event.target.value.trim() === '') {
							updateSearchBoxText('');
							updateRhetCtxt('');
						} else updateSearchBoxText(event.target.value);
					}}
					ref={(ref) => ref && handleAutoResize(ref)}
					onKeyDown={(event) => {
						if (event.key === 'Enter' && !event.shiftKey) {
							event.preventDefault();
							if (searchBoxText !== '') {
								updateRhetCtxt(searchBoxText);
								updateRhetCtxtSaved(true);
							}
						}
					}}
					className="bg-transparent border-none w-full text-[0.9rem] p-2 resize-none box-border align-middle"
				/>
				<BsCheck2Circle
					className={`text-[1.6rem] mr-3 cursor-pointer ${
						rhetCtxtSaved
							? classes.savedButtonGreen
							: classes.savedButtonGray
					}`}
					onClick={() => {
						if (searchBoxText !== '') {
							updateRhetCtxt(searchBoxText);
							updateRhetCtxtSaved(true);
						}
					}}
				/>
			</div>
		</div>
	);
}
