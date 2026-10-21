import { randomId } from "./util.js";

export const TYPES = {
	short: "Short answer",
	paragraph: "Paragraph",
	choice: "Multiple choice",
	checkbox: "Checkboxes",
	dropdown: "Dropdown",
	scale: "Linear scale",
	date: "Date",
};
export const CHOICE_TYPES = new Set(["choice", "checkbox", "dropdown"]);

const LIMITS = { questions: 200, options: 100, short: 1000, paragraph: 20000 };

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
const int = (value, min, max, fallback) => (Number.isInteger(value) && value >= min && value <= max ? value : fallback);

// what the builder sends, cut down to what we store
export function sanitizeForm(input) {
	const seen = new Set();
	const questions = (Array.isArray(input?.questions) ? input.questions : []).slice(0, LIMITS.questions).map((q) => {
		const type = Object.hasOwn(TYPES, q?.type) ? q.type : "short";
		const id = typeof q?.id === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(q.id) && !seen.has(q.id) ? q.id : randomId(6);
		seen.add(id);
		const out = { id, type, title: text(q.title, 500), description: text(q.description, 2000), required: q.required === true };
		if (CHOICE_TYPES.has(type)) {
			out.options = (Array.isArray(q.options) ? q.options : []).slice(0, LIMITS.options).map((o) => text(o, 300));
			if (!out.options.length) out.options = ["Option 1"];
		}
		if (type === "scale") {
			out.min = int(q.min, 0, 1, 1);
			out.max = int(q.max, 2, 10, 5);
			out.minLabel = text(q.minLabel, 100);
			out.maxLabel = text(q.maxLabel, 100);
		}
		return out;
	});
	const settings = input?.settings ?? {};
	const oneResponse = settings.oneResponse === true;
	return {
		title: text(input?.title, 300).trim() || "Untitled form",
		description: text(input?.description, 5000),
		questions,
		accepting: input?.accepting !== false,
		settings: {
			// one response per account needs to know whose account it is
			requireSignIn: settings.requireSignIn === true || oneResponse,
			oneResponse,
			showResults: settings.showResults === true,
			confirmation: text(settings.confirmation, 1000),
		},
	};
}

// choices people can actually pick (the builder can leave blanks behind)
export const optionsOf = (q) => [...new Set((q.options ?? []).map((o) => o.trim()).filter(Boolean))];

export function scaleSteps(q) {
	const steps = [];
	for (let n = q.min; n <= q.max; n++) steps.push(n);
	return steps;
}

function validDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const d = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

// a submitted form (URLSearchParams) checked against the questions:
// { answers, errors, values } where values echo back what was typed
export function readSubmission(form, params) {
	const answers = {}, errors = {}, values = {};
	for (const q of form.questions) {
		const key = `q_${q.id}`;
		let answer = null;
		if (q.type === "checkbox") {
			const options = optionsOf(q);
			const picked = [...new Set(params.getAll(key))];
			values[q.id] = picked;
			if (picked.some((p) => !options.includes(p))) errors[q.id] = "Pick from the options given.";
			else if (picked.length) answer = picked;
		} else {
			const raw = String(params.get(key) ?? "").trim();
			values[q.id] = raw;
			if (raw) {
				if (q.type === "short" || q.type === "paragraph") {
					if (raw.length > LIMITS[q.type]) errors[q.id] = `Keep it under ${LIMITS[q.type].toLocaleString("en")} characters.`;
					else answer = raw;
				} else if (q.type === "choice" || q.type === "dropdown") {
					if (optionsOf(q).includes(raw)) answer = raw;
					else errors[q.id] = "Pick one of the options given.";
				} else if (q.type === "scale") {
					const n = Number(raw);
					if (Number.isInteger(n) && n >= q.min && n <= q.max) answer = n;
					else errors[q.id] = `Pick a number from ${q.min} to ${q.max}.`;
				} else if (q.type === "date") {
					if (validDate(raw)) answer = raw;
					else errors[q.id] = "Enter a valid date.";
				}
			}
		}
		if (answer === null && q.required && !errors[q.id]) errors[q.id] = "This is a required question.";
		if (answer !== null) answers[q.id] = answer;
	}
	return { answers, errors, values, ok: Object.keys(errors).length === 0 };
}

// per question: how often each choice was picked, or the text answers
export function summarize(form, responses) {
	return form.questions.map((q) => {
		const given = responses.map((r) => r.answers[q.id]).filter((a) => a !== undefined);
		if (CHOICE_TYPES.has(q.type) || q.type === "scale") {
			const keys = q.type === "scale" ? scaleSteps(q).map(String) : optionsOf(q);
			const counts = new Map(keys.map((k) => [k, 0]));
			for (const a of given) for (const v of Array.isArray(a) ? a : [a]) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
			return { question: q, answered: given.length, counts: [...counts] };
		}
		return { question: q, answered: given.length, texts: given.map(String) };
	});
}

export const answerText = (answer) => (answer === undefined ? "" : Array.isArray(answer) ? answer.join(", ") : String(answer));

// CSV with formula injection defused, for opening in a spreadsheet
export function toCsv(form, responses) {
	const cell = (value) => {
		let s = String(value ?? "");
		if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
		return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const header = ["Timestamp", "Xitter account", ...form.questions.map((q) => q.title || "Untitled question")];
	const rows = responses.map((r) => [
		new Date(r.created_at).toISOString(),
		// no leading @: spreadsheets read that as the start of a formula
		r.screen_name ? `${r.screen_name}@${new URL(r.instance).host}` : "",
		...form.questions.map((q) => answerText(r.answers[q.id])),
	]);
	return `﻿${[header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
