import { useContext, useState } from 'react';

import { PageContext } from '@/contexts/PageContext';
import { UserContext } from '@/contexts/UserContext';

import classes from './styles/LoginPage.module.css';


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

					changePage('home'); // Need to add randomness back to page switching
				} }
			>
				Login
			</button>
		</div>
	);
}
