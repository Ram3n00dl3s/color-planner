# Color Planner

A beautiful, interactive calendar for [Obsidian](https://obsidian.md) that connects to Google Calendar, with drag-and-drop event scheduling, a timer column for time-boxing, and read-only daily note to-dos.

## Features

- **Drag-and-drop scheduling** — create events by dragging downward on the grid, then resize and move them freely.
- **Google Calendar sync** — connect your own Google Cloud OAuth credentials (BYOK) to read and manage your calendars.
- **Inline to-dos** — add, edit, and complete to-dos per event with clean circular checkboxes. Completed items drop to the bottom of the list.
- **Timer column** — turn any note or to-do into a running timer to time-box your work.
- **Daily note integration** — surfaces tasks from your daily note without ever modifying the file.
- **Theme aware** — neutral, non-purple styling that follows your Obsidian theme in both light and dark mode.

## Requirements

- **Desktop only.** The plugin uses a local OAuth loopback server and Electron, which are not available on Obsidian Mobile.
- A Google account and your own Google Cloud OAuth client (free to create — see setup below).

## Installation

### From the Obsidian Community Plugins directory

Once published: **Settings → Community plugins → Browse**, search for **Color Planner**, then **Install** and **Enable**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Ram3n00dl3s/color-planner/releases/latest).
2. Create the folder `<YourVault>/.obsidian/plugins/color-planner/`.
3. Copy the three files into that folder.
4. Reload Obsidian and enable the plugin under **Settings → Community plugins**.

### Using BRAT

Add `Ram3n00dl3s/color-planner` in [BRAT](https://github.com/TfTHacker/obsidian42-brat).

## Google Calendar setup (BYOK)

The plugin never ships shared Google credentials. You create your own free OAuth client:

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a new project.
2. Search for **Google Calendar API** and click **Enable**.
3. Go to **APIs & Services → OAuth consent screen** and choose **External**.
4. Fill in the app name and email fields. Under **Publishing status**, click **Publish app** so your refresh token does not expire.
5. Go to **Credentials → Create credentials → OAuth client ID**.
6. Choose **Desktop app** as the application type.
7. Copy the **Client ID** and **Client Secret** into the plugin settings and click **Authenticate**.

Because you created the app yourself, you can safely ignore the "Google hasn't verified this app" warning — click **Advanced → Go to app**.

## Privacy and vault safety

- The plugin is **strictly read-only** with respect to your notes. It never calls `vault.modify`, never rewrites, appends to, or deletes lines from your note files, and never converts note text into checkboxes.
- To-do state, timers, and events created inside the calendar live in the plugin's own data file (`data.json` inside the plugin folder).
- Your Google Client ID, Client Secret, and refresh token are stored locally in that same plugin data file. Nothing is sent anywhere except to Google's official API endpoints.

## Development

```bash
npm install      # install dependencies
npm run dev      # watch mode (rebuilds main.js on change)
npm run build    # production build
npm run typecheck
```

Copy or symlink the repository into `<YourVault>/.obsidian/plugins/color-planner/` and reload Obsidian to test changes.

## Releasing

1. Bump `version` in `manifest.json` and `package.json`.
2. Add the matching entry to `versions.json` (`"<version>": "<minAppVersion>"`).
3. Commit, then create and push a Git tag equal to the version (for example `1.3.7`):

   ```bash
   git tag 1.3.7
   git push origin 1.3.7
   ```

4. The [release workflow](.github/workflows/release.yml) builds the plugin and attaches `main.js`, `manifest.json`, and `styles.css` to a new GitHub release.

## License

[MIT](LICENSE)
