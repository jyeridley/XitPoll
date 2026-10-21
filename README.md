# XitPoll

A Google Forms-style form and poll builder where people sign in with their
[Xitter](https://github.com/Xittered/xitter) account.

- **Builder**: title and description, then any number of questions: short
  answer, paragraph, multiple choice, checkboxes, dropdown, linear scale
  (0/1 to 2–10, with end labels) and date. You can mark questions required,
  reorder, duplicate and delete them. Changes save automatically.
- **Sharing**: every form has a public link (`/f/<id>`) that works without
  JavaScript, on phones, and in light and dark mode.
- **Sign in with Xitter**: form owners always sign in. A form can also require
  respondents to sign in, which records which account answered, and can limit
  each account to one response.
- **Polls**: optionally show respondents the results of the choice questions
  after they submit.
- **Responses**: a chart for each question, a table of individual responses,
  CSV export, closing and reopening a form, and deleting all responses.

No dependencies: Node 22.13+ and its built-in SQLite.

## How sign-in works

Xitter is an OAuth 2 provider (authorization code with mandatory PKCE, public
clients only, see `src/oauth.ts` in the Xitter repo). XitPoll:

1. finds the instance's endpoints at `/.well-known/oauth-authorization-server`,
2. sends the person to `/oauth/authorize` with the `read` scope, a random
   `state` (also kept in a cookie, so a sign-in can only finish in the browser
   that started it) and an S256 code challenge,
3. trades the code at `/oauth/token` with the verifier,
4. calls `GET /api/v1/me` once to learn the account's id, handle, name and
   avatar, and then **discards the token**.

Accounts are identified by instance + Xitter user id, so `@sam` on two
different instances are two different people.

## Running it

There are two ways to connect to Xitter.

### One instance, registered app (easiest, works on localhost)

1. On your Xitter instance, open **/account/apps/developer** and register an
   app with the redirect URL `http://localhost:3000/auth/callback` (or your
   https URL + `/auth/callback` in production).
2. Start XitPoll with the client ID it gives you:

```sh
XITTER_INSTANCE=https://your.xitter.instance \
XITTER_CLIENT_ID=1234567890 \
npm start
```

### Any instance, no registration

XitPoll serves an OAuth client metadata document at `/client-metadata.json`
and uses its URL as the `client_id`, so people on *any* Xitter can sign in:
the sign-in page asks which instance they're on. Xitter only accepts this when
the document is served over **https from a host without a port**, so this mode
needs a real deployment:

```sh
PUBLIC_URL=https://polls.example.com npm start
```

Set `XITTER_INSTANCE` as well to skip the instance question and allow only
that one instance. Instances people type in must be public https hosts; XitPoll
refuses private and loopback addresses.

### Settings

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `PUBLIC_URL` | `http://localhost:$PORT` | The address people use. Builds the redirect URL and share links; `https://` also turns on `Secure` cookies |
| `XITTER_INSTANCE` | (none) | Allow only this instance |
| `XITTER_CLIENT_ID` | (none) | A client ID registered on `XITTER_INSTANCE` |
| `DATABASE_PATH` | `data/xitpoll.db` | SQLite file |
| `APP_NAME` | `XitPoll` | Shown in the header and on Xitter's consent screen |

Put XitPoll behind a reverse proxy that terminates TLS (Caddy, nginx) in
production.

## Trying it without a Xitter instance

`test/mock-xitter.js` is a stand-in Xitter that follows the same OAuth rules
and approves every sign-in as `@alice`:

```sh
npm run mock-xitter            # http://127.0.0.1:4000
XITTER_INSTANCE=http://127.0.0.1:4000 XITTER_CLIENT_ID=123456789 npm start
```

Then open http://localhost:3000.

## Tests

```sh
npm test
```

The end-to-end test signs in through the mock Xitter, builds a form, answers it
anonymously and as signed-in accounts, and checks validation, ownership,
CSRF and origin checks, one-response limits, CSV export and closing a form.

## Layout

```
server.js          HTTP routes, sessions, CSRF and origin checks
src/xitter.js      Sign in with Xitter (discovery, PKCE, token exchange, /me)
src/forms.js       Question types, sanitizing, answer validation, summaries, CSV
src/db.js          SQLite schema and queries
src/views.js       Server-rendered pages
public/builder.js  The form editor
public/style.css   Styles (light and dark)
test/              End-to-end test and the mock Xitter
```
