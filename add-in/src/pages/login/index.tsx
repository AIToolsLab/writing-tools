import { useContext, useState } from 'react';

import { UserContext } from '@/contexts/userContext';
import { PageContext } from '@/contexts/pageContext';

import classes from './styles.module.css';

export default function Login() {
	const { changePage } = useContext(PageContext);
	const { updateUsername } = useContext(UserContext);

	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');

	return (
		<div className={ classes.container }>
			<input
				type="text"
				value={ username }
				placeholder="Username"
				onChange={ e => setUsername(e.target.value) }
			/>

			<input
				type="password"
				value={ password }
				placeholder="Password"
				onChange={ e => setPassword(e.target.value) }
			/>

			<button
				onClick={ () => {
<<<<<<< HEAD
					updateUsername(userId);

					changePage('chat'); // Need to add randomness back to page switching
=======
					if (username === 'example' && password === 'password') {
						updateUserId(username);
						changePage('home');
					} 
					else {
						alert('Invalid username or password');
					}
>>>>>>> 08b8b419002a8c2e55af13572447139c8dcaada4
				} }
				disabled={ !username || !password }
			>
				Login
			</button>
		</div>
	);
}
