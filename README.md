# Spatial Quiz

A live quiz where you answer by **moving**. Everyone's avatar (emoji + initials)
is on the same board, on the big screen and on every phone, in real time.
Drag yourself to where you think the answer is. When the clock hits zero,
wherever you're standing is your answer.

Because answers are positions, questions can be about *proximity*, not just
right/wrong:

| Type     | Board                                   | Scoring                                                         |
|----------|-----------------------------------------|-----------------------------------------------------------------|
| `choice` | Options laid out as zones on a grid     | Full points if you're in the right zone                         |
| `range`  | A number line                           | Full points within `exact`, falling linearly to zero at `zeroAt` |
| `xy`     | Two axes (e.g. year vs price)           | Same falloff, by distance on the board                          |
| `wager`  | Two halves; distance from the middle is your stake | Win or **lose** `points × stake`                      |

Questions live in [shared/quiz.js](shared/quiz.js). Answers never leave the server.

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

## Writing questions

```js
{ id: 'q9', type: 'range', points: 10, timeLimit: 25,
  prompt: 'How tall is Nelson\'s Column, in metres?',
  min: 0, max: 100, step: 1, unit: 'm', answer: 52, exact: 2, zeroAt: 25,
  note: '52 m to the top of his hat.' }
```

`exact` and `zeroAt` are in the question's units for `range`, and fractions of
the board width for `xy` (defaults 0.03 and 0.35).
