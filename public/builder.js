// The form editor: edits a copy of the form in memory and saves it shortly
// after each change. Structural changes re-render the list; typing doesn't,
// so focus and the caret stay put.
const { form: initial, types: TYPES, publicUrl } = JSON.parse(document.getElementById("form-data").textContent);
const csrf = document.querySelector('meta[name="csrf"]').content;
const root = document.getElementById("builder");
const status = document.getElementById("status");

const CHOICE = new Set(["choice", "checkbox", "dropdown"]);
const form = structuredClone(initial);
let active = form.questions[0]?.id ?? null;

const newId = () => {
	const bytes = crypto.getRandomValues(new Uint8Array(6));
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

// h("div", { class: "x", onclick }, child, ...) -> element
function h(tag, attrs = {}, ...children) {
	const el = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (value === undefined || value === false || value === null) continue;
		if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
		else if (key === "value") el.value = value;
		else if (key === "checked") el.checked = value;
		else el.setAttribute(key, value === true ? "" : value);
	}
	for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child);
	return el;
}

// saving

let timer, saving = false, again = false, dirty = false;
function changed() {
	dirty = true;
	status.textContent = "Saving…";
	clearTimeout(timer);
	timer = setTimeout(save, 500);
}
async function save() {
	if (saving) return void (again = true);
	saving = true;
	dirty = false;
	try {
		const res = await fetch(`/api/forms/${encodeURIComponent(form.id)}`, {
			method: "PUT",
			headers: { "content-type": "application/json", accept: "application/json", "x-csrf-token": csrf },
			body: JSON.stringify(form),
		});
		const out = await res.json().catch(() => ({}));
		status.textContent = res.ok ? "All changes saved" : out.error || "Couldn't save";
		if (!res.ok) dirty = true;
		else document.title = `${out.form.title} – ${document.title.split(" – ").pop()}`;
	} catch {
		dirty = true;
		status.textContent = "Offline: changes not saved yet";
		timer = setTimeout(save, 5000);
	}
	saving = false;
	if (again) {
		again = false;
		save();
	}
}
addEventListener("beforeunload", (e) => {
	if (dirty || saving) e.preventDefault();
});

// editing

function update(q, patch, rerender = false) {
	Object.assign(q, patch);
	changed();
	if (rerender) render();
}

function setType(q, type) {
	q.type = type;
	if (CHOICE.has(type) && !q.options?.length) q.options = ["Option 1"];
	if (type === "scale") Object.assign(q, { min: q.min ?? 1, max: q.max ?? 5, minLabel: q.minLabel ?? "", maxLabel: q.maxLabel ?? "" });
	update(q, {}, true);
}

function move(index, by) {
	const to = index + by;
	if (to < 0 || to >= form.questions.length) return;
	const [q] = form.questions.splice(index, 1);
	form.questions.splice(to, 0, q);
	changed();
	render(q.id, `[data-move="${by < 0 ? "up" : "down"}"]`);
}

function addQuestion(after = form.questions.length - 1, copy = null) {
	const q = copy ? { ...structuredClone(copy), id: newId() } : { id: newId(), type: "choice", title: "", description: "", required: false, options: ["Option 1"] };
	form.questions.splice(after + 1, 0, q);
	active = q.id;
	changed();
	render(q.id, ".q-title-input");
}

function removeQuestion(index) {
	form.questions.splice(index, 1);
	active = form.questions[Math.min(index, form.questions.length - 1)]?.id ?? null;
	changed();
	render(active, "[data-move]");
}

// question cards

function optionsEditor(q) {
	const marker = q.type === "choice" ? "radio" : q.type === "checkbox" ? "box" : "num";
	const list = h("ol", { class: `option-edit ${marker}` });
	q.options.forEach((option, i) => {
		const input = h("input", {
			value: option,
			"aria-label": `Option ${i + 1}`,
			maxlength: 300,
			oninput: (e) => update(q, { options: q.options.with(i, e.target.value) }),
			onkeydown: (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					q.options.splice(i + 1, 0, `Option ${q.options.length + 1}`);
					update(q, {});
					render(q.id, `.option-edit li:nth-child(${i + 2}) input`, true);
				}
				if (e.key === "Backspace" && !e.target.value && q.options.length > 1) {
					e.preventDefault();
					q.options.splice(i, 1);
					update(q, {});
					render(q.id, `.option-edit li:nth-child(${Math.max(i, 1)}) input`);
				}
			},
		});
		list.append(h("li", {}, input, q.options.length > 1
			? h("button", { type: "button", class: "icon", "aria-label": `Remove option ${i + 1}`, title: "Remove", onclick: () => { q.options.splice(i, 1); update(q, {}, true); } }, "×")
			: null));
	});
	const add = h("button", {
		type: "button",
		class: "ghost small",
		disabled: q.options.length >= 100,
		onclick: () => {
			q.options.push(`Option ${q.options.length + 1}`);
			update(q, {});
			render(q.id, ".option-edit li:last-child input", true);
		},
	}, "+ Add option");
	return h("div", {}, list, add);
}

function scaleEditor(q) {
	const select = (value, values, onchange, label) =>
		h("select", { "aria-label": label, onchange: (e) => update(q, { [onchange]: Number(e.target.value) }, true) },
			values.map((v) => h("option", { value: v, selected: v === value }, String(v))));
	const label = (key, n) => h("label", { class: "inline" }, h("span", { class: "dim" }, String(q[n])),
		h("input", { value: q[key], placeholder: "Label (optional)", maxlength: 100, oninput: (e) => update(q, { [key]: e.target.value }) }));
	return h("div", { class: "scale-edit" },
		h("div", { class: "row" }, select(q.min, [0, 1], "min", "Lowest value"), h("span", {}, "to"), select(q.max, [2, 3, 4, 5, 6, 7, 8, 9, 10], "max", "Highest value")),
		label("minLabel", "min"), label("maxLabel", "max"));
}

function sample(q) {
	const hint = { short: "Short answer text", paragraph: "Long answer text", date: "Month, day, year" }[q.type];
	return h("p", { class: "sample" }, hint);
}

function questionCard(q, index) {
	const isActive = q.id === active;
	const card = h("section", {
		class: `card question-edit${isActive ? " active" : ""}`,
		"data-id": q.id,
		"aria-label": `Question ${index + 1}`,
		onfocusin: () => {
			if (active !== q.id) {
				active = q.id;
				for (const el of root.querySelectorAll(".question-edit.active")) el.classList.remove("active");
				card.classList.add("active");
			}
		},
	});
	const title = h("textarea", {
		class: "q-title-input",
		rows: 1,
		placeholder: "Question",
		"aria-label": "Question",
		maxlength: 500,
		value: q.title,
		oninput: (e) => update(q, { title: e.target.value }),
	});
	const type = h("select", { "aria-label": "Question type", onchange: (e) => setType(q, e.target.value) },
		Object.entries(TYPES).map(([value, label]) => h("option", { value, selected: value === q.type }, label)));
	const description = h("input", {
		class: "q-desc",
		placeholder: "Description (optional)",
		"aria-label": "Description",
		maxlength: 2000,
		value: q.description,
		oninput: (e) => update(q, { description: e.target.value }),
	});
	const body = CHOICE.has(q.type) ? optionsEditor(q) : q.type === "scale" ? scaleEditor(q) : sample(q);
	const last = form.questions.length - 1;
	const footer = h("div", { class: "q-actions" },
		h("button", { type: "button", class: "icon", "data-move": "up", title: "Move up", "aria-label": "Move up", disabled: index === 0, onclick: () => move(index, -1) }, "↑"),
		h("button", { type: "button", class: "icon", "data-move": "down", title: "Move down", "aria-label": "Move down", disabled: index === last, onclick: () => move(index, 1) }, "↓"),
		h("button", { type: "button", class: "icon", title: "Duplicate", "aria-label": "Duplicate", onclick: () => addQuestion(index, q) }, "⧉"),
		h("button", { type: "button", class: "icon", title: "Delete", "aria-label": "Delete question", onclick: () => removeQuestion(index) }, "🗑"),
		h("span", { class: "divider" }),
		h("label", { class: "switch" }, h("span", {}, "Required"),
			h("input", { type: "checkbox", role: "switch", checked: q.required, onchange: (e) => update(q, { required: e.target.checked }) })));
	card.append(h("div", { class: "q-head" }, title, type), description, body, footer);
	return card;
}

// header and settings

function headCard() {
	return h("section", { class: "card form-head" },
		h("input", { class: "title-input", value: form.title, "aria-label": "Form title", placeholder: "Form title", maxlength: 300, oninput: (e) => { form.title = e.target.value; changed(); } }),
		h("textarea", { class: "desc-input", rows: 2, value: form.description, "aria-label": "Form description", placeholder: "Form description", maxlength: 5000, oninput: (e) => { form.description = e.target.value; changed(); } }));
}

function settingsCard() {
	const s = form.settings;
	const toggle = (label, hint, checked, onchange, disabled = false) =>
		h("label", { class: "setting" }, h("span", {}, h("b", {}, label), h("span", { class: "dim" }, hint)),
			h("input", { type: "checkbox", role: "switch", checked, disabled, onchange: (e) => { onchange(e.target.checked); changed(); render(); } }));
	return h("section", { class: "card settings" },
		h("h2", {}, "Settings"),
		toggle("Accepting responses", "Turn off to close the form.", form.accepting, (v) => (form.accepting = v)),
		toggle("Require Xitter sign-in", "Respondents sign in, and you see which account answered.", s.requireSignIn, (v) => (s.requireSignIn = v), s.oneResponse),
		toggle("Limit to one response", "Each Xitter account can answer once. Requires sign-in.", s.oneResponse, (v) => { s.oneResponse = v; if (v) s.requireSignIn = true; }),
		toggle("Show results after submitting", "Respondents see charts of the choice questions, like a poll.", s.showResults, (v) => (s.showResults = v)),
		h("label", { class: "stack" }, h("b", {}, "Confirmation message"),
			h("textarea", { rows: 2, maxlength: 1000, value: s.confirmation, placeholder: "Your response has been recorded.", oninput: (e) => { s.confirmation = e.target.value; changed(); } })),
		h("div", { class: "row between danger-zone" }, h("span", { class: "dim" }, "Deleting removes the form and all its responses."),
			h("button", { type: "button", class: "ghost small danger", onclick: deleteForm }, "Delete form")));
}

async function deleteForm() {
	if (!confirm(`Delete "${form.title}" and all its responses? This can't be undone.`)) return;
	clearTimeout(timer);
	const res = await fetch(`/api/forms/${encodeURIComponent(form.id)}`, { method: "DELETE", headers: { accept: "application/json", "x-csrf-token": csrf } });
	if (res.ok) {
		dirty = false;
		location.href = "/";
	} else status.textContent = "Couldn't delete the form";
}

// focusId/selector: put focus back somewhere sensible after re-rendering
function render(focusId = null, selector = null, selectAll = false) {
	const list = h("div", { class: "questions" }, form.questions.map(questionCard));
	const add = h("button", { type: "button", class: "add-question", onclick: () => addQuestion(form.questions.findIndex((q) => q.id === active)) }, "+ Add question");
	root.replaceChildren(headCard(), list, add, settingsCard());
	for (const el of root.querySelectorAll("textarea")) grow(el);
	if (focusId) {
		const card = root.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
		const target = (selector && card?.querySelector(selector)) || card?.querySelector(".q-title-input");
		target?.focus();
		if (selectAll) target?.select?.();
		card?.scrollIntoView({ block: "nearest" });
	}
}

// textareas grow with their text
const grow = (el) => {
	el.style.height = "auto";
	el.style.height = `${el.scrollHeight + 2}px`;
};
root.addEventListener("input", (e) => {
	if (e.target instanceof HTMLTextAreaElement) grow(e.target);
});

document.getElementById("copy-link").addEventListener("click", async (e) => {
	const link = `${publicUrl}/f/${form.id}`;
	try {
		await navigator.clipboard.writeText(link);
		e.target.textContent = "Link copied";
	} catch {
		prompt("Copy this link", link);
	}
	setTimeout(() => (e.target.textContent = "Copy link"), 2000);
});

render();
