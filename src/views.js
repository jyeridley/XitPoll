import { config } from "./config.js";
import { TYPES, answerText, optionsOf, scaleSteps, summarize } from "./forms.js";
import { esc } from "./util.js";

const host = (origin) => new URL(origin).host;
export const handle = (user) => `@${user.screen_name}@${host(user.instance)}`;

const avatar = (user, size = "") => user.avatar_url
	? `<img class="avatar ${size}" src="${esc(user.avatar_url)}" alt="" referrerpolicy="no-referrer">`
	: `<span class="avatar ${size}" aria-hidden="true">${esc([...(user.name || user.screen_name)][0]?.toUpperCase() ?? "?")}</span>`;

const LOGO = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7.5 9h9M7.5 13h9M7.5 17h5" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const X_MARK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.12z"/></svg>`;

export function page({ title, body, user, wide = false, head = "" }) {
	const account = user
		? `<div class="account">${avatar(user)}<span class="who"><b>${esc(user.name || user.screen_name)}</b><span class="dim">${esc(handle(user))}</span></span>
<form method="post" action="/logout"><input type="hidden" name="csrf" value="${esc(user.csrf)}"><button class="ghost small">Sign out</button></form></div>`
		: "";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title ? `${title} – ${config.appName}` : config.appName)}</title>
<link rel="stylesheet" href="/static/style.css">
<link rel="icon" href="/static/icon.svg">
${user ? `<meta name="csrf" content="${esc(user.csrf)}">` : ""}${head}
</head>
<body>
<header class="top"><a class="brand" href="/">${LOGO}<span>${esc(config.appName)}</span></a>${account}</header>
<main class="${wide ? "wide" : ""}">${body}</main>
</body>
</html>`;
}

export const signInButton = (next, label = "Sign in with Xitter") =>
	`<a class="button xitter" href="/login?next=${encodeURIComponent(next)}">${X_MARK}<span>${esc(label)}</span></a>`;

export function landing() {
	return page({
		title: "",
		body: `<section class="hero">
<h1>Forms and polls for Xitter</h1>
<p class="lead">Build surveys, sign-up sheets and polls with the questions you need, share one link, and see answers come in. Sign in with your Xitter account; nobody needs a new password.</p>
${signInButton("/")}
<ul class="features">
<li><b>Seven question types</b><span>Short and long answers, multiple choice, checkboxes, dropdowns, linear scales and dates.</span></li>
<li><b>Know who answered</b><span>Require respondents to sign in with Xitter and limit everyone to one response.</span></li>
<li><b>Results as they arrive</b><span>Charts for each question, every individual response, and a CSV export.</span></li>
</ul>
</section>`,
	});
}

export function signIn({ next, error = "", instance = "" }) {
	return page({
		title: "Sign in",
		body: `<section class="card narrow">
<h1>Sign in with Xitter</h1>
<p class="dim">Enter the Xitter instance your account is on. You'll approve ${esc(config.appName)} there, and come straight back.</p>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<form method="get" action="/login" class="stack">
<input type="hidden" name="next" value="${esc(next)}">
<label>Instance<input name="instance" value="${esc(instance)}" placeholder="xitter.social" autocomplete="url" inputmode="url" autocapitalize="none" spellcheck="false" required autofocus></label>
<button class="xitter">${X_MARK}<span>Continue</span></button>
</form>
<p class="fine">${esc(config.appName)} only asks for read access, uses it once to learn your name and handle, and doesn't keep the key.</p>
</section>`,
	});
}

export function dashboard(user, forms) {
	const list = forms.length
		? `<ul class="form-list">${forms.map((f) => `<li><a href="/forms/${esc(f.id)}/edit" class="card form-tile">
<b>${esc(f.title)}</b>
<span class="dim">${f.responses} response${f.responses === 1 ? "" : "s"} · ${f.accepting ? "Open" : "Closed"} · edited ${esc(new Date(f.updated_at).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }))}</span>
</a></li>`).join("")}</ul>`
		: `<div class="card empty"><p>No forms yet. Make your first one.</p></div>`;
	return page({
		title: "My forms",
		user,
		body: `<div class="row between"><h1>My forms</h1>
<form method="post" action="/forms"><input type="hidden" name="csrf" value="${esc(user.csrf)}"><button>+ New form</button></form></div>
${list}`,
	});
}

export function builder(user, form, responseCount) {
	// "<" escaped so the JSON can't close the script element
	const data = JSON.stringify({ form, types: TYPES, publicUrl: config.publicUrl }).replace(/</g, "\\u003c");
	return page({
		title: form.title,
		user,
		head: `<script type="module" src="/static/builder.js"></script>`,
		body: `<div class="toolbar">
<a href="/" class="ghost small">← My forms</a>
<span id="status" class="dim" role="status" aria-live="polite">All changes saved</span>
<span class="grow"></span>
<button type="button" class="ghost small" id="copy-link">Copy link</button>
<a class="button ghost small" href="/f/${esc(form.id)}" target="_blank" rel="noopener">Preview</a>
<a class="button small" href="/forms/${esc(form.id)}/responses">Responses${responseCount ? ` (${responseCount})` : ""}</a>
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
	else if (q.type === "paragraph") input = `<textarea name="${name}" rows="4" maxlength="20000"${req}${aria} placeholder="Your answer">${esc(value)}</textarea>`;
	else if (q.type === "date") input = `<input type="date" name="${name}" value="${esc(value)}"${req}${aria}>`;
	else if (q.type === "dropdown") input = `<select name="${name}"${req}${aria}><option value="">Choose</option>${optionsOf(q).map((o) => `<option${o === value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
	else if (q.type === "choice" || q.type === "checkbox") {
		const kind = q.type === "choice" ? "radio" : "checkbox";
		const picked = new Set(Array.isArray(value) ? value : [value]);
		// a required checkbox group can't be expressed in HTML; the server checks it
		input = `<div class="options">${optionsOf(q).map((o) => `<label class="option"><input type="${kind}" name="${name}" value="${esc(o)}"${picked.has(o) ? " checked" : ""}${kind === "radio" ? req : ""}><span>${esc(o)}</span></label>`).join("")}</div>`;
	} else if (q.type === "scale") {
		input = `<div class="scale"><span class="dim">${esc(q.minLabel)}</span><div class="steps">${scaleSteps(q).map((n) => `<label><span>${n}</span><input type="radio" name="${name}" value="${n}"${String(n) === String(value) ? " checked" : ""}${req}></label>`).join("")}</div><span class="dim">${esc(q.maxLabel)}</span></div>`;
	}
	const grouped = ["choice", "checkbox", "scale"].includes(q.type);
	const title = `${esc(q.title || "Untitled question")}${q.required ? ` <span class="req" aria-label="required">*</span>` : ""}`;
	const desc = q.description ? `<p class="dim" id="d_${q.id}">${esc(q.description)}</p>` : "";
	const err = error ? `<p class="error" id="e_${q.id}">${esc(error)}</p>` : "";
	return grouped
		? `<fieldset class="card question${error ? " invalid" : ""}"${aria}><legend>${title}</legend>${desc}${input}${err}</fieldset>`
		: `<div class="card question${error ? " invalid" : ""}"><label for="${name}" class="q-title">${title}</label>${desc}${input.replace(`name="${name}"`, `name="${name}" id="${name}"`)}${err}</div>`;
}

const formHeader = (form, extra = "") => `<div class="card form-head"><h1>${esc(form.title)}</h1>${form.description ? `<p class="description">${esc(form.description)}</p>` : ""}${extra}</div>`;

export function respond({ form, user, values = {}, errors = {}, preview = false }) {
	const required = form.questions.some((q) => q.required) ? `<p class="req-note"><span class="req">*</span> Indicates required question</p>` : "";
	// only forms that require signing in record who answered
	const who = user && form.settings.requireSignIn
		? `<p class="dim signed">${avatar(user, "tiny")} Answering as <b>${esc(handle(user))}</b>. The form's owner will see your account.</p>`
		: "";
	const problem = Object.keys(errors).length ? `<p class="error card" role="alert">Some answers need another look.</p>` : "";
	return page({
		title: form.title,
		user,
		body: `${preview ? `<p class="banner">Preview: only you see this banner. <a href="/forms/${esc(form.id)}/edit">Back to editing</a></p>` : ""}
${formHeader(form, `${who}${required}`)}
${problem}
<form method="post" action="/f/${esc(form.id)}" class="answers" novalidate>
${user ? `<input type="hidden" name="csrf" value="${esc(user.csrf)}">` : ""}
${form.questions.map((q) => questionField(q, values[q.id] ?? (q.type === "checkbox" ? [] : ""), errors[q.id])).join("\n")}
<div class="row between"><button>Submit</button><button type="reset" class="ghost">Clear form</button></div>
</form>`,
	});
}

export function gate({ form, user, kind }) {
	const messages = {
		closed: [`${esc(form.title)} is no longer accepting responses.`, "Try contacting the owner of the form if you think this is a mistake."],
		signin: ["Sign in to continue", `${esc(form.title)} asks respondents to sign in with Xitter.${form.settings.oneResponse ? " Each account can answer once." : ""}`],
		answered: ["You've already responded", `You can fill out ${esc(form.title)} only once.`],
	};
	const [heading, detail] = messages[kind];
	return page({
		title: form.title,
		user,
		body: `${formHeader(form)}<div class="card"><h2>${heading}</h2><p class="dim">${detail}</p>${kind === "signin" ? signInButton(`/f/${form.id}`) : ""}</div>`,
	});
}

function summaryBlocks(summary) {
	return summary.map(({ question: q, answered, counts, texts }) => {
		const head = `<h3>${esc(q.title || "Untitled question")}</h3><p class="dim">${answered} response${answered === 1 ? "" : "s"} · ${esc(TYPES[q.type])}</p>`;
		if (counts) {
			const base = Math.max(answered, 1);
			return `<section class="card">${head}<ul class="bars">${counts.map(([label, n]) => `<li><span class="label">${esc(label)}</span><progress max="${base}" value="${n}"></progress><span class="count">${n} <span class="dim">(${Math.round((n / base) * 100)}%)</span></span></li>`).join("")}</ul></section>`;
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
		body: `${formHeader(form)}<div class="card"><p>${esc(form.settings.confirmation || "Your response has been recorded.")}</p>
${form.settings.oneResponse ? "" : `<p><a href="/f/${esc(form.id)}">Submit another response</a></p>`}</div>${results}`,
	});
}

export function responsesPage(user, form, responses) {
	const csrf = `<input type="hidden" name="csrf" value="${esc(user.csrf)}">`;
	const individual = responses.length
		? `<div class="table-wrap card"><table><thead><tr><th>Submitted</th><th>Account</th>${form.questions.map((q) => `<th>${esc(q.title || "Untitled question")}</th>`).join("")}</tr></thead><tbody>
${responses.slice().reverse().map((r) => `<tr><td>${esc(new Date(r.created_at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }))}</td><td>${r.screen_name ? `<a href="${esc(`${r.instance}/${r.screen_name}`)}" rel="noopener noreferrer" target="_blank">${esc(handle(r))}</a>` : `<span class="dim">Anonymous</span>`}</td>${form.questions.map((q) => `<td>${esc(answerText(r.answers[q.id]))}</td>`).join("")}</tr>`).join("")}
</tbody></table></div>`
		: "";
	return page({
		title: `Responses: ${form.title}`,
		user,
		wide: true,
		body: `<div class="toolbar">
<a href="/forms/${esc(form.id)}/edit" class="ghost small">← Edit form</a><span class="grow"></span>
${responses.length ? `<a class="button ghost small" href="/forms/${esc(form.id)}/responses.csv" download>Download CSV</a>` : ""}
</div>
<div class="card form-head"><h1>${esc(form.title)}</h1>
<p class="big">${responses.length} response${responses.length === 1 ? "" : "s"}</p>
<div class="row between">
<form method="post" action="/forms/${esc(form.id)}/accepting">${csrf}<input type="hidden" name="accepting" value="${form.accepting ? "0" : "1"}">
<label class="switch"><span>Accepting responses</span><button class="toggle${form.accepting ? " on" : ""}" role="switch" aria-checked="${form.accepting}" aria-label="Accepting responses"></button></label></form>
${responses.length ? `<form method="post" action="/forms/${esc(form.id)}/responses/delete" data-confirm="Delete all ${responses.length} responses? This can't be undone.">${csrf}<button class="ghost small danger">Delete all responses</button></form>` : ""}
</div></div>
${responses.length ? `<h2 class="section">Summary</h2>${summaryBlocks(summarize(form, responses))}<h2 class="section">Individual responses</h2>${individual}` : `<div class="card empty"><p>Waiting for responses. Share <a href="/f/${esc(form.id)}">${esc(`${config.publicUrl}/f/${form.id}`)}</a></p></div>`}
<script type="module" src="/static/confirm.js"></script>`,
	});
}

export function message(title, text, { user, status = 400 } = {}) {
	return { status, html: page({ title, user, body: `<section class="card narrow"><h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="/">Go home</a></p></section>` }) };
}
