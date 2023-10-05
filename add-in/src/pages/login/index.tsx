import { useContext, useState } from 'react';

import { UserContext } from '@/contexts/userContext';
import { PageContext } from '@/contexts/pageContext';

import classes from './styles.module.css';

export default function Login() {
	const { changePage } = useContext(PageContext);
	const { updateUserId } = useContext(UserContext);

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
					const userIdInt = parseInt(userId);
					updateUserId(userIdInt);
                    
					const pageOrder =
						userIdInt % 2 === 0
							? ['reflections', 'chat']
							: ['chat', 'reflections'];
					changePage(pageOrder[0]);
				} }
			>
				Login
			</button>
		</div>
	);
}
