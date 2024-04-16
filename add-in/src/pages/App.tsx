import React, { useState, useEffect, useContext } from 'react';
import { PageContext } from '@/contexts/PageContext';
import Layout from '@/components/Layout';
import Home from './HomePage';
import Chat from './ChatPage';
import Login from './LoginPage';
import PermissionModal from '@/components/PermissionModal';
import {
	checkDocumentOptIn,
	setDocumentOptIn
} from '@/utilities/PermissionUtils';

export interface HomeProps {
	isOfficeInitialized: boolean;
}

export default function App({ isOfficeInitialized }: HomeProps) {
	if (!isOfficeInitialized)
		return (
			<section className="ms-welcome__progress ms-u-fadeIn500">
				<p>Please sideload your addin to see app body.</p>
			</section>
		);

	const { page } = useContext(PageContext);
	const [isModalOpen, setIsModalOpen] = useState(false);

	useEffect(() => {
		const checkOptInStatus = async () => {
			const optedIn = await checkDocumentOptIn();
			if (optedIn === null) {
				setIsModalOpen(true);
			}
		};

		checkOptInStatus();
	}, []);

	const handleOptIn = async () => {
		await setDocumentOptIn(true);
		setIsModalOpen(false);
	};

	if (page === 'login') return <Login />;

	if (isModalOpen) {
		return (
			<PermissionModal
				isOpen={isModalOpen}
				onOptIn={handleOptIn}
			/>
		);
	}

	return <Layout>{page === 'reflections' ? <Home /> : <Chat />}</Layout>;
}
