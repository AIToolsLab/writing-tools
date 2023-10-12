import { useContext, useState } from 'react';

import { UserContext } from '@/contexts/userContext';
import { PageContext } from '@/contexts/pageContext';

import classes from './styles.module.css';

export default function Login() {
	const { changePage } = useContext(PageContext);
	const { updateUserId } = useContext(UserContext);

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
					if (username === 'example' && password === 'password') {
						updateUserId(username);
						changePage('home');
					} 
					else {
						alert('Invalid username or password');
					}
				} }
				disabled={ !username || !password }
			>
				Login
			</button>
		</div>
	);
}
