import React, { useState } from 'react';
import { CalendarEvent } from '../../types';
import { format } from 'date-fns';

interface EventModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSave: (event: Partial<CalendarEvent>) => void;
	initialEvent?: CalendarEvent | null;
	initialDate?: Date;
}

export const EventModal = ({ isOpen, onClose, onSave, initialEvent, initialDate }: EventModalProps) => {
	const [title, setTitle] = useState(initialEvent?.title || '');
	const [description, setDescription] = useState(initialEvent?.description || '');
	
	if (!isOpen) return null;

	const handleSave = () => {
		onSave({
			title: title || 'Event',
			description,
			// Add more fields here later
		});
		onClose();
	};

	return (
		<div className="event-modal-overlay" onClick={onClose}>
			<div className="event-modal" onClick={e => e.stopPropagation()}>
				<div className="event-modal-header">
					<input 
						type="text" 
						className="event-title-input" 
						placeholder="Add Title" 
						value={title}
						onChange={e => setTitle(e.target.value)}
						autoFocus
					/>
					<button className="close-button" onClick={onClose}>&times;</button>
				</div>
				
				<div className="event-modal-body">
					<div className="modal-row">
						<span className="icon">🕒</span>
						<div className="datetime-picker">
							{initialDate ? format(initialDate, 'EEEE, MMMM d') : format(new Date(), 'EEEE, MMMM d')}
						</div>
					</div>
					
					<div className="modal-row">
						<span className="icon">📝</span>
						<textarea 
							placeholder="Add Note" 
							value={description}
							onChange={e => setDescription(e.target.value)}
						/>
					</div>

					<div className="modal-row">
						<span className="icon">👥</span>
						<div className="members-placeholder">
							<div className="avatar mini"></div>
							<div className="avatar mini"></div>
							<button className="add-member-btn">+</button>
						</div>
					</div>
				</div>

				<div className="event-modal-footer">
					<button className="save-button" onClick={handleSave}>Save</button>
				</div>
			</div>
		</div>
	);
};
