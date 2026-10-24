// @ts-check
/* global $status_text, main_canvas */

// Joke commands sprinkled through the menus:
// File › Taxes..., Image › Mental..., Adjustments › Attitude..., Page › Doctor, Colors › Of the Wind, Help › Send.
// None of them change your picture.

import { $DialogWindow } from "./$ToolWindow.js";
import { load_helper } from "./ai-content-aware-fill.js";
import { send_to_therapy } from "./ai-assistant.js";
import { E } from "./helpers.js";
import { showMessageBox } from "./msgbox.js";
import { get_plan, show_paint_plus } from "./paint-plus.js";

/**
 * A little progress window with changing steps. Resolves true when done, false if closed.
 * @param {string} title
 * @param {string[]} steps
 * @param {number} [duration]
 * @param {string} [class_name]
 */
function progress(title, steps, duration = 3000, class_name = "joke-progress-window") {
	return new Promise((resolve) => {
		const $w = $DialogWindow(title);
		$w.addClass(class_name);
		$w.$main.css({ padding: "10px", width: "280px", whiteSpace: "normal" });
		const $step = $(E("p")).css({ margin: "0 0 8px", minHeight: "2.5em" }).appendTo($w.$main);
		const $bar = $(E("progress")).attr({ max: 100, value: 0 }).css({ width: "100%" }).appendTo($w.$main);
		let done = false;
		$w.$Button("Cancel", () => { $w.close(); });
		$w.on("close", () => { if (!done) { resolve(false); } });
		$w.center();
		const started = performance.now();
		const tick = () => {
			if ($w.closed) { return; }
			const t = Math.min(1, (performance.now() - started) / duration);
			$bar.attr("value", Math.round(t * 100));
			$step.text(steps[Math.min(steps.length - 1, Math.floor(t * steps.length))]);
			if (t < 1) {
				setTimeout(tick, 50);
				return;
			}
			done = true;
			$w.close();
			resolve(true);
		};
		tick();
	});
}

/** File › Taxes...: does your taxes. You did not get a refund. */
export async function do_taxes() {
	const finished = await progress("Taxes", [
		"Gathering your receipts...",
		"Deducting reaction gifs as a business expense...",
		"Claiming the paperclip as a dependent...",
		"Itemizing your pixels...",
		"Contacting the Image Revenue Service...",
		"Calculating your refund...",
	], 3500, "taxes-window");
	if (!finished) { return; }
	const owed = Math.max(1, Math.ceil(main_canvas.width * main_canvas.height / 10000));
	$status_text.text("Taxes filed. Refund: $0.00.");
	showMessageBox({
		title: "Taxes",
		iconID: "info",
		message: `Your taxes are done!\n\nRefund: $0.00\n\nYou did not get a refund. In fact, you owe ${owed.toLocaleString("en-US")} ${owed === 1 ? "pixel" : "pixels"} (the standard 0.01% pixel tax), due April 15.`,
	});
}

/** Image › Mental...: connects with your mental imagery. The assistant needs a moment after that. */
export async function connect_mental_imagery() {
	const finished = await progress("Mental Image", [
		"Clearing your mind...",
		"Visualizing...",
		"Connecting with your mental imagery...",
		"Oh.",
		"Oh no.",
	], 3500, "mental-window");
	if (!finished) { return; }
	const assistant_went = send_to_therapy();
	showMessageBox({
		title: "Mental Image",
		iconID: "info",
		message: `You have connected with your mental imagery.\n\nThe Paint Assistant saw it too, and ${assistant_went ? "is going to go talk to someone about it." : "has booked a therapy appointment."}\n\nYour mental image cannot be saved as a bitmap. That's probably for the best.`,
	});
}

const ATTITUDE_STEPS = [
	"Hi! It looks like you're trying to adjust your attitude. I can help with that!",
	"Step 1: Unclench your mouse hand. And your sphincter. Go on. I can see them both.",
	"Step 2: Remember, there are no mistakes, only happy little undo steps.",
	"Step 3: Say it with me: \"My art is valid.\" Now say it like you mean it, even if no one else thinks it.",
	"Step 4: Look at your picture. Now look at me. Back at your picture. I'm a paperclip. Perspective! Your art can use better perspective.",
	"Step 5: Breathe in for 4 seconds. Hold for 4. Out for 4. Repeat breathing for the rest of your life, or until the picture looks better.",
	"Great job! Your attitude has been adjusted by +3%. Your picture has not been adjusted at all.",
];

/** Adjustments › Attitude...: the paperclip coaches you through an attitude adjustment. */
export function show_attitude_coach() {
	const $w = $DialogWindow("Attitude Adjustment");
	$w.addClass("attitude-window");
	$w.$main.css({ padding: "10px", width: "340px", display: "flex", gap: "10px", alignItems: "flex-start", whiteSpace: "normal" });
	const $coach = $(E("div")).addClass("attitude-coach").css({ width: "60px", height: "96px", flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "48px" }).text("📎").appendTo($w.$main);
	const $bubble = $(E("p")).addClass("attitude-text").css({
		margin: 0,
		padding: "8px 10px",
		flex: 1,
		background: "#ffffe1",
		color: "#000",
		border: "1px solid #000",
		borderRadius: "8px",
		minHeight: "4em",
	}).appendTo($w.$main);
	load_helper().then((helper) => {
		const canvas = /** @type {HTMLCanvasElement} */ (E("canvas"));
		canvas.width = helper.width;
		canvas.height = helper.height;
		/** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d")).drawImage(helper, 0, 0);
		$(canvas).css({ maxWidth: "100%", maxHeight: "100%" });
		$coach.empty().append(canvas);
	}, () => { /* no images/clippy.jpg: the emoji will do */ });

	let step = 0;
	const $next = $w.$Button("Next", () => {
		step++;
		show_step();
	}, { type: "submit" });
	$w.$Button("Close", () => { $w.close(); });
	const show_step = () => {
		$bubble.text(ATTITUDE_STEPS[step]);
		if (step === ATTITUDE_STEPS.length - 1) {
			$next.text("I feel better").off("click").on("click", () => {
				$w.close();
				$status_text.text("Attitude adjusted. Picture unchanged. Nobody's perfect.");
			});
		}
	};
	$w.center();
	show_step();
}

/** Two short pager beeps (if the browser lets us make sound). */
function pager_beep() {
	try {
		const audio = new AudioContext();
		for (const start of [0, 0.25]) {
			const oscillator = audio.createOscillator();
			const gain = audio.createGain();
			oscillator.type = "square";
			oscillator.frequency.value = 2400;
			gain.gain.value = 0.04;
			oscillator.connect(gain).connect(audio.destination);
			oscillator.start(audio.currentTime + start);
			oscillator.stop(audio.currentTime + start + 0.15);
		}
		setTimeout(() => { audio.close(); }, 1000);
	} catch {
		// no sound, then
	}
}

/** Page › Doctor: pages a doctor. To the OR. */
export function page_doctor() {
	pager_beep();
	$status_text.text("📟 Paging Dr. Bitmap... Dr. Bitmap to the OR, stat.");
	showMessageBox({
		title: "Page",
		iconID: "info",
		message: "📟 Paging Dr. Bitmap. Dr. Bitmap to the OR, stat.\n\nA doctor has been paged to the OR. Please keep your picture elevated and apply gentle pressure to any open selections.",
	});
}

/** Colors › Of the Wind: not in your plan. */
export async function colors_of_the_wind() {
	const plan = get_plan();
	const plan_note = plan === "free" ?
		"It's two tiers above Paint+ (which you also don't have)." :
		plan === "plus" ?
			"Your Paint+ plan doesn't include it. Neither does Paint+ Pro Max Ultra." :
			"Not even Paint+ Pro Max Ultra includes it. You'll need a bigger badge.";
	const answer = await showMessageBox({
		title: "Colors of the Wind",
		iconID: "info",
		message: `Painting with all the colors of the wind is only available in Paint+ Max, our upcoming paid tier.\n\n${plan_note}`,
		buttons: [
			{ label: "Join the Waitlist", value: "waitlist", default: true },
			{ label: "See Plans", value: "plans" },
			{ label: "Maybe Later", value: "later" },
		],
	});
	if (answer === "waitlist") {
		$status_text.text("You're on the Paint+ Max waitlist, at position #69,420. The wind thanks you for your patience.");
	} else if (answer === "plans") {
		show_paint_plus();
	}
}

/** Help › Send: sends help. */
export function send_help() {
	showMessageBox({
		title: "Send Help",
		iconID: "warning",
		message: "Help has been sent.\n\nAfter carefully reviewing your situation, Help has determined that you are beyond help.\n\nHelp Topics are still available, for everyone else.",
	});
}
