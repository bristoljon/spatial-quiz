# The Stroud Quiz

A live quiz app for the tech department. The host runs a big screen (projector or Teams share), and players join on their phones with a room code or QR. It runs entirely on Netlify: static Vite/React front end, Netlify Functions, and Netlify Blobs.

## Run it locally

```bash
npm install
npm run build          # prepares images + builds the site
npm start              # http://localhost:8888  (local Blobs emulator, no CLI needed)
# or: netlify dev
```

Open `/host` on the presenting laptop and **Create room**. Players go to the site root (or scan the QR) and enter the code. `/screen/CODE` is a read-only big-screen view, handy if the controls and the projector are on different machines.

Host keys: **space / →** next · **z** zoom out (photo reveal) · **l** lock answers · **f** fullscreen. The ☰ panel lets you jump to any round or question, see who has answered, and adjust scores by ±5.

## Deploy to Netlify

1. Push this folder to a Git repo and import it into Netlify (or run `netlify deploy --build --prod`).
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Both are set in `netlify.toml`.
2. Optional: set the `HOST_PIN` environment variable (Functions scope) so only you can create rooms.
3. Optional: set `MEDIA_SALT` so image file names can't be guessed.

## How "real time" works without websockets

Netlify Functions can't hold websocket connections, so the app works like this:

- **The host is the authority.** Every action (`next`, `lock`, `zoom`, …) does an etag-guarded write of one small `state` blob.
- **Phones and screens poll** `GET /api/state/CODE` every second. The CDN caches that response for 1 second, so 50 phones cost about one function call per second rather than 50.
- **Answers** are `POST /api/answer`, stored as one blob per player per question, so there are no write clashes. The answer function rejects late answers.
- **Scoring** runs server-side on reveal. Answers live only in the function bundle (`shared/quiz.js`) and never reach the browser.
- Each device gets the server clock with every state update, so countdowns agree across phones.

`src/api.js` is the only file that knows about transport. Swapping in Ably or PartyKit later wouldn't touch the UI.

## Writing questions

All content lives in `shared/quiz.js`. Types:

| type | what players do | scoring |
|---|---|---|
| `choice` | tap one option (text or `image`), optional review `quote` card | all or nothing |
| `multi` | pick all that apply | +1 per right pick, −1 per wrong pick, scaled |
| `order` | arrange items with ▲▼ | share of positions correct |
| `match` | tap-to-pair left and right | share of pairs correct |
| `blanks` | fill gaps, as dropdowns (`options`) or free text (`accept`) | per blank; typos tolerated |
| `slider` | guess a number | full points within `exact`, falls to 0 at `zeroAt` |
| `text` | type an answer | fuzzy match against `accept` |
| `reveal` | guess a zoomed-in photo, choice or text; first answer is final | earlier lock-in = more points |

## Photos

Put images in `quiz-media/` using the file names referenced in `shared/quiz.js`:

- Reveals: `subscription-rooms.jpg`, `woodchester-mansion.jpg`, `painswick-yews.jpg`, `rodborough-fort.jpg`, `ebley-mill.jpg`
- "Which one is Stroud?": `town-stroud.jpg`, `town-nailsworth.jpg`, `town-tetbury.jpg`, `town-cirencester.jpg`

`npm run prep` (which also runs as part of `build`) crops the zoom stages around each question's `focus` point and writes them to `public/m/` under hashed names. Until you add a real photo, a labelled placeholder is used.

Use your own photos, or freely licensed ones from Wikimedia Commons, and credit them.

## Sources

- Reviews: TripAdvisor, quoted in short excerpts.
- Demographics: ONS Census 2021 area pages and the ONS census API.
- Trivia: Wikipedia, Digital Stroud, Companies House, and the venues' own sites.

Check the quotes on their source pages before the night.
