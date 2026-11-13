# Spatial Quiz

A live quiz where you answer by **moving**. Everyone's avatar is on the same
board, on the big screen and on every player's screen, in real time. Drag
yourself to where you think the answer is. When the clock hits zero, wherever
you're standing is your answer.

Players enter their name and pick a colour; their avatar is their initials
(up to three). The server recolours anyone whose initials and colour clash with
an existing player, so two "AL"s are always telling apart. Works equally on a laptop (click, drag,
or nudge with the arrow keys; hover shows the value under the cursor) and on a
phone (touch and drag).

Because answers are positions, questions can be about *proximity*, not just
right/wrong:

| Type     | Board                                   | Scoring                                                         |
|----------|-----------------------------------------|-----------------------------------------------------------------|
| `choice` | Options laid out as zones on a grid     | Full points if you're in the right zone                         |
| `range`  | A number line                           | Full points within `exact`, falling linearly to zero at `zeroAt` |
| `xy`     | Two axes (e.g. year vs price)           | Same falloff, by distance on the board                          |
| `wager`  | Two halves; distance from the middle is your stake | Win or **lose** `points × stake`                      |
| `image`  | A picture; the answer is a point or box on it | Same falloff, by distance from the point or box's edge     |
| `video`  | A clip the host plays and pauses; answer as `image` | Same, but the clock waits for the host and the clip resumes before the results |

Questions live in [shared/quiz.js](shared/quiz.js), grouped into rounds.
Answers never leave the server.

### Image questions

"Find Stroud on this map", "which part of this engine is the alternator":
the picture fills the board and players stand on the answer.

```js
{
  id: 'q8', type: 'image', points: 12, timeLimit: 30,
  prompt: 'Find Easter Island.',
  image: { src: '/img/world.jpg', width: 1920, height: 960, bounds: { north: 90, south: -90, west: -180, east: 180 } },
  answer: { lat: -27.1, lon: -109.35, label: 'Easter Island' },
  exact: 0.02, zeroAt: 0.2,
}
```

- `src` is a file under [web/public](web/public) (served from `/`, deployed
  with the site) or a full URL. `width` and `height` are the file's pixel size;
  the picture is scaled to fit the 16:10 board without cropping, so the same
  board position hits the same pixel on a phone and on the big screen. The
  server never loads the file, which is why it needs the size. The browser
  logs a warning if the real file disagrees.
- The answer is a point, in whichever form is handiest: pixels in the file
  `{ px, py }` (read them off any image editor), fractions of its width and
  height `{ x, y }`, or, for an equirectangular map with `bounds`,
  `{ lat, lon }`. An optional `label` is shown at the reveal.
- `exact` and `zeroAt` are radii as fractions of the board's width (defaults
  0.02 and 0.25), drawn as rings at the reveal.

The bundled [world.jpg](web/public/img/world.jpg) is NASA's Blue Marble
(public domain) and covers the whole globe, so any lat/lon works on it.

A box answer, `{ box: { px, py, w, h } }` (or fractions `{ x, y, w, h }`),
scores full points anywhere inside and falls off from its edge.

### Video questions

"Where does the ball end up?" A clip fills the board. The host plays it on
the big screen, pauses it at the critical moment and starts the clock. Players
guess from the paused frame. When the clock runs out the answers are locked
and scored but kept hidden, the host plays the rest of the clip, then shows
the results.

```js
{
  id: 'q9', type: 'video', points: 12, timeLimit: 20,
  prompt: 'Where does the ball come to rest?',
  video: { src: '/video/ball.mp4', width: 1280, height: 720 },
  answer: { px: 681, py: 278, label: 'It stops here' },
  exact: 0.03, zeroAt: 0.25,
}
```

- `src` is an MP4 (H.264) under [web/public](web/public) or a full URL on a
  server that supports byte ranges (S3/CloudFront and the local server do;
  Safari won't play video without them). `width` and `height` are the clip's
  pixel size, used exactly as for images. Answers take the same forms as
  images, including boxes.
- Every screen shows the clip, letterboxed the same way, and follows the
  host's player: play, pause and seek on the big screen are mirrored on every
  phone, muted. A phone whose browser refuses to autoplay shows a "tap to
  play" button.
- Host keys while the clip is in charge: **space** play/pause, **←/→** skip
  5s, **enter** start the clock (and, once the answers are locked, show the
  results).
- Clips are fetched into memory by every phone (and the big screen) as soon
  as they join, so by the time the question comes up there's nothing to
  download: pause and seek are instant. The host's intro panel shows how many
  phones have it. A phone that hasn't finished (or failed) streams the clip
  instead, which works but can lag.
- Players can't place or use power-ups until the clock starts. The timer and
  the finalize step are unchanged; they just begin at "Start the clock"
  instead of "Next".
- Any other question can also wait for the host with `clock: 'host'`.
- `video.pauseAt` (seconds) stops the host's player by itself when playback
  crosses that time on the intro screen, so the host just presses play. Playing
  on past it isn't stopped again; seek back before it and it stops there again.

### Oops! round

A round of "where does it end up?" clips from the
[Oops! dataset](https://oops.cs.columbia.edu) (Epstein, Chen & Vondrick, CVPR
2020): about 20,000 fail videos, each annotated with the moment it goes wrong.
The round lives in [shared/rounds/oops.js](shared/rounds/oops.js) and is left
out of the quiz while it's empty. To build it you need ffmpeg and the dataset,
downloaded and extracted from the site above (non-commercial use only).

```bash
node tools/oops/prepare.js --oops ~/data/oops_dataset --count 30
```

This shuffles the annotated clips, keeps ones filmed from a still camera, trims
each to 5 s before the fail moment and 4 s after, shrinks it so phones can
preload it, and sets `pauseAt` just before the moment. Everything goes in
`tools/oops/work/` (gitignored). The still-camera test compares each frame to
the clip's median background; tune it with `--min-static` (default 0.75), and
use `--seed` for a different batch.

Then open `tools/oops/work/picker.html` in a browser. For each clip you want:
click where the thing ends up on its last frame, write the prompt ("Where does
the toddler end up?"), and nudge the pause time if needed. Export
`picks.json`, then:

```bash
node tools/oops/build-round.js --picks ~/Downloads/picks.json
```

That copies the chosen clips to `web/public/video/oops/` and writes the round.
Re-running it replaces the round. Keep it to a handful of clips: every phone
downloads all of them when it joins.

The bundled [ball.mp4](web/public/video/ball.mp4) is a rendered 8-second
clip of a ball bouncing round a table; it comes to rest at pixel (681, 278).
Keep clips short: every phone downloads them.

### Speed bonus

The correct player who settled first (by the time of their last move) gets a
flat bonus, `settings.speedBonus` in [shared/quiz.js](shared/quiz.js), default
1. It's added after Double down, so it isn't doubled. Set it to 0 to turn it off.

### Power-ups

Each player gets one of each. When used ones come back is a quiz setting,
`settings.powerUps` in [shared/quiz.js](shared/quiz.js):

- `replenish: 'never'` — one of each for the whole quiz
- `replenish: 'round'` — refreshed at the start of every round (default)
- `replenish: 'random'` — at the start of each question there's a `randomChance`
  (default 0.3) that everyone's are refreshed; the screen announces it

| Power-up        | Effect                                                                 |
|-----------------|------------------------------------------------------------------------|
| 👻 Invisibility | Your avatar disappears from every other screen, including the big one, until the reveal. The server stops sending your position to anyone but you. |
| 🔍 Reveal       | The real answer is marked on your own board.                            |
| ⚡ Double down  | Any points you earn on this question are doubled. Losses are not.       |
| 🕹️ Possess      | Pick a victim. Your own avatar freezes while you drag theirs; where you drop them, they're locked until the reveal. |
| 🪞 Mirror       | Everyone else sees your avatar reflected through the board's centre. On a range that flips your number; on a wager it flips your side. |
| 🛡️ Shield       | You can't be possessed or bumped this question. A Possess aimed at you is wasted. |
| 💥 Bump         | Shoves everyone within reach straight away from you; the closer they were, the further they fly. Only available once you're on the board. Radius and push are `settings.bump`. |

While you're steering someone you see their true position even if they're
invisible or mirrored; everyone else keeps seeing nothing, or the reflection.

They stack. Keys **1–7** on a keyboard; Possess then waits for you to click a victim (Esc cancels). Power-ups are private: the
server only tells you about your own, so nobody else (including the big
screen) can see what you used.

## Run it locally (no AWS needed)

```bash
npm install
npm run local        # builds the site, serves site + websocket on http://localhost:8787
```

Open <http://localhost:8787/host> on the big screen, phones go to the root URL
or scan the QR code.

### Phones on the internet via ngrok

The local server puts the site and the socket on **one port**, so one tunnel
covers both:

```bash
npm run tunnel       # = ngrok http 8787
```

Open `https://<your-ngrok-domain>/host` for the big screen; the QR code it
shows already points at the ngrok URL. State is in memory, so a server restart
ends the game.

### Developing with hot reload

```bash
npm run dev          # websocket server on :8787 + Vite on :5173 (proxies /ws)
```

Use <http://localhost:5173>. `ngrok http 5173` also works if you want hot
reload *and* phones.

### Simulated players

To try things out without a room full of phones, point some bots at your room:

```bash
npm run bots -- --code ABCD            # 4 bots, local server
npm run bots -- --code ABCD --n 8      # more chaos
npm run bots -- --code ABCD --url wss://xyz.ngrok.app/ws   # through ngrok / against AWS
```

They join over the real WebSocket like any phone. Each bot gets a random
personality: accuracy (they know the answers and miss by an amount that
depends on it), how early it settles, how much it fidgets first, how often it
fires a power-up, and the last bot is always a copycat that follows someone
else's avatar, which is handy for testing Invisibility. The terminal prints
what each bot did and scored.

### Tests

```bash
npm test             # drives a whole game through the engine and checks the scoring
npm run typecheck
```

## Deploy to AWS (CDK)

Everything is one stack in [infra/lib/spatial-quiz-stack.ts](infra/lib/spatial-quiz-stack.ts):

- **API Gateway WebSocket API** → one Lambda for `$connect` / `$disconnect` / `$default`
- **DynamoDB** single table (rooms, players, connections) with a 24h TTL
- **Step Functions Express** as the question timer: waits until the deadline,
  then invokes a finalize Lambda that scores every position and pushes the reveal
- **S3 + CloudFront** for the static site, with a `config.json` written at deploy
  time carrying the WebSocket URL, so the front end never needs rebuilding

```bash
aws sso login            # or however you get credentials
npx cdk bootstrap        # once per account/region
npm run deploy           # builds web/dist then cdk deploy
```

Outputs include `SiteUrl`, `HostUrl` and `WebSocketUrl`. Set `HOST_PIN=1234`
in the environment when deploying (or running locally) to require a PIN to
create a room. `npm run destroy` removes everything.

Region defaults to `eu-west-2`; override with `CDK_DEFAULT_REGION`.

## How it works

```
phone ──ws──┐                                  ┌── DynamoDB (room, players, conns)
phone ──ws──┼─ API Gateway ── ws-handler λ ────┤
screen ─ws──┘        ▲                         └── Step Functions: Wait(endsAt) ── finalize λ
                     └────────── postToConnection ─────────────────────────┘
```

- Players send `player:move {x,y}` (normalised 0..1, throttled to ~14/s while
  dragging). The server stores the position and fans out a `pos` message to
  everyone in the room.
- On `host:next` the server stamps `endsAt`, clears everyone's position, starts
  a timer execution, and broadcasts the question (without the answer).
- State is built per viewer: you always get your own position, power-up
  status and any Reveal hint, while invisible players are stripped out of
  everyone else's copy.
- When the timer fires (or the host presses **E**), `finalize` scores every
  stored position with [shared/scoring.js](shared/scoring.js), writes the
  reveal with a conditional update so it can only happen once, and broadcasts.
- Phones store their player id; a reload reconnects to the same player with
  the same score. The host page does the same with a room token.
- Every client measures its clock offset against the server (ping/pong) so
  countdowns agree.

[infra/lambda/core.ts](infra/lambda/core.ts) is the whole game engine and is
transport-agnostic. The Lambda wires it to DynamoDB and API Gateway;
[infra/local/dev-server.ts](infra/local/dev-server.ts) wires the same code to
an in-memory store and the `ws` package.

Host keys: **space / →** start or next · **E** end the question now · **F** fullscreen.
Player keys: **arrows** nudge your avatar, **shift + arrows** for bigger steps.

## Writing questions

```js
{ id: 'q9', type: 'range', points: 10, timeLimit: 25,
  prompt: 'How tall is Nelson\'s Column, in metres?',
  min: 0, max: 100, step: 1, unit: 'm', answer: 52, exact: 2, zeroAt: 25,
  note: '52 m to the top of his hat.' }
```

`exact` and `zeroAt` are in the question's units for `range`, and fractions of
the board width for `xy` (defaults 0.03 and 0.35).
