import { ItemView, WorkspaceLeaf } from 'obsidian';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { App } from '../react/App';
import SleekCalendarPlugin from '../main';

export const CALENDAR_VIEW_TYPE = 'sleek-calendar-view';

export class CalendarView extends ItemView {
	root: ReactDOM.Root | null = null;
	plugin: SleekCalendarPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: SleekCalendarPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return CALENDAR_VIEW_TYPE;
	}

	getDisplayText() {
		return 'Color Planner';
	}

	getIcon(): string {
		return 'calendar';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		const reactContainer = container.createEl('div', { cls: 'sleek-calendar-react-root' });

		this.root = ReactDOM.createRoot(reactContainer);
		this.root.render(
			React.createElement(App, { plugin: this.plugin })
		);
	}

	async onClose() {
		if (this.root) {
			this.root.unmount();
		}
	}
}
