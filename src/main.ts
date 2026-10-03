import { App, FuzzySuggestModal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import { CalendarView, CALENDAR_VIEW_TYPE } from './view/CalendarView';
import { TimerTile, CalendarEvent, CalendarProfile } from './types';
import { authenticateGoogle, refreshAccessToken, fetchCalendarList } from './api/googleAuth';
import { AUTO_TIME_ZONE } from './utils/timezone';
import { DEFAULT_BACKGROUND_FIT, DEFAULT_BACKGROUND_DIM } from './utils/backgroundImage';
import {
	DEFAULT_DOODLE_STYLE,
	isDoodleStyle,
	DEFAULT_DOODLE_OPACITY,
	clampDoodleOpacity,
	DEFAULT_DOODLE_SHAPE_COUNT,
	clampDoodleShapeCount,
	DEFAULT_DOODLE_SHAPE_SIZE,
	clampDoodleShapeSize,
	DEFAULT_DOODLE_SHAPE_ROTATION,
	clampDoodleShapeRotation,
	DEFAULT_DOODLE_SHAPE_STROKE,
	clampDoodleShapeStroke,
	DEFAULT_DOODLE_SHAPE_SPREAD,
	clampDoodleShapeSpread
} from './utils/doodleBackground';

export interface CalendarPluginSettings {
	googleClientId: string;
	googleClientSecret: string;
	refreshToken: string;
	themeColor: string;
	showTimerColumn: boolean;
	accentEnabled: boolean;
	accentColor: string;
	timeZone: string;
	backgroundImage: string;
	backgroundFit: string;
	backgroundDim: number;
	backgroundInvert: boolean;
	/** Optional doodle line-art that lingers faintly behind the calendar grid. */
	doodleEnabled: boolean;
	/** Which doodle artwork to use (see DOODLE_STYLES in utils/doodleBackground). */
	doodleStyle: string;
	/** Faintness of the doodles as a percentage (0–100 → CSS opacity 0–1). */
	doodleOpacity: number;
	/** How many shapes the animated "Simple shapes" doodle scatters (shapes style only). */
	doodleShapeCount: number;
	/** Size of those shapes as a percentage of the baseline (100 = default). */
	doodleShapeSize: number;
	/** Global rotation of the shape field, in degrees (−180 → 180). */
	doodleShapeRotation: number;
	/** Outline weight of the shapes (1–10). */
	doodleShapeStroke: number;
	/** How far the shapes sit from the centre of the field (0.5–1.6). Above 1
	 *  spreads them apart, below 1 draws them together. */
	doodleShapeSpread: number;
	timers: TimerTile[];
	events: CalendarEvent[];
	selectedCalendars: string[];
	/** User-created calendar profiles (Work, Hobby, …) with their swatch colors. */
	calendarProfiles: CalendarProfile[];
	/** The "default swatch": the palette colour every newly created tile starts in.
	 *  Picked in the profile creator in the default right pane. */
	defaultEventColor: string;
	/**
	 * Show the to-do items and description lines inside event tiles. When off, a
	 * tile shows only its title and time; the details remain available in the
	 * event pane, so nothing is lost — the tiles are just quieter.
	 */
	showTileDetails: boolean;
	/**
	 * Which calendar shape to show: the sliding day columns ('days', 1–7) or the
	 * full-month grid ('month'). Stored as a string so it round-trips cleanly.
	 */
	viewMode: string;
	/** Default palette colour for a month-view day tile that carries no events. */
	monthViewDefaultColor: string;
	/**
	 * Per-day colour overrides for the month view, keyed by `YYYY-M-D`. A day the
	 * user has recoloured by hand keeps that colour; everything else falls back to
	 * the default colour (quiet days) or to an automatic colour (busy days).
	 */
	monthDayColors: Record<string, string>;
	/**
	 * The automatic colours the month view has already settled on, keyed by `YYYY-M-D`.
	 *
	 * The app paints a month's busy days once, in date order, each colour opposite the
	 * one before it. Those decisions are written here so they are never revisited: a
	 * day added later takes a plain random colour of its own and leaves every colour
	 * already on screen exactly as it was.
	 */
	monthAutoDayColors: Record<string, string>;
}

const DEFAULT_SETTINGS: CalendarPluginSettings = {
	googleClientId: '',
	googleClientSecret: '',
	refreshToken: '',
	themeColor: 'blue',
	showTimerColumn: false,
	accentEnabled: true,
	accentColor: 'blue',
	timeZone: AUTO_TIME_ZONE,
	backgroundImage: '',
	backgroundFit: DEFAULT_BACKGROUND_FIT,
	backgroundDim: DEFAULT_BACKGROUND_DIM,
	backgroundInvert: false,
	doodleEnabled: false,
	doodleStyle: DEFAULT_DOODLE_STYLE,
	doodleOpacity: DEFAULT_DOODLE_OPACITY,
	doodleShapeCount: DEFAULT_DOODLE_SHAPE_COUNT,
	doodleShapeSize: DEFAULT_DOODLE_SHAPE_SIZE,
	doodleShapeRotation: DEFAULT_DOODLE_SHAPE_ROTATION,
	doodleShapeStroke: DEFAULT_DOODLE_SHAPE_STROKE,
	doodleShapeSpread: DEFAULT_DOODLE_SHAPE_SPREAD,
	timers: [],
	events: [],
	selectedCalendars: [],
	calendarProfiles: [],
	// '' = the user has never picked a default swatch (the creator's Default row
	// shows an empty swatch and new tiles fall back to pastel blue).
	defaultEventColor: '',
	// On by default: tiles have always shown their to-do/description lines.
	showTileDetails: true,
	// The calendar opens in the familiar sliding day columns.
	viewMode: 'days',
	// A calm pastel for quiet days in the month view.
	monthViewDefaultColor: 'pastel-blue',
	// No hand-picked day colours to begin with.
	monthDayColors: {},
	// Nothing has been painted automatically yet.
	monthAutoDayColors: {}
}

export default class SleekCalendarPlugin extends Plugin {
	settings!: CalendarPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			CALENDAR_VIEW_TYPE,
			(leaf) => new CalendarView(leaf, this)
		);

		this.addRibbonIcon('calendar', 'Open Color Planner', () => {
			this.activateView();
		});

		this.addCommand({
			id: 'open-color-planner',
			name: 'Open Color Planner',
			callback: () => {
				this.activateView();
			}
		});

		this.addSettingTab(new CalendarSettingTab(this.app, this));
	}

	onunload() {
		// Intentionally do not detach leaves here. Obsidian reinitializes open
		// leaves on plugin update and restores them to their original position,
		// so detaching views in onunload is discouraged by the plugin guidelines.
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(CALENDAR_VIEW_TYPE);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getLeaf(true);
			await leaf.setViewState({ type: CALENDAR_VIEW_TYPE, active: true });
		}

		workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		// Migration / hydration for accent + time zone settings.
		if (typeof this.settings.accentEnabled !== 'boolean') {
			this.settings.accentEnabled = true;
		}
		if (!this.settings.accentColor) {
			this.settings.accentColor = this.settings.themeColor || 'blue';
		}
		if (!this.settings.timeZone) {
			this.settings.timeZone = AUTO_TIME_ZONE;
		}
		// Background picture migration / hydration.
		if (typeof this.settings.backgroundImage !== 'string') {
			this.settings.backgroundImage = '';
		}
		if (!this.settings.backgroundFit) {
			this.settings.backgroundFit = DEFAULT_BACKGROUND_FIT;
		}
		if (typeof this.settings.backgroundDim !== 'number') {
			this.settings.backgroundDim = DEFAULT_BACKGROUND_DIM;
		}
		if (typeof this.settings.backgroundInvert !== 'boolean') {
			this.settings.backgroundInvert = false;
		}
		// Doodle backdrop migration / hydration.
		if (typeof this.settings.doodleEnabled !== 'boolean') {
			this.settings.doodleEnabled = false;
		}
		if (!isDoodleStyle(this.settings.doodleStyle)) {
			this.settings.doodleStyle = DEFAULT_DOODLE_STYLE;
		}
		this.settings.doodleOpacity = clampDoodleOpacity(this.settings.doodleOpacity);
		// Animated "Simple shapes" tuning (stored raw; clamped again at use time).
		this.settings.doodleShapeCount = clampDoodleShapeCount(this.settings.doodleShapeCount);
		this.settings.doodleShapeSize = clampDoodleShapeSize(this.settings.doodleShapeSize);
		this.settings.doodleShapeRotation = clampDoodleShapeRotation(this.settings.doodleShapeRotation);
		this.settings.doodleShapeStroke = clampDoodleShapeStroke(this.settings.doodleShapeStroke);
		this.settings.doodleShapeSpread = clampDoodleShapeSpread(this.settings.doodleShapeSpread);
		// Calendar profiles migration / hydration.
		if (!Array.isArray(this.settings.calendarProfiles)) {
			this.settings.calendarProfiles = [];
		}
		// Default tile colour (the "Default" row in the profile creator). '' is a
		// valid value: it means no default swatch has been chosen yet.
		if (typeof this.settings.defaultEventColor !== 'string') {
			this.settings.defaultEventColor = '';
		}
		// Tile detail lines (to-dos / description printed on the tiles themselves).
		// Absent means an existing install: keep showing them.
		if (typeof this.settings.showTileDetails !== 'boolean') {
			this.settings.showTileDetails = true;
		}
		// Month view: which shape to show, the default day-tile colour, and any
		// per-day colour overrides. Anything unrecognised falls back cleanly.
		if (this.settings.viewMode !== 'month') {
			this.settings.viewMode = 'days';
		}
		if (typeof this.settings.monthViewDefaultColor !== 'string' || !this.settings.monthViewDefaultColor) {
			this.settings.monthViewDefaultColor = 'pastel-blue';
		}
		if (!this.settings.monthDayColors || typeof this.settings.monthDayColors !== 'object' || Array.isArray(this.settings.monthDayColors)) {
			this.settings.monthDayColors = {};
		}
		if (!this.settings.monthAutoDayColors || typeof this.settings.monthAutoDayColors !== 'object' || Array.isArray(this.settings.monthAutoDayColors)) {
			this.settings.monthAutoDayColors = {};
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** Notify any mounted calendar React roots that settings changed. */
	notifySettingsChanged() {
		document.dispatchEvent(new CustomEvent('sleek-calendar-settings-changed'));
	}

	/**
	 * Open the vault image picker and hand the chosen file back to the caller.
	 * Used by the in-calendar settings menu (the background picture row), which
	 * lives in React and cannot construct the modal itself.
	 */
	pickBackgroundImage(onChoose: (file: TFile) => void) {
		new ImageSuggestModal(this.app, onChoose).open();
	}
}

/**
	* Fuzzy picker for choosing a background image from the vault, so the setting
	* has an obvious "Browse" affordance instead of only a type-a-path field.
	*/
class ImageSuggestModal extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;

	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder('Search for an image in your vault…');
	}

	getItems(): TFile[] {
		const exts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'];
		return this.app.vault
			.getFiles()
			.filter(f => exts.includes(f.extension.toLowerCase()))
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		this.onChoose(item);
	}
}

class CalendarSettingTab extends PluginSettingTab {
	plugin: SleekCalendarPlugin;

	constructor(app: App, plugin: SleekCalendarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Plugin version')
			.setDesc(`Color Planner v${this.plugin.manifest.version}`);

		const infoEl = containerEl.createEl('div', { cls: 'google-calendar-setup-instructions' });
		infoEl.innerHTML = `
			<div style="background-color: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 20px; margin-bottom: 24px;">
				<h3 style="margin-top: 0; margin-bottom: 16px; font-weight: 600; color: var(--text-normal);">Google Calendar Setup (BYOK)</h3>
				<ol style="margin: 0; padding-left: 24px; line-height: 1.6; color: var(--text-normal);">
					<li style="margin-bottom: 10px;">Go to the <a href="https://console.cloud.google.com/" target="_blank">Google Cloud Console</a>. In the top-left corner (next to the Google Cloud logo), click <b>Select a project</b>, then click <b>New Project</b> in the top right of the popup window.</li>
					<li style="margin-bottom: 10px;">Use the top search bar to search for <b>Google Calendar API</b> and click <b>Enable</b>.</li>
					<li style="margin-bottom: 10px;">Go to <b>APIs & Services > OAuth consent screen</b> and choose <b>External</b>.</li>
					<li style="margin-bottom: 10px;">Fill in the app name and email fields. Under Publishing Status, click <b>Publish App</b> (In Production) so your token never expires!</li>
					<li style="margin-bottom: 10px;">Go to <b>Credentials</b>. Click <b>Create Credentials > OAuth client ID</b>.</li>
					<li style="margin-bottom: 10px;">Choose <b>Desktop app</b> as the application type.</li>
					<li style="margin-bottom: 0;">Copy your Client ID and Client Secret below and click <b>Authenticate</b>.</li>
				</ol>
				<div style="margin-top: 18px; padding: 12px; background-color: var(--background-primary); border-radius: 6px; font-size: 0.9em; color: var(--text-muted); line-height: 1.5;">
					<i><b>Note:</b> Because you created the app yourself, you can safely ignore the "Google hasn't verified this app" warning when logging in. Just click "Advanced" and "Go to App".</i>
				</div>
			</div>
		`;

		new Setting(containerEl)
			.setName('Google Client ID')
			.setDesc('Client ID from Google Cloud Console')
			.addText(text => text
				.setPlaceholder('Enter Client ID')
				.setValue(this.plugin.settings.googleClientId)
				.onChange(async (value) => {
					this.plugin.settings.googleClientId = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Google Client Secret')
			.setDesc('Client Secret from Google Cloud Console')
			.addText(text => {
				text.inputEl.type = 'password';
				text.setPlaceholder('Enter Client Secret')
					.setValue(this.plugin.settings.googleClientSecret)
					.onChange(async (value) => {
						this.plugin.settings.googleClientSecret = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Authentication Status')
			.setDesc(this.plugin.settings.refreshToken ? '✅ Authenticated with Google Calendar' : '❌ Not authenticated')
			.addButton(button => button
				.setButtonText(this.plugin.settings.refreshToken ? 'Re-Authenticate' : 'Authenticate')
				.setCta()
				.onClick(async () => {
					const { googleClientId, googleClientSecret } = this.plugin.settings;
					if (!googleClientId || !googleClientSecret) {
						new Notice('Please enter both Client ID and Client Secret first.');
						return;
					}
					button.setButtonText('Waiting for browser...');
					button.setDisabled(true);
					try {
						const tokens = await authenticateGoogle(googleClientId, googleClientSecret);
						this.plugin.settings.refreshToken = tokens.refreshToken;
						await this.plugin.saveSettings();
						new Notice('Successfully authenticated with Google Calendar!');
						this.display(); // Refresh settings UI
					} catch (e: any) {
						new Notice('Authentication failed: ' + e.message);
						button.setButtonText('Authenticate');
						button.setDisabled(false);
					}
				}));

	}
}
