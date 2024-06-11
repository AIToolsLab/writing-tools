import { useContext, useState } from 'react';
import { useWindowSize } from '@react-hook/window-size/throttled';

import { UserContext } from '@/contexts/userContext';

import classes from './styles.module.css';

export default function Login() {
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
				onClick={ () => updateUsername(userId) }
			>
				Login
			</button>

			<div className={ classes.widthAlert }>
				{
                    width < 400 && 'For best experience please expand the sidebar by dragging the splitter.'
                }
			</div>
		</div>
	);
}
