import { useContext, useState } from 'react';
import { useWindowSize } from '@react-hook/window-size/throttled';

import { UserContext } from '@/contexts/userContext';
import { PageContext } from '@/contexts/pageContext';

import classes from './styles.module.css';

export default function Login() {
	const { changePage } = useContext(PageContext);
	const { updateUsername } = useContext(UserContext);
	const [width, _height] = useWindowSize();

	const [userId, updateId] = useState('');

	return (
		<div className={ classes.container }>
			<input
				value={ userId }
				placeholder="Username"
				onChange={ e => updateId(e.target.value) }
			/>

			<button
				onClick={ () => {
					updateUsername(userId);

					changePage('home'); // Need to add randomness back to page switching
				} }
			>
				Login
			</button>
			<div className={ classes.widthalert }>
				{ width < 400 &&
					'For best experience please expand the sidebar by dragging the splitter.' }
			</div>
		</div>
	);
}
