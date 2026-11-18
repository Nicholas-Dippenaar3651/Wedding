# Troue Beplanning

A shared wedding-planning app in Afrikaans. Guests can view the preparation checklist and wedding-day timeline; signed-in editors can update the plan, manage groups, set the wedding date, and work with the private budget.

## Features

- Preparation checklist with groups, search, filters, and bulk editing.
- Photo list (Fotos): the photos to take, in order, grouped by moment, and ticked off on the day.
- Wedding-day timeline with event editing, a live mode, and a countdown to the wedding date.
- Budget and payment reminders visible only to signed-in editors.
- Real-time updates for everyone with the page open.
- Light, dark, and automatic themes.
- A guest landing page as the home page (`public/index.html`, images in `public/assets/`) with the invitation details and a countdown. The planner itself is at `/beplanning.html`.
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

4. Open [http://localhost:3000](http://localhost:3000) for the landing page, or [http://localhost:3000/beplanning.html](http://localhost:3000/beplanning.html) for the planner.

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
| `TROUE_GOOGLE_CLIENT_ID`, `TROUE_GOOGLE_CLIENT_SECRET`, `TROUE_GOOGLE_REFRESH_TOKEN` | No | Google Drive access for the `/oplaai` photo upload page. See [Guest photo uploads](#guest-photo-uploads). |
| `TROUE_BANK_REKENING` | No | Account number for the `/bank` gift page. The page only exists when this is set. |
| `TROUE_BANK` | No | Bank name shown on `/bank`. |
| `TROUE_BANK_HOUER` | No | Account holder shown on `/bank`. |
| `TROUE_BANK_TIPE` | No | Account type shown on `/bank`. |
| `TROUE_BANK_TAKKODE` | No | Branch code shown on `/bank`. |
| `TROUE_BANK_VERWYSING` | No | Payment reference shown on `/bank`; defaults to `Jou naam en van`. |

## Guest photo uploads

`/oplaai` is a public page where guests upload photos and videos (up to 2 GB each) without signing in. Files go straight from the guest's browser into a private **"Troue foto's"** folder in the couple's Google Drive; the server only asks Drive for a resumable upload URL per file (`POST /api/oplaai`), so large videos never pass through the host and interrupted uploads resume. The app uses Google's `drive.file` scope, so it can only see files and folders it created.

Setup, once:

1. In a Google Cloud project, enable the Drive API, configure the OAuth consent screen (External, scope `drive.file`, privacy policy `/privaatheid`), publish it **In production** (in Testing, Google expires the sign-in after 7 days), and create a **Desktop app** OAuth client.
2. Put `TROUE_GOOGLE_CLIENT_ID` and `TROUE_GOOGLE_CLIENT_SECRET` in `.env` and run `node scripts/google-login.js`. It writes `TROUE_GOOGLE_REFRESH_TOKEN` to `.env`.
3. Copy all three `TROUE_GOOGLE_*` values to the host's environment settings. The page answers 404 until all three are set.

Limits: 600 uploads per IP per hour, and uploads are refused once the Drive (shared with Gmail) would have less than 1 GB free. If uploads stop with `invalid_grant` in the server log, the Google sign-in was revoked or expired: run the script again and update the token on the host.

## Bank details page

`/bank` is a small public page with the couple's bank details for guests who want to give a gift, meant to be opened from a printed QR code. It deliberately skips `TROUE_LEES_WAGWOORD`, asks search engines not to index it, and has copy buttons for the holder, account number, and branch code. Keep the details in environment variables, never in the repository.

Keep `.env` and database credentials private. Do not commit them to source control.

## Data and access

MongoDB is the primary shared data store. The app loads the document with `_id: "state"` from the `data` collection on startup. If that document does not exist, the server can initialize it from `data/data.json` when that file is present.

Anyone with the site URL can view the planner unless `TROUE_LEES_WAGWOORD` is set. Editing requires the editor password, including the photo list (Fotos), which holds up to 500 photos. The one exception: anyone who can open the page can tick a photo off as taken (or untick it). The budget is only sent to authenticated editors.

When running on a local machine with a persistent filesystem, updates are also written to `data/data.json`, with periodic copies in `data/rugsteun/`. These local files are not a substitute for backing up MongoDB. Hosting services with ephemeral filesystems may discard local files on restart or sleep; use MongoDB for persistent hosted data.

## Deployment

Deploy this as a Node.js web service, not just as a static site: the server provides the API, password-based editor sessions, and real-time update stream. Configure `TROUE_WAGWOORD`, `TROUE_MONGO_URI`, and any optional settings as environment variables in your hosting provider's dashboard. Set `HOST=0.0.0.0` if required by the provider, and let the provider supply `PORT`.

Free hosting plans can sleep when idle and may have temporary filesystems. Confirm the provider's current limits and keep MongoDB backups.
