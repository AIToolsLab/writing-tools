import React from 'react';

interface PermissionModalProps {
	isOpen: boolean;
	onOptIn: () => void;
}

function PermissionModal({ isOpen, onOptIn }: PermissionModalProps) {
	if (!isOpen) {
		return null;
	}

	return (
		<div className="modal">
			<div className="modal-content">
				<h4>Permission Request</h4>
				<p>Would you like to allow this file to use the AI features?</p>
				<button onClick={onOptIn}>Opt In</button>
			</div>
		</div>
	);
}

export default PermissionModal;
