import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { randomId, sha256 } from "./util.js";

if (config.dbPath !== ":memory:") mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

db.exec(`
pragma journal_mode = wal;
pragma foreign_keys = on;

create table if not exists users (
	id integer primary key,
	instance text not null,
	xitter_id text not null,
	screen_name text not null,
	name text not null default '',
	avatar_url text,
	created_at integer not null,
	unique (instance, xitter_id)
);

create table if not exists sessions (
	token_hash text primary key,
	user_id integer not null references users(id) on delete cascade,
	csrf text not null,
	expires_at integer not null
);

-- a sign-in in progress: the PKCE verifier waits here for the callback
create table if not exists oauth_states (
	state_hash text primary key,
	verifier text not null,
	instance text not null,
	next text not null,
	created_at integer not null
);

create table if not exists forms (
	id text primary key,
	owner_id integer not null references users(id) on delete cascade,
	title text not null,
	description text not null default '',
	questions text not null default '[]',
	settings text not null default '{}',
	accepting integer not null default 1,
	created_at integer not null,
	updated_at integer not null
);
create index if not exists forms_owner on forms(owner_id, updated_at desc);

create table if not exists responses (
	id integer primary key,
	form_id text not null references forms(id) on delete cascade,
	user_id integer references users(id) on delete set null,
	answers text not null,
	created_at integer not null
);
create index if not exists responses_form on responses(form_id, created_at);
create index if not exists responses_user on responses(form_id, user_id);
`);

const SESSION_DAYS = 30;
const STATE_MINUTES = 10;

// users

export function upsertUser({ instance, id, screen_name, name, avatar_url }) {
	return db.prepare(`insert into users(instance, xitter_id, screen_name, name, avatar_url, created_at) values(?, ?, ?, ?, ?, ?)
		on conflict (instance, xitter_id) do update set screen_name = excluded.screen_name, name = excluded.name, avatar_url = excluded.avatar_url
		returning *`).get(instance, String(id), screen_name, name ?? "", avatar_url ?? null, Date.now());
}

// sessions

export function createSession(userId) {
	const token = randomId(32);
	const csrf = randomId(24);
	db.prepare("delete from sessions where expires_at < ?").run(Date.now());
	db.prepare("insert into sessions(token_hash, user_id, csrf, expires_at) values(?, ?, ?, ?)")
		.run(sha256(token), userId, csrf, Date.now() + SESSION_DAYS * 86400_000);
	return token;
}

export function sessionUser(token) {
	if (!token) return undefined;
	return db.prepare(`select u.*, s.csrf from sessions s join users u on u.id = s.user_id where s.token_hash = ? and s.expires_at > ?`)
		.get(sha256(token), Date.now());
}

export function deleteSession(token) {
	if (token) db.prepare("delete from sessions where token_hash = ?").run(sha256(token));
}

// sign-ins in progress

export function saveState(state, { verifier, instance, next }) {
	db.prepare("delete from oauth_states where created_at < ?").run(Date.now() - STATE_MINUTES * 60_000);
	db.prepare("insert into oauth_states(state_hash, verifier, instance, next, created_at) values(?, ?, ?, ?, ?)")
		.run(sha256(state), verifier, instance, next, Date.now());
}

// each state works once, whatever happens next
export function takeState(state) {
	const row = db.prepare("delete from oauth_states where state_hash = ? and created_at > ? returning verifier, instance, next")
		.get(sha256(state), Date.now() - STATE_MINUTES * 60_000);
	return row;
}

// forms

const formRow = (row) => row && {
	...row,
	questions: JSON.parse(row.questions),
	settings: JSON.parse(row.settings),
	accepting: !!row.accepting,
};

export function createForm(ownerId) {
	const id = randomId(9);
	const now = Date.now();
	const questions = [{ id: randomId(6), type: "choice", title: "Untitled question", description: "", required: false, options: ["Option 1"] }];
	db.prepare("insert into forms(id, owner_id, title, questions, created_at, updated_at) values(?, ?, ?, ?, ?, ?)")
		.run(id, ownerId, "Untitled form", JSON.stringify(questions), now, now);
	return id;
}

export const getForm = (id) => formRow(db.prepare("select * from forms where id = ?").get(String(id)));

export function ownedForm(id, ownerId) {
	const form = getForm(id);
	return form && form.owner_id === ownerId ? form : undefined;
}

export function listForms(ownerId) {
	return db.prepare(`select f.id, f.title, f.accepting, f.updated_at, (select count(*) from responses r where r.form_id = f.id) as responses
		from forms f where f.owner_id = ? order by f.updated_at desc`).all(ownerId);
}

export function updateForm(id, { title, description, questions, settings, accepting }) {
	db.prepare("update forms set title = ?, description = ?, questions = ?, settings = ?, accepting = ?, updated_at = ? where id = ?")
		.run(title, description, JSON.stringify(questions), JSON.stringify(settings), accepting ? 1 : 0, Date.now(), id);
}

export function setAccepting(id, accepting) {
	db.prepare("update forms set accepting = ?, updated_at = ? where id = ?").run(accepting ? 1 : 0, Date.now(), id);
}

export const deleteForm = (id) => db.prepare("delete from forms where id = ?").run(id);

// responses

export function addResponse(formId, userId, answers) {
	db.prepare("insert into responses(form_id, user_id, answers, created_at) values(?, ?, ?, ?)")
		.run(formId, userId ?? null, JSON.stringify(answers), Date.now());
}

export function hasResponded(formId, userId) {
	return !!db.prepare("select 1 from responses where form_id = ? and user_id = ? limit 1").get(formId, userId);
}

export function listResponses(formId) {
	return db.prepare(`select r.id, r.answers, r.created_at, u.screen_name, u.name, u.instance from responses r
		left join users u on u.id = r.user_id where r.form_id = ? order by r.created_at`).all(formId)
		.map((r) => ({ ...r, answers: JSON.parse(r.answers) }));
}

export const deleteResponses = (formId) => db.prepare("delete from responses where form_id = ?").run(formId);
