// The form editor: edits a copy of the form in memory and saves it shortly
// after each change. Structural changes re-render the list (animating cards
// from where they were to where they are); typing doesn't, so focus and the
// caret stay put.
import { reducedMotion, toast } from "./app.js";

const { form: initial, types: TYPES, themes: THEMES, publicUrl } = JSON.parse(document.getElementById("form-data").textContent);
const csrf = document.querySelector('meta[name="csrf"]').content;
const root = document.getElementById("builder");
const status = document.getElementById("status");
const statusText = status.querySelector(".save-text");

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

const SVG = "http://www.w3.org/2000/svg";
const PATHS = {
	up: "M12 19V5M6 11l6-6 6 6",
	down: "M12 5v14M6 13l6 6 6-6",
	copy: "M9 9h11v11H9zM5 15H4V4h11v1",
	trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
	close: "M6 6l12 12M18 6L6 18",
	plus: "M12 5v14M5 12h14",
};
function icon(name) {
	const svg = document.createElementNS(SVG, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("class", "icon-svg");
	svg.setAttribute("aria-hidden", "true");
	const path = document.createElementNS(SVG, "path");
	path.setAttribute("d", PATHS[name]);
	svg.append(path);
	return svg;
}

// saving

let timer, saving = false, again = false, dirty = false;
function setStatus(state, text) {
	status.dataset.state = state;
	statusText.textContent = text;
}
function changed() {
	dirty = true;
	setStatus("saving", "Saving…");
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
		if (res.ok) {
			setStatus("saved", "All changes saved");
			document.title = `${out.form.title} – ${document.title.split(" – ").pop()}`;
		} else {
			dirty = true;
			setStatus("error", out.error || "Couldn't save");
		}
	} catch {
		dirty = true;
		setStatus("error", "Offline: changes not saved yet");
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
	update(q, {});
	render(q.id, "select");
}

function move(index, by) {
	const to = index + by;
	if (to < 0 || to >= form.questions.length) return;
	const [q] = form.questions.splice(index, 1);
	form.questions.splice(to, 0, q);
	active = q.id;
	changed();
	render(q.id, `[data-move="${by < 0 ? "up" : "down"}"]`);
}

function addQuestion(after = form.questions.length - 1, copy = null) {
	const q = copy ? { ...structuredClone(copy), id: newId() } : { id: newId(), type: "choice", title: "", description: "", required: false, options: ["Option 1"] };
	form.questions.splice(after + 1, 0, q);
	active = q.id;
	changed();
	render(q.id, ".q-title-input", false, q.id);
}

async function removeQuestion(index) {
	const q = form.questions[index];
	const card = root.querySelector(`[data-id="${CSS.escape(q.id)}"]`);
	// play the card out, then close the gap
	if (card && !reducedMotion.matches) {
		card.style.height = `${card.offsetHeight}px`;
		card.classList.add("leaving");
		await new Promise((resolve) => {
			card.addEventListener("transitionend", resolve, { once: true });
			setTimeout(resolve, 400);
		});
	}
	form.questions.splice(form.questions.indexOf(q), 1);
	active = form.questions[Math.min(index, form.questions.length - 1)]?.id ?? null;
	changed();
	render(active, "[data-move]");
	toast("Question deleted");
}

// question cards

function optionsEditor(q) {
	const marker = q.type === "choice" ? "radio" : q.type === "checkbox" ? "box" : "num";
	const list = h("ol", { class: `option-edit ${marker}` });
	q.options.forEach((option, i) => {
		const input = h("input", {
			class: "line",
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
		list.append(h("li", { class: "option-row" }, h("span", { class: "option-marker", "aria-hidden": "true" }), input, q.options.length > 1
			? h("button", { type: "button", class: "icon", "aria-label": `Remove option ${i + 1}`, title: "Remove", onclick: () => { q.options.splice(i, 1); update(q, {}); render(q.id); } }, icon("close"))
			: null));
	});
	const add = h("button", {
		type: "button",
		class: "add-option",
		disabled: q.options.length >= 100,
		onclick: () => {
			q.options.push(`Option ${q.options.length + 1}`);
			update(q, {});
			render(q.id, ".option-edit li:last-child input", true);
		},
	}, icon("plus"), "Add option");
	return h("div", {}, list, add);
}

function scaleEditor(q) {
	const select = (value, values, key, label) =>
		h("select", { class: "boxed", "aria-label": label, onchange: (e) => { update(q, { [key]: Number(e.target.value) }); render(q.id, `[aria-label="${label}"]`); } },
			values.map((v) => h("option", { value: v, selected: v === value }, String(v))));
	const label = (key, n) => h("label", { class: "inline" }, h("span", { class: "scale-num" }, String(q[n])),
		h("input", { class: "line", value: q[key], placeholder: "Label (optional)", maxlength: 100, oninput: (e) => update(q, { [key]: e.target.value }) }));
	const preview = h("div", { class: "scale-preview", "aria-hidden": "true" });
	for (let n = q.min; n <= q.max; n++) preview.append(h("span", {}, String(n)));
	return h("div", { class: "scale-edit" },
		h("div", { class: "row" }, select(q.min, [0, 1], "min", "Lowest value"), h("span", { class: "dim" }, "to"), select(q.max, [2, 3, 4, 5, 6, 7, 8, 9, 10], "max", "Highest value")),
		preview, label("minLabel", "min"), label("maxLabel", "max"));
}

function sample(q) {
	const hint = { short: "Short answer text", paragraph: "Long answer text", date: "Month, day, year" }[q.type];
	return h("p", { class: `sample sample-${q.type}` }, hint);
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
		class: "q-title-input line",
		rows: 1,
		placeholder: "Question",
		"aria-label": "Question",
		maxlength: 500,
		value: q.title,
		oninput: (e) => update(q, { title: e.target.value }),
	});
	const type = h("select", { class: "boxed type-select", "aria-label": "Question type", onchange: (e) => setType(q, e.target.value) },
		Object.entries(TYPES).map(([value, label]) => h("option", { value, selected: value === q.type }, label)));
	const description = h("input", {
		class: "q-desc line",
		placeholder: "Description (optional)",
		"aria-label": "Description",
		maxlength: 2000,
		value: q.description,
		oninput: (e) => update(q, { description: e.target.value }),
	});
	const body = CHOICE.has(q.type) ? optionsEditor(q) : q.type === "scale" ? scaleEditor(q) : sample(q);
	const last = form.questions.length - 1;
	const button = (name, label, onclick, extra = {}) => h("button", { type: "button", class: "icon", title: label, "aria-label": label, onclick, ...extra }, icon(name));
	const footer = h("div", { class: "q-actions" },
		h("span", { class: "q-number" }, `${index + 1} of ${form.questions.length}`),
		h("span", { class: "grow" }),
		button("up", "Move up", () => move(index, -1), { "data-move": "up", disabled: index === 0 }),
		button("down", "Move down", () => move(index, 1), { "data-move": "down", disabled: index === last }),
		button("copy", "Duplicate", () => addQuestion(index, q)),
		button("trash", "Delete question", () => removeQuestion(index), { class: "icon danger-hover" }),
		h("span", { class: "divider" }),
		h("label", { class: "switch" }, h("span", {}, "Required"),
			h("input", { type: "checkbox", role: "switch", checked: q.required, onchange: (e) => update(q, { required: e.target.checked }) })));
	card.append(h("div", { class: "q-head" }, title, type), description, h("div", { class: "q-body" }, body), footer);
	return card;
}

// header and settings

function headCard() {
	return h("section", { class: "card form-head" },
		h("input", { class: "title-input line", value: form.title, "aria-label": "Form title", placeholder: "Form title", maxlength: 300, oninput: (e) => { form.title = e.target.value; changed(); } }),
		h("textarea", { class: "desc-input line", rows: 1, value: form.description, "aria-label": "Form description", placeholder: "Form description", maxlength: 5000, oninput: (e) => { form.description = e.target.value; changed(); } }));
}

function setTheme(theme) {
	form.settings.theme = theme;
	document.body.classList.remove(...THEMES.map((t) => `theme-${t}`));
	document.body.classList.add(`theme-${theme}`);
	for (const b of root.querySelectorAll(".swatch")) b.setAttribute("aria-checked", b.dataset.theme === theme);
	changed();
}

function settingsCard() {
	const s = form.settings;
	const toggle = (label, hint, checked, onchange, disabled = false) =>
		h("label", { class: "setting" }, h("span", {}, h("b", {}, label), h("span", { class: "dim" }, hint)),
			h("input", { type: "checkbox", role: "switch", checked, disabled, onchange: (e) => { onchange(e.target.checked); changed(); render(); } }));
	const current = s.theme ?? "blue";
	const swatches = h("div", { class: "swatches", role: "radiogroup", "aria-label": "Color" },
		THEMES.map((t) => h("button", { type: "button", role: "radio", class: `swatch theme-${t}`, "data-theme": t, "aria-checked": String(t === current), "aria-label": t, title: t, onclick: () => setTheme(t) })));
	return h("section", { class: "card settings" },
		h("h2", {}, "Settings"),
		h("div", { class: "setting" }, h("span", {}, h("b", {}, "Color"), h("span", { class: "dim" }, "Used for the form's header, buttons and charts.")), swatches),
		toggle("Accepting responses", "Turn off to close the form.", form.accepting, (v) => (form.accepting = v)),
		toggle("Require Xitter sign-in", "Respondents sign in, and you see which account answered.", s.requireSignIn, (v) => (s.requireSignIn = v), s.oneResponse),
		toggle("Limit to one response", "Each Xitter account can answer once. Requires sign-in.", s.oneResponse, (v) => { s.oneResponse = v; if (v) s.requireSignIn = true; }),
		toggle("Show results after submitting", "Respondents see charts of the choice questions, like a poll.", s.showResults, (v) => (s.showResults = v)),
		h("label", { class: "stack" }, h("b", {}, "Confirmation message"),
			h("textarea", { class: "boxed", rows: 2, maxlength: 1000, value: s.confirmation, placeholder: "Your response has been recorded.", oninput: (e) => { s.confirmation = e.target.value; changed(); } })),
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
	} else setStatus("error", "Couldn't delete the form");
}

// focusId/selector: where focus goes after re-rendering; entering: a card
// that's new and should grow in
function render(focusId = null, selector = null, selectAll = false, entering = null) {
	// FLIP: note where each card is, re-render, then slide cards from there
	const before = new Map([...root.querySelectorAll("[data-id]")].map((el) => [el.dataset.id, el.getBoundingClientRect().top]));
	const list = h("div", { class: "questions" }, form.questions.map(questionCard));
	const add = h("button", { type: "button", class: "add-question", onclick: () => addQuestion(form.questions.findIndex((q) => q.id === active)) }, icon("plus"), "Add question");
	root.replaceChildren(headCard(), list, add, settingsCard());
	for (const el of root.querySelectorAll("textarea")) grow(el);
	if (!reducedMotion.matches) {
		for (const el of list.children) {
			const was = before.get(el.dataset.id);
			if (el.dataset.id === entering) el.classList.add("entering");
			else if (was !== undefined) {
				const dy = was - el.getBoundingClientRect().top;
				if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
			}
		}
	}
	if (focusId) {
		const card = root.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
		const target = (selector && card?.querySelector(selector)) || card?.querySelector(".q-title-input");
		target?.focus({ preventScroll: true });
		if (selectAll) target?.select?.();
		card?.scrollIntoView({ block: "nearest", behavior: reducedMotion.matches ? "auto" : "smooth" });
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

document.getElementById("copy-link").addEventListener("click", async () => {
	const link = `${publicUrl}/f/${form.id}`;
	try {
		await navigator.clipboard.writeText(link);
		toast("Link copied");
	} catch {
		prompt("Copy this link", link);
	}
});

render();
