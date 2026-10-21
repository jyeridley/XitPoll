// Small touches shared by every page. Pages work without any of it.
export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// a short message at the bottom of the screen
let toastTimer;
export function toast(text) {
	const el = document.getElementById("toast");
	if (!el) return;
	el.textContent = text;
	el.classList.add("show");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// forms with data-confirm ask before they submit
for (const form of document.querySelectorAll("form[data-confirm]"))
	form.addEventListener("submit", (e) => {
		if (!confirm(form.dataset.confirm)) e.preventDefault();
	});

// a submit button with data-busy shows it's working, once
for (const button of document.querySelectorAll("button[data-busy]"))
	button.form?.addEventListener("submit", () => {
		button.classList.add("busy");
		button.textContent = button.dataset.busy;
		// back/forward cache would bring the page back stuck
		addEventListener("pageshow", (e) => e.persisted && location.reload());
	});

// how much of the form is answered, as a bar along the top
const progress = document.querySelector(".answer-progress");
const answers = document.querySelector("form.answers");
if (progress && answers) {
	const questions = [...answers.querySelectorAll("[data-question]")];
	const answered = (q) => [...q.querySelectorAll("input, textarea, select")].some((el) => (el.type === "radio" || el.type === "checkbox" ? el.checked : el.value.trim()));
	const update = () => {
		const done = questions.filter(answered).length;
		progress.style.setProperty("--done", questions.length ? done / questions.length : 0);
		for (const q of questions) q.classList.toggle("answered", answered(q));
	};
	progress.hidden = false;
	answers.addEventListener("input", update);
	answers.addEventListener("change", update);
	answers.addEventListener("reset", () => setTimeout(update));
	update();
}

// Summary / Individual tabs on the responses page
const tabs = document.querySelector(".tabs");
if (tabs) {
	const buttons = [...tabs.querySelectorAll("[role=tab]")];
	const select = (button) => {
		for (const b of buttons) {
			const on = b === button;
			b.setAttribute("aria-selected", on);
			b.tabIndex = on ? 0 : -1;
			const panel = document.getElementById(b.getAttribute("aria-controls"));
			panel.hidden = !on;
		}
	};
	tabs.hidden = false;
	for (const panel of document.querySelectorAll("[role=tabpanel] > h2.section")) panel.classList.add("visually-hidden");
	tabs.addEventListener("click", (e) => {
		const button = e.target.closest("[role=tab]");
		if (button) select(button);
	});
	tabs.addEventListener("keydown", (e) => {
		const i = buttons.indexOf(document.activeElement);
		if (i < 0 || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
		const next = buttons[(i + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
		next.focus();
		select(next);
	});
	select(buttons[0]);
}
