import { useContext, useState } from 'react';

import { UserContext } from '@/contexts/userContext';
import { PageContext } from '@/contexts/pageContext';

import classes from './styles.module.css';

export default function Login() {
	const { changePage } = useContext(PageContext);
	const { updateUsername } = useContext(UserContext);

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

					changePage('chat'); // Need to add randomness back to page switching
				} }
			>
				Login
			</button>
		</div>
	);
}
