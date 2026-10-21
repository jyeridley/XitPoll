import { config } from "./config.js";
import { THEMES, TYPES, answerText, optionsOf, scaleSteps, summarize } from "./forms.js";
import { esc } from "./util.js";

const host = (origin) => new URL(origin).host;
export const handle = (user) => `@${user.screen_name}@${host(user.instance)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const themeOf = (form) => (THEMES.includes(form?.settings?.theme) ? form.settings.theme : "blue");

const avatar = (user, size = "") => user.avatar_url
	? `<img class="avatar ${size}" src="${esc(user.avatar_url)}" alt="" referrerpolicy="no-referrer">`
	: `<span class="avatar ${size}" aria-hidden="true">${esc([...(user.name || user.screen_name)][0]?.toUpperCase() ?? "?")}</span>`;

// "3 days ago"
function ago(time) {
	const seconds = (time - Date.now()) / 1000;
	const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
	const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
	for (const [unit, size] of units) if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
	return "just now";
}

// 24px line icons
const ICONS = {
	logo: `<rect x="3" y="3" width="18" height="18" rx="5" class="logo-bg"/><path d="M8 9h8M8 12.5h8M8 16h4.5" class="logo-lines"/>`,
	back: `<path d="M19 12H5M11 6l-6 6 6 6"/>`,
	link: `<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>`,
	eye: `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`,
	chart: `<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`,
	plus: `<path d="M12 5v14M5 12h14"/>`,
	download: `<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>`,
	list: `<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>`,
	users: `<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>`,
	lock: `<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>`,
	trash: `<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>`,
	edit: `<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>`,
};
export const icon = (name, cls = "") => `<svg class="icon-svg ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const X_MARK = `<svg class="x-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.12z"/></svg>`;

export function page({ title, body, user, wide = false, head = "", theme = "blue", bodyClass = "" }) {
	const account = user
		? `<div class="account">${avatar(user)}<span class="who"><b>${esc(user.name || user.screen_name)}</b><span class="dim">${esc(handle(user))}</span></span>
<form method="post" action="/logout"><input type="hidden" name="csrf" value="${esc(user.csrf)}"><button class="outline small">Sign out</button></form></div>`
		: `<a class="button xitter small" href="/login">Sign in</a>`;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title ? `${title} – ${config.appName}` : config.appName)}</title>
<link rel="stylesheet" href="/static/style.css">
<link rel="icon" href="/static/icon.svg">
<script type="module" src="/static/app.js"></script>
${user ? `<meta name="csrf" content="${esc(user.csrf)}">` : ""}${head}
</head>
<body class="theme-${esc(theme)}${bodyClass ? ` ${bodyClass}` : ""}">
<header class="top"><a class="brand" href="/">${icon("logo")}<span>${esc(config.appName)}</span></a>${account}</header>
<main class="${wide ? "wide" : ""}">${body}</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
</body>
</html>`;
}

export const signInButton = (next, label = "Sign in with Xitter", kind = "xitter") =>
	`<a class="button ${kind} big-button" href="/login?next=${encodeURIComponent(next)}">${X_MARK}<span>${esc(label)}</span></a>`;

// percentage bars: a class per whole percent keeps widths out of style
// attributes, which the content security policy doesn't allow
const bar = (fraction) => `<span class="fill p${Math.round(Math.min(Math.max(fraction, 0), 1) * 100)}" aria-hidden="true"></span>`;

// signed out: XitPoll is a staff tool, so the front page only signs staff in
export function landing() {
	return page({
		title: "",
		body: `<section class="card narrow">
<div class="sign-in-mark">${X_MARK}</div>
<h1>${esc(config.appName)}</h1>
<p class="dim">Public forms and polls, made by the Xitter team. Sign in with your staff account to make and manage forms.</p>
<div class="stack">${signInButton("/")}</div>
<p class="fine">Answering a form? Open the link you were given. You don't need to sign in here.</p>
</section>`,
	});
}

export function notStaff(user) {
	return page({
		title: "Staff only",
		user,
		body: `<section class="card narrow">
<div class="gate-art">${icon("lock")}</div>
<h1>Staff only</h1>
<p class="dim">${esc(config.appName)} is an internal tool for Xitter staff, and <b>${esc(handle(user))}</b> isn't on its staff list.</p>
<p class="fine">Answering a form? Open the link you were given. You can answer forms with any account.</p>
</section>`,
	});
}

export function signIn({ next, error = "", instance = "" }) {
	return page({
		title: "Sign in",
		body: `<section class="card narrow">
<div class="sign-in-mark">${X_MARK}</div>
<h1>Sign in with Xitter</h1>
<p class="dim">Enter the Xitter instance your account is on. You'll approve ${esc(config.appName)} there and come straight back.</p>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<form method="get" action="/login" class="stack">
<input type="hidden" name="next" value="${esc(next)}">
<label>Instance<input class="boxed" name="instance" value="${esc(instance)}" placeholder="xitter.social" autocomplete="url" inputmode="url" autocapitalize="none" spellcheck="false" required autofocus></label>
<button class="xitter big-button">${X_MARK}<span>Continue</span></button>
</form>
<p class="fine">${esc(config.appName)} only asks for read access, uses it once to learn your name and handle, and doesn't keep the key.</p>
</section>`,
	});
}

export function dashboard(user, forms) {
	const tiles = forms.map((f) => `<li><a href="/forms/${esc(f.id)}/edit" class="form-tile theme-${esc(themeOf(f))}">
<b class="tile-title">${esc(f.title)}</b>
<span class="tile-meta"><span class="pill ${f.accepting ? "open" : "closed"}"><span class="dot"></span>${f.accepting ? "Open" : "Closed"}</span><span class="dim">${plural(f.responses, "response")}</span></span>
<span class="dim small-text">${plural(f.questions, "question")} · by @${esc(f.owner)} · edited ${esc(ago(f.updated_at))}</span>
</a></li>`).join("");
	const total = forms.reduce((n, f) => n + f.responses, 0);
	return page({
		title: "Forms",
		user,
		body: `<div class="page-head"><h1>Forms</h1><p class="dim">${forms.length ? `${plural(forms.length, "form")}, ${plural(total, "response")} in all` : "No forms yet. Make one and share the link."}</p></div>
<ul class="tile-grid">
<li><form method="post" action="/forms" class="new-tile-form"><input type="hidden" name="csrf" value="${esc(user.csrf)}"><button class="new-tile"><span class="plus">${icon("plus")}</span><b>New form</b><span class="dim">Start from a blank form</span></button></form></li>
${tiles}
</ul>`,
	});
}

export function builder(user, form, responseCount) {
	// "<" escaped so the JSON can't close the script element
	const data = JSON.stringify({ form, types: TYPES, themes: THEMES, publicUrl: config.publicUrl }).replace(/</g, "\\u003c");
	return page({
		title: form.title,
		user,
		theme: themeOf(form),
		bodyClass: "editor",
		head: `<script type="module" src="/static/builder.js"></script>`,
		body: `<div class="toolbar sticky">
<a href="/" class="button outline small icon-text">${icon("back")}<span>Forms</span></a>
<span id="status" class="save-status" data-state="saved" role="status" aria-live="polite"><span class="save-dot"></span><span class="save-text">All changes saved</span></span>
<span class="grow"></span>
<button type="button" class="outline small icon-text" id="copy-link">${icon("link")}<span>Copy link</span></button>
<a class="button outline small icon-text" href="/f/${esc(form.id)}" target="_blank" rel="noopener">${icon("eye")}<span>Preview</span></a>
<a class="button small icon-text" href="/forms/${esc(form.id)}/responses">${icon("chart")}<span>Responses</span>${responseCount ? `<span class="badge">${responseCount}</span>` : ""}</a>
</div>
<script type="application/json" id="form-data">${data}</script>
<div id="builder"><noscript><p class="card">The form editor needs JavaScript.</p></noscript></div>`,
	});
}

function questionField(q, value, error) {
	const name = `q_${q.id}`;
	const req = q.required ? " required" : "";
	const described = `${q.description ? `d_${q.id} ` : ""}${error ? `e_${q.id}` : ""}`.trim();
	const aria = described ? ` aria-describedby="${described}"` : "";
	let input = "";
	if (q.type === "short") input = `<input name="${name}" value="${esc(value)}" maxlength="1000"${req}${aria} placeholder="Your answer">`;
	else if (q.type === "paragraph") input = `<textarea name="${name}" rows="3" maxlength="20000"${req}${aria} placeholder="Your answer">${esc(value)}</textarea>`;
	else if (q.type === "date") input = `<input class="boxed" type="date" name="${name}" value="${esc(value)}"${req}${aria}>`;
	else if (q.type === "dropdown") input = `<select class="boxed" name="${name}"${req}${aria}><option value="">Choose</option>${optionsOf(q).map((o) => `<option${o === value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
	else if (q.type === "choice" || q.type === "checkbox") {
		const kind = q.type === "choice" ? "radio" : "checkbox";
		const picked = new Set(Array.isArray(value) ? value : [value]);
		// a required checkbox group can't be expressed in HTML; the server checks it
		input = `<div class="options">${optionsOf(q).map((o) => `<label class="option"><input type="${kind}" name="${name}" value="${esc(o)}"${picked.has(o) ? " checked" : ""}${kind === "radio" ? req : ""}><span class="mark ${kind}"></span><span>${esc(o)}</span></label>`).join("")}</div>`;
	} else if (q.type === "scale") {
		input = `<div class="scale"><span class="dim scale-label">${esc(q.minLabel)}</span><div class="steps">${scaleSteps(q).map((n) => `<label><input type="radio" name="${name}" value="${n}"${String(n) === String(value) ? " checked" : ""}${req}><span class="step">${n}</span></label>`).join("")}</div><span class="dim scale-label">${esc(q.maxLabel)}</span></div>`;
	}
	const grouped = ["choice", "checkbox", "scale"].includes(q.type);
	const title = `${esc(q.title || "Untitled question")}${q.required ? ` <span class="req" aria-label="required">*</span>` : ""}`;
	const desc = q.description ? `<p class="dim q-desc-text" id="d_${q.id}">${esc(q.description)}</p>` : "";
	const err = error ? `<p class="error" id="e_${q.id}">${esc(error)}</p>` : "";
	const attrs = `class="card question${error ? " invalid" : ""}" data-question`;
	return grouped
		? `<fieldset ${attrs}${aria}><legend>${title}</legend>${desc}${input}${err}</fieldset>`
		: `<div ${attrs}><label for="${name}" class="q-title">${title}</label>${desc}${input.replace(`name="${name}"`, `name="${name}" id="${name}"`)}${err}</div>`;
}

const formHeader = (form, extra = "") => `<div class="card form-head"><h1>${esc(form.title)}</h1>${form.description ? `<p class="description">${esc(form.description)}</p>` : ""}${extra}</div>`;

export function respond({ form, user, values = {}, errors = {}, preview = false }) {
	const required = form.questions.some((q) => q.required) ? `<p class="req-note"><span class="req">*</span> Required</p>` : "";
	// only forms that require signing in record who answered
	const who = user && form.settings.requireSignIn
		? `<p class="signed">${avatar(user, "tiny")}<span>Answering as <b>${esc(handle(user))}</b>. The form's owner will see your account.</span></p>`
		: "";
	const problem = Object.keys(errors).length ? `<p class="card error-card" role="alert">Some answers need another look.</p>` : "";
	return page({
		title: form.title,
		user,
		theme: themeOf(form),
		body: `<div class="answer-progress" hidden><span class="answer-progress-fill"></span></div>
${preview ? `<p class="banner">${icon("eye")}<span>Preview: only you see this banner.</span><a href="/forms/${esc(form.id)}/edit">Back to editing</a></p>` : ""}
${formHeader(form, `${who}${required}`)}
${problem}
<form method="post" action="/f/${esc(form.id)}" class="answers" novalidate>
${user ? `<input type="hidden" name="csrf" value="${esc(user.csrf)}">` : ""}
${form.questions.map((q) => questionField(q, values[q.id] ?? (q.type === "checkbox" ? [] : ""), errors[q.id])).join("\n")}
<div class="submit-row"><button class="big-button" data-busy="Sending…">Submit</button><button type="reset" class="outline">Clear form</button></div>
</form>`,
	});
}

export function gate({ form, user, kind }) {
	const messages = {
		closed: [icon("lock", "gate-icon"), "This form is no longer accepting responses", "Try contacting the owner of the form if you think this is a mistake."],
		signin: [X_MARK, "Sign in to continue", `This form asks respondents to sign in with Xitter.${form.settings.oneResponse ? " Each account can answer once." : ""}`],
		answered: [icon("users", "gate-icon"), "You've already responded", "You can fill out this form only once."],
	};
	const [art, heading, detail] = messages[kind];
	return page({
		title: form.title,
		user,
		theme: themeOf(form),
		body: `${formHeader(form)}<div class="card gate"><div class="gate-art">${art}</div><h2>${heading}</h2><p class="dim">${detail}</p>${kind === "signin" ? signInButton(`/f/${form.id}`) : ""}</div>`,
	});
}

function summaryBlocks(summary) {
	return summary.map(({ question: q, answered, counts, texts }) => {
		const head = `<header class="summary-head"><h3>${esc(q.title || "Untitled question")}</h3><span class="dim">${plural(answered, "response")} · ${esc(TYPES[q.type])}</span></header>`;
		if (counts) {
			const base = Math.max(answered, 1);
			const top = Math.max(...counts.map(([, n]) => n));
			return `<section class="card">${head}<ul class="bars">${counts.map(([label, n]) => `<li${n && n === top ? ` class="leader"` : ""}>${bar(n / base)}<span class="label">${esc(label)}</span><span class="count">${Math.round((n / base) * 100)}% <span class="dim">(${n})</span></span></li>`).join("")}</ul></section>`;
		}
		const shown = texts.slice(-50).reverse();
		return `<section class="card">${head}${shown.length ? `<ul class="texts">${shown.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>${texts.length > shown.length ? `<p class="dim">Showing the latest ${shown.length}. Download the CSV for all of them.</p>` : ""}` : `<p class="dim">No answers yet.</p>`}</section>`;
	}).join("");
}

export function thanks({ form, user, responses }) {
	const results = form.settings.showResults && responses
		? `<h2 class="section">Results so far</h2>${summaryBlocks(summarize(form, responses).filter((s) => s.counts))}`
		: "";
	return page({
		title: form.title,
		user,
		theme: themeOf(form),
		body: `${formHeader(form)}<div class="card done">
<span class="done-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
<h2>${esc(form.settings.confirmation || "Your response has been recorded.")}</h2>
${form.settings.oneResponse ? "" : `<p><a class="button outline small" href="/f/${esc(form.id)}">Submit another response</a></p>`}</div>${results}`,
	});
}

export function responsesPage(user, form, responses) {
	const csrf = `<input type="hidden" name="csrf" value="${esc(user.csrf)}">`;
	const latest = responses.at(-1)?.created_at;
	const signedIn = responses.filter((r) => r.screen_name).length;
	const individual = `<div class="table-wrap card"><table><thead><tr><th>Submitted</th><th>Account</th>${form.questions.map((q) => `<th>${esc(q.title || "Untitled question")}</th>`).join("")}</tr></thead><tbody>
${responses.slice().reverse().map((r) => `<tr><td class="nowrap">${esc(new Date(r.created_at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }))}</td><td class="nowrap">${r.screen_name ? `<a href="${esc(`${r.instance}/${r.screen_name}`)}" rel="noopener noreferrer" target="_blank">${esc(handle(r))}</a>` : `<span class="dim">Anonymous</span>`}</td>${form.questions.map((q) => `<td>${esc(answerText(r.answers[q.id]))}</td>`).join("")}</tr>`).join("")}
</tbody></table></div>`;
	return page({
		title: `Responses: ${form.title}`,
		user,
		wide: true,
		theme: themeOf(form),
		body: `<div class="toolbar">
<a href="/forms/${esc(form.id)}/edit" class="button outline small icon-text">${icon("edit")}<span>Edit form</span></a><span class="grow"></span>
${responses.length ? `<a class="button outline small icon-text" href="/forms/${esc(form.id)}/responses.csv" download>${icon("download")}<span>Download CSV</span></a>` : ""}
</div>
<div class="card form-head"><h1>${esc(form.title)}</h1>
<div class="stats">
<div class="stat"><span class="stat-value">${responses.length}</span><span class="dim">${responses.length === 1 ? "response" : "responses"}</span></div>
<div class="stat"><span class="stat-value">${latest ? esc(ago(latest)) : "–"}</span><span class="dim">latest response</span></div>
<div class="stat"><span class="stat-value">${signedIn}</span><span class="dim">signed in with Xitter</span></div>
</div>
<div class="row between head-actions">
<form method="post" action="/forms/${esc(form.id)}/accepting">${csrf}<input type="hidden" name="accepting" value="${form.accepting ? "0" : "1"}">
<label class="switch"><button class="toggle${form.accepting ? " on" : ""}" role="switch" aria-checked="${form.accepting}" aria-label="Accepting responses"></button><span>${form.accepting ? "Accepting responses" : "Not accepting responses"}</span></label></form>
${responses.length ? `<form method="post" action="/forms/${esc(form.id)}/responses/delete" data-confirm="Delete all ${responses.length} responses? This can't be undone.">${csrf}<button class="outline small danger icon-text">${icon("trash")}<span>Delete all responses</span></button></form>` : ""}
</div></div>
${responses.length
	? `<div class="tabs" role="tablist" hidden><button type="button" role="tab" aria-selected="true" aria-controls="summary">Summary</button><button type="button" role="tab" aria-selected="false" aria-controls="individual">Individual</button></div>
<div id="summary" role="tabpanel"><h2 class="section">Summary</h2>${summaryBlocks(summarize(form, responses))}</div>
<div id="individual" role="tabpanel"><h2 class="section">Individual responses</h2>${individual}</div>`
	: `<div class="card empty"><div class="empty-art">${icon("chart")}</div><h2>Waiting for responses</h2><p class="dim">Share this link to start collecting answers:</p><p><a href="/f/${esc(form.id)}">${esc(`${config.publicUrl}/f/${form.id}`)}</a></p></div>`}`,
	});
}

export function message(title, text, { user, status = 400 } = {}) {
	return { status, html: page({ title, user, body: `<section class="card narrow"><h1>${esc(title)}</h1><p>${esc(text)}</p><p><a class="button outline small" href="/">Go home</a></p></section>` }) };
}
