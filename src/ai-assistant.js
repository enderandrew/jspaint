// @ts-check
/* global current_history_node, selected_tool */

// AI > Assistant: a parody of the old Office Assistant. It sits in the corner and watches what you do,
// popping up with speech bubbles full of suggestions that are funny but never actually helpful.
// - It reacts to tools you pick, undoing a lot, lots of painting, and sitting idle; click it for a random tip.
// - Drag it anywhere. Turn it off with AI > Assistant (remembered in this browser).
// - It uses images/clippy.jpg (supplied separately, white background cut out), or a paperclip emoji without it.
// - It stays hidden by default in automated browsers (navigator.webdriver), so it doesn't get in the way of tests.

import { content_aware_fill, load_helper } from "./ai-content-aware-fill.js";
import { show_enhance_dialog } from "./ai-enhance.js";
import { is_ai_mode_active, start_ai_mode } from "./ai-mode.js";
import { show_prompt_box } from "./ai-prompt.js";
import { $G, E } from "./helpers.js";
import {
	TOOL_AIRBRUSH, TOOL_BRUSH, TOOL_CURVE, TOOL_ELLIPSE, TOOL_ERASER, TOOL_FILL, TOOL_FREE_FORM_SELECT, TOOL_LINE, TOOL_MAGNIFIER,
	TOOL_PENCIL, TOOL_PICK_COLOR, TOOL_POLYGON, TOOL_RECTANGLE, TOOL_ROUNDED_RECTANGLE, TOOL_SELECT, TOOL_TEXT, TOOL_WEB_TEXT
} from "./tools.js";

const STORAGE_KEY = "jspaint ai assistant hidden";
const CONTEXT_COOLDOWN = 15 * 1000; // ms between tips it volunteers
const IDLE_TIME = 90 * 1000;
const BUBBLE_TIMEOUT = 15 * 1000; // a tip with no buttons goes away on its own
const ACTIONS_PER_NUDGE = 40; // painting this many steps earns a suggestion

/**
 * @typedef {{ label: string, then?: string | Tip | (() => void) }} TipButton
 * @typedef {{ text: string, buttons?: TipButton[] }} Tip
 */

/** @type {Tip} */
const INTRO = {
	text: "Hi! I'm your Paint Assistant. It looks like you're trying to paint a picture. Would you like help?",
	buttons: [
		{ label: "Yes, please", then: "Great! Step 1: Paint something good. Step 2: There is no step 2." },
		{ label: "No thanks", then: "OK! I'll be right here. Watching. Not blinking. Judging." },
	],
};

/** @type {Record<string, Tip>} */
const TOOL_TIPS = {
	[TOOL_PENCIL]: { text: "It looks like you're using the Pencil. Did you know a pencil is just a brush that gave up?" },
	[TOOL_BRUSH]: { text: "Tip: For thicker lines, press harder on your monitor." },
	[TOOL_AIRBRUSH]: { text: "It looks like you're airbrushing. Remember: in the '90s, everything was airbrushed. Even the dolphins." },
	[TOOL_ERASER]: {
		text: "It looks like you're erasing something. Would you like me to erase it harder?",
		buttons: [
			{ label: "Yes", then: "Done! I've erased it from my memory. The picture is unchanged." },
			{ label: "No", then: "Probably wise. Some mistakes are happy accidents. Not this one, but some." },
		],
	},
	[TOOL_FILL]: { text: "Tip: The paint bucket holds exactly one bucket of paint. Use it wisely." },
	[TOOL_PICK_COLOR]: { text: "Can't decide on a color? Teal. The answer is always teal." },
	[TOOL_MAGNIFIER]: {
		text: "It looks like you're zooming in. Would you like me to ENHANCE?",
		buttons: [
			{ label: "Enhance!", then: () => show_enhance_dialog() },
			{ label: "Just zoom", then: "Zooming is what amateurs do. Enhancing is what TV detectives do." },
		],
	},
	[TOOL_TEXT]: {
		text: "It looks like you're writing a letter. Would you like help?",
		buttons: [
			{ label: "Get help with writing the letter", then: "Dear Sir or Madam, ... There! I've done the hard part. You take it from here." },
			{ label: "Just type the letter without help", then: "Bold choice. I'll be over here, judging your kerning." },
		],
	},
	[TOOL_WEB_TEXT]: {
		text: "It looks like you're putting text on a web page. Would you like it to blink?",
		buttons: [
			{ label: "Yes!", then: "Sorry, browsers dropped <blink> years ago. I'm still not over it." },
			{ label: "No", then: "Suit yourself. Have you considered a hit counter? Or two?" },
		],
	},
	[TOOL_LINE]: { text: "Tip: The shortest distance between two points is a straight line. The Line tool knows this. Do you?" },
	[TOOL_CURVE]: { text: "It looks like you're drawing a curve. Have you tried drawing a line, but with feelings?" },
	[TOOL_RECTANGLE]: { text: "Tip: A square is just a rectangle that has made peace with itself." },
	[TOOL_ROUNDED_RECTANGLE]: { text: "Tip: Rounded rectangles are safer for children and pets." },
	[TOOL_ELLIPSE]: { text: "Tip: An ellipse is a circle that's been sat on." },
	[TOOL_POLYGON]: { text: "Tip: \"Polygon\" is Greek for \"many corners.\" Count them. I'll wait." },
	[TOOL_SELECT]: {
		text: "It looks like you're selecting something. Would you like me to remove it with Content-Aware Fill? I could move in!",
		buttons: [
			{ label: "Yes", then: () => content_aware_fill() },
			{ label: "No", then: "That's OK. I'll just wait right here in the corner. Rent-free." },
		],
	},
	[TOOL_FREE_FORM_SELECT]: { text: "It looks like you're drawing around something. Tip: Hold very still. It can smell fear." },
};

/** @type {Tip[]} */
const RANDOM_TIPS = [
	{ text: "Tip: Save your work often. Or don't. I'm a paperclip, not a cop." },
	{ text: "Did you know? Paint was released in 1985, only about 40,000 years after the first cave paintings. Progress!" },
	{ text: "Tip: To draw a perfect circle, draw an imperfect one and believe in it." },
	{ text: "Tip: You can undo anything, except the past." },
	{ text: "Tip: If your picture looks bad, try squinting." },
	{ text: "Did you know? A picture is worth a thousand words. This one is worth about six." },
	{ text: "Tip: Hold Shift to make lines straight. Hold your breath to make them straighter." },
	{ text: "Did you know? Your screen can show 16 million colors. The palette shows you 28. You're welcome." },
	{ text: "Tip: Remember to stretch! Image > Stretch/Skew is a great place to start." },
	{ text: "Tip: Modern art is just Paint with a bigger budget." },
	{ text: "Tip: Right-click uses the other color. Left-click also uses a color. Colors are everywhere. Stay vigilant." },
	{ text: "Tip: Art is never finished, only abandoned. Would you like to abandon it now?", buttons: [{ label: "Yes", then: "Me neither. Keep going!" }, { label: "No", then: "Good. I believe in you. Mostly." }] },
	{ text: "It looks like you're trying to make a website. Have you considered a hit counter? Have you considered two?" },
	{ text: "Did you know? I've been helping people since 1997, and I've never once been thanked." },
	{ text: "Tip: The \"Recycle Bin\" is where pictures go to think about what they did." },
	{ text: "Tip: If you burn everything down and restart society then this art won't look bad in comparison." },
	{ text: "Tip: It is only plagiarism if you get caught." },
	{ text: "Tip: Your drawing might be well received by those who are visually impaired." },
	{ text: "Tip: xkcd makes a fortune on stick figures. What is your problem?" },
	{ text: "Tip: It helps to have a good concept in mind before drawing. Better than yours." },
	{ text: "Tip: Some people are beyond help." },
	{
		text: "Would you like to hear a joke?",
		buttons: [
			{ label: "Yes", then: "Why did the bitmap go to therapy? It had too many issues with its depth. ...I'll show myself out." },
			{ label: "No", then: "Too late. Why was the JPEG sad? It felt compressed." },
		],
	},
	{
		text: "It looks like you need inspiration. Would you like the AI to generate something?",
		buttons: [
			{ label: "Yes", then: () => show_prompt_box() },
			{ label: "No", then: "Real artists starve anyway. It builds character." },
		],
	},
];

/** @type {Tip[]} */
const IDLE_TIPS = [
	{ text: "It looks like you're staring at the screen. Would you like me to stare back?", buttons: [{ label: "Yes", then: "👀" }, { label: "No", then: "Too late. 👀" }] },
	{ text: "Still there? Tip: Paintings don't paint themselves. Unless you turn on AI Mode." },
	{ text: "It looks like you're waiting for inspiration. Inspiration is also waiting. This could take a while." },
	{ text: "I am the face of your intrusive thoughts. Arson is fun." },
];

/** @type {Tip} */
const UNDO_TIP = {
	text: "It looks like you're making mistakes. Would you like me to help you make them faster?",
	buttons: [
		{ label: "Yes", then: "Great! Next time, press Ctrl+Z twice as hard." },
		{ label: "No", then: "OK. Your mistakes, your pace. I respect that." },
	],
};
/** @type {Tip} */
const LOTS_OF_UNDO_TIP = { text: "Wow, that's a lot of undoing. Tip: File > New is just one giant Undo." };

/** @type {Tip[]} */
const BUSY_TIPS = [
	{
		text: "Wow, that's a lot of clicking. Have you tried AI Mode? It's like painting, but without the talent.",
		buttons: [
			{ label: "Try AI Mode", then: () => { if (!is_ai_mode_active()) { start_ai_mode(); } } },
			{ label: "I like clicking", then: "Me too. Click me sometime." },
		],
	},
	{ text: "You've been working hard! Tip: Take a break. Your picture will still be here. Unfortunately." },
	{
		text: "This is looking great! Would you like me to make it look even greater with AI Upscale?",
		buttons: [
			{ label: "Enhance!", then: () => show_enhance_dialog() },
			{ label: "No", then: "Fine. Stay low-resolution. See if I care." },
		],
	},
];

const GOODBYE = "Fine. I'll be in the Recycle Bin if you need me.";

let visible = false;
/** @type {HTMLElement | null} */
let $root = null;
let last_context_tip = 0;
const told = new Set();
/** @type {number | undefined} */
let bubble_timer;
/** @type {number | undefined} */
let idle_timer;
let undo_streak = 0;
let actions = 0;
/** @type {object | null} */
let last_history_node = null;

const pick = (/** @type {Tip[]} */ tips) => tips[Math.floor(Math.random() * tips.length)];

function add_styles() {
	if (document.getElementById("ai-assistant-styles")) { return; }
	const style = E("style");
	style.id = "ai-assistant-styles";
	style.textContent = `
		.ai-assistant {
			position: fixed;
			right: 24px;
			bottom: 84px;
			z-index: 900;
			display: flex;
			flex-direction: column;
			align-items: flex-end;
			pointer-events: none;
			font-family: "MS Sans Serif", Arial, sans-serif;
			font-size: 12px;
		}
		.ai-assistant > * { pointer-events: auto; }
		.ai-assistant-bubble {
			position: relative;
			max-width: 230px;
			margin-bottom: 12px;
			padding: 8px 10px;
			background: #ffffe1;
			color: #000;
			border: 1px solid #000;
			border-radius: 8px;
			box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.35);
			text-align: left;
			white-space: normal;
		}
		.ai-assistant-bubble::after {
			content: "";
			position: absolute;
			right: 36px;
			bottom: -10px;
			border: 10px solid transparent;
			border-bottom: 0;
			border-top-color: #000;
		}
		.ai-assistant-bubble::before {
			content: "";
			position: absolute;
			right: 37px;
			bottom: -8px;
			border: 9px solid transparent;
			border-bottom: 0;
			border-top-color: #ffffe1;
			z-index: 1;
		}
		.ai-assistant-bubble[hidden] { display: none; }
		.ai-assistant-text { margin: 0 14px 0 0; line-height: 1.35; }
		.ai-assistant-buttons { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
		.ai-assistant-buttons:empty { display: none; }
		.ai-assistant-buttons > button { text-align: left; padding: 3px 8px; min-height: 23px; }
		.ai-assistant-buttons > button::before { content: "● "; color: #0000a0; }
		.ai-assistant-bubble > button.ai-assistant-close {
			position: absolute;
			top: 2px;
			right: 4px;
			padding: 0 4px;
			border: 0;
			background: none;
			box-shadow: none;
			font-size: 14px;
			line-height: 1;
			min-width: 0;
			min-height: 0;
			cursor: pointer;
		}
		.ai-assistant-character {
			width: 72px;
			height: 112px;
			margin-right: 10px;
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			touch-action: none;
			user-select: none;
			font-size: 64px;
			filter: drop-shadow(2px 3px 2px rgba(0, 0, 0, 0.35));
		}
		.ai-assistant-character canvas { max-width: 100%; max-height: 100%; }
		.ai-assistant-talk { animation: ai-assistant-wiggle 0.6s ease-in-out; }
		.ai-assistant-arrive { animation: ai-assistant-arrive 0.5s ease-out; }
		@keyframes ai-assistant-wiggle {
			0%, 100% { transform: rotate(0); }
			20% { transform: rotate(-8deg) translateY(-4px); }
			40% { transform: rotate(6deg); }
			60% { transform: rotate(-4deg) translateY(-2px); }
			80% { transform: rotate(2deg); }
		}
		@keyframes ai-assistant-arrive {
			from { transform: translateY(40px) scale(0.6); opacity: 0; }
			to { transform: none; opacity: 1; }
		}
		@media (prefers-reduced-motion: reduce) {
			.ai-assistant-talk, .ai-assistant-arrive { animation: none; }
		}
	`;
	document.head.append(style);
}

function build() {
	add_styles();
	const root = E("div");
	root.className = "ai-assistant";
	root.setAttribute("role", "complementary");
	root.setAttribute("aria-label", "Assistant");
	root.innerHTML = `
		<div class="ai-assistant-bubble" role="status" aria-live="polite" hidden>
			<button type="button" class="ai-assistant-close" aria-label="Close">×</button>
			<p class="ai-assistant-text"></p>
			<div class="ai-assistant-buttons"></div>
		</div>
		<div class="ai-assistant-character" title="Click me for a tip! Drag me anywhere." role="button" tabindex="0" aria-label="Assistant: click for a tip">📎</div>
	`;
	const character = /** @type {HTMLElement} */ (root.querySelector(".ai-assistant-character"));
	/** @type {HTMLElement} */ (root.querySelector(".ai-assistant-close")).addEventListener("click", hide_bubble);

	// Click for a tip; drag to move
	character.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) { return; }
		event.preventDefault();
		const start_x = event.clientX;
		const start_y = event.clientY;
		const rect = root.getBoundingClientRect();
		let dragging = false;
		character.setPointerCapture(event.pointerId);
		const on_move = (/** @type {PointerEvent} */ move) => {
			const dx = move.clientX - start_x;
			const dy = move.clientY - start_y;
			if (!dragging && Math.hypot(dx, dy) < 5) { return; }
			dragging = true;
			const right = Math.min(window.innerWidth - 60, Math.max(0, window.innerWidth - rect.right - dx));
			const bottom = Math.min(window.innerHeight - 60, Math.max(0, window.innerHeight - rect.bottom - dy));
			root.style.right = `${right}px`;
			root.style.bottom = `${bottom}px`;
		};
		const on_up = () => {
			character.removeEventListener("pointermove", on_move);
			character.removeEventListener("pointerup", on_up);
			character.removeEventListener("pointercancel", on_up);
			if (!dragging) { say(pick(RANDOM_TIPS)); }
		};
		character.addEventListener("pointermove", on_move);
		character.addEventListener("pointerup", on_up);
		character.addEventListener("pointercancel", on_up);
	});
	character.addEventListener("keydown", (event) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			say(pick(RANDOM_TIPS));
		}
	});

	load_helper().then((helper) => {
		const canvas = /** @type {HTMLCanvasElement} */ (E("canvas"));
		canvas.width = helper.width;
		canvas.height = helper.height;
		/** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d")).drawImage(helper, 0, 0);
		character.textContent = "";
		character.append(canvas);
	}, () => {
		// no images/clippy.jpg: the emoji will do
	});
	document.body.append(root);
	return root;
}

function animate(/** @type {string} */ class_name) {
	const character = $root?.querySelector(".ai-assistant-character");
	if (!character) { return; }
	character.classList.remove(class_name);
	void (/** @type {HTMLElement} */ (character).offsetWidth); // restart the animation
	character.classList.add(class_name);
}

function hide_bubble() {
	clearTimeout(bubble_timer);
	const bubble = $root?.querySelector(".ai-assistant-bubble");
	if (bubble) { /** @type {HTMLElement} */ (bubble).hidden = true; }
}

function bubble_is_asking() {
	const bubble = /** @type {HTMLElement | null | undefined} */ ($root?.querySelector(".ai-assistant-bubble"));
	return Boolean(bubble && !bubble.hidden && bubble.querySelector(".ai-assistant-buttons button"));
}

/**
 * Shows a tip in the speech bubble.
 * @param {Tip | string} tip
 */
export function say(tip) {
	if (!visible || !$root) { return; }
	if (typeof tip === "string") { tip = { text: tip }; }
	const bubble = /** @type {HTMLElement} */ ($root.querySelector(".ai-assistant-bubble"));
	const text = /** @type {HTMLElement} */ ($root.querySelector(".ai-assistant-text"));
	const buttons = /** @type {HTMLElement} */ ($root.querySelector(".ai-assistant-buttons"));
	clearTimeout(bubble_timer);
	text.textContent = tip.text;
	buttons.textContent = "";
	for (const { label, then } of tip.buttons ?? []) {
		const button = /** @type {HTMLButtonElement} */ (E("button"));
		button.type = "button";
		button.textContent = label;
		button.addEventListener("click", () => {
			if (typeof then === "function") {
				hide_bubble();
				then();
			} else if (then) {
				say(then);
			} else {
				hide_bubble();
			}
		});
		buttons.append(button);
	}
	bubble.hidden = false;
	animate("ai-assistant-talk");
	if (!tip.buttons?.length) {
		bubble_timer = window.setTimeout(hide_bubble, BUBBLE_TIMEOUT);
	}
}

/**
 * Volunteers a tip about what you're doing, unless it has spoken up recently or is waiting for an answer.
 * @param {string} key each one only once per session
 * @param {Tip} tip
 */
function chime_in(key, tip) {
	if (!visible || told.has(key) || bubble_is_asking()) { return; }
	if (Date.now() - last_context_tip < CONTEXT_COOLDOWN) { return; }
	told.add(key);
	last_context_tip = Date.now();
	say(tip);
}

function reset_idle_timer() {
	clearTimeout(idle_timer);
	if (!visible) { return; }
	idle_timer = window.setTimeout(() => {
		if (!bubble_is_asking()) {
			last_context_tip = Date.now();
			say(pick(IDLE_TIPS));
		}
		reset_idle_timer();
	}, IDLE_TIME);
}

export function is_assistant_visible() {
	return visible;
}

/** @param {{ greet?: boolean, remember?: boolean }} [options] */
export function show_assistant({ greet = true, remember = true } = {}) {
	if (visible) { return; }
	visible = true;
	if (remember) {
		try { localStorage.removeItem(STORAGE_KEY); } catch { /* fine */ }
	}
	$root ??= build();
	$root.hidden = false;
	animate("ai-assistant-arrive");
	last_history_node = current_history_node;
	reset_idle_timer();
	if (greet && !told.has("intro")) {
		told.add("intro");
		last_context_tip = Date.now();
		say(INTRO);
	}
}

export function hide_assistant() {
	if (!visible) { return; }
	try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* fine */ }
	say(GOODBYE);
	visible = false;
	clearTimeout(idle_timer);
	const root = $root;
	setTimeout(() => {
		if (!visible && root) {
			root.hidden = true;
			hide_bubble();
		}
	}, 1800);
}

/**
 * Image › Mental: the assistant has seen your mental imagery, and takes some time off to talk to someone.
 * It leaves (without that counting as turning it off) and comes back later.
 * @returns {boolean} whether it was there to go
 */
export function send_to_therapy(away_ms = 60 * 1000) {
	if (!visible || !$root) { return false; }
	say("I've seen your mental imagery. I'm going to need to talk to someone about it. Back in a minute.");
	visible = false;
	clearTimeout(idle_timer);
	const root = $root;
	setTimeout(() => {
		if (!visible) {
			root.hidden = true;
			hide_bubble();
		}
	}, 3500);
	setTimeout(() => {
		let hidden_meanwhile = false;
		try { hidden_meanwhile = localStorage.getItem(STORAGE_KEY) === "1"; } catch { /* fine */ }
		if (visible || hidden_meanwhile) { return; }
		show_assistant({ greet: false, remember: false });
		say("I'm back from therapy. We mostly talked about your picture. I'm working through it.");
	}, away_ms);
	return true;
}

export function toggle_assistant() {
	if (visible) {
		hide_assistant();
	} else {
		show_assistant();
	}
}

// What it watches
$G.on("tool-changed", () => {
	const tip = TOOL_TIPS[selected_tool?.id];
	if (tip) { chime_in(`tool:${selected_tool.id}`, tip); }
});
$G.on("history-update", () => {
	if (!visible) { return; }
	const previous = /** @type {{ parent?: object | null } | null} */ (last_history_node);
	const node = /** @type {{ parent?: object | null }} */ (current_history_node);
	last_history_node = node;
	if (!previous || node === previous) { return; }
	// went back to an earlier state: an undo
	let ancestor = previous.parent;
	while (ancestor && ancestor !== node) { ancestor = /** @type {{ parent?: object | null }} */ (ancestor).parent; }
	if (ancestor === node) {
		undo_streak++;
		if (undo_streak === 3) { chime_in("undo", UNDO_TIP); }
		if (undo_streak === 8) { chime_in("lots-of-undo", LOTS_OF_UNDO_TIP); }
		return;
	}
	undo_streak = 0;
	if (node.parent === previous) {
		actions++;
		if (actions % ACTIONS_PER_NUDGE === 0) { chime_in(`busy:${actions}`, pick(BUSY_TIPS)); }
	}
});
for (const type of ["pointerdown", "keydown"]) {
	window.addEventListener(type, reset_idle_timer, { capture: true, passive: true });
}

// Show up on page load, unless turned off before (or in an automated browser, such as the UI tests)
let hidden_before = false;
try { hidden_before = localStorage.getItem(STORAGE_KEY) === "1"; } catch { /* fine */ }
if (!hidden_before && !navigator.webdriver) {
	setTimeout(() => show_assistant({ remember: false }), 3000);
}
