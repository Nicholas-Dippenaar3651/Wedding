# Troue Beplanning

A shared wedding-planning app in Afrikaans. Guests can view the preparation checklist and wedding-day timeline; signed-in editors can update the plan, manage groups, set the wedding date, and work with the private budget.

## Features

- Preparation checklist with groups, search, filters, and bulk editing.
- Wedding-day timeline with event editing, a live mode, and a countdown to the wedding date.
- Budget and payment reminders visible only to signed-in editors.
- Real-time updates for everyone with the page open.
- Light, dark, and automatic themes.
- MongoDB Atlas storage, with local JSON copies and periodic backups when running on a persistent local server.

## Requirements

- Node.js 18 or newer.
- A MongoDB database, such as MongoDB Atlas.

## Run locally

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a `.env` file in the project root:

   ```dotenv
   TROUE_WAGWOORD=choose-a-strong-password
   TROUE_MONGO_URI=mongodb+srv://<username>:<password>@<cluster-host>/
   TROUE_MONGO_DB=troue
   ```

   `TROUE_WAGWOORD` must be at least 8 characters. URL-encode special characters in the MongoDB username or password when placing them in the connection URI.

3. Start the app:

   ```sh
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000).

The server uses the `PORT` environment variable if set (otherwise port 3000) and listens on `127.0.0.1` by default. Set `HOST=0.0.0.0` to accept connections from other devices or a hosting platform.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `TROUE_WAGWOORD` | Yes | Editor sign-in password; at least 8 characters. |
| `TROUE_MONGO_URI` | Yes | MongoDB connection URI. |
| `TROUE_MONGO_DB` | No | Database name; defaults to the driver's default database. |
| `TROUE_LEES_WAGWOORD` | No | Optional password required just to view the app. Must differ from the editor password. |
| `PORT` | No | HTTP port; defaults to `3000`. Hosting platforms commonly set this automatically. |
| `HOST` | No | Interface to bind to; defaults to `127.0.0.1`. Use `0.0.0.0` on a hosted service. |

Keep `.env` and database credentials private. Do not commit them to source control.

## Data and access

MongoDB is the primary shared data store. The app loads the document with `_id: "state"` from the `data` collection on startup. If that document does not exist, the server can initialize it from `data/data.json` when that file is present.

Anyone with the site URL can view the planner unless `TROUE_LEES_WAGWOORD` is set. Editing requires the editor password. The budget is only sent to authenticated editors.

When running on a local machine with a persistent filesystem, updates are also written to `data/data.json`, with periodic copies in `data/rugsteun/`. These local files are not a substitute for backing up MongoDB. Hosting services with ephemeral filesystems may discard local files on restart or sleep; use MongoDB for persistent hosted data.

## Deployment

Deploy this as a Node.js web service, not just as a static site: the server provides the API, password-based editor sessions, and real-time update stream. Configure `TROUE_WAGWOORD`, `TROUE_MONGO_URI`, and any optional settings as environment variables in your hosting provider's dashboard. Set `HOST=0.0.0.0` if required by the provider, and let the provider supply `PORT`.

Free hosting plans can sleep when idle and may have temporary filesystems. Confirm the provider's current limits and keep MongoDB backups.
