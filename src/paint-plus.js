// @ts-check
/* global $status_text, current_history_node */

// Help > Upgrade to Paint+...: a parody of software subscriptions.
// - Three plans: Paint (free, what you have), Paint+ ($4.99/month: everything you have, plus a badge),
//   and Paint+ Pro Max Ultra ($99.99/month: a bigger badge).
// - "Payment" is a joke choice (exposure, one pixel, or watching an ad); no payment details are ever asked for.
// - Subscribing shows a badge in the menu bar. Canceling is, as is tradition, a maze of "are you sure?" and offers.
// - Free users get the occasional upsell in the status bar. The plan is remembered in this browser.

import { $DialogWindow } from "./$ToolWindow.js";
import { $G, E } from "./helpers.js";
import { showMessageBox } from "./msgbox.js";
import { show_terms_of_service } from "./terms-of-service.js";

const STORAGE_KEY = "jspaint paint+ plan";
const ACTIONS_PER_NAG = 75;

/** @typedef {"free" | "plus" | "ultra"} Plan */

const PLANS = /** @type {const} */ ([
	{ id: "free", name: "Paint", price: "Free", perks: ["Everything you have now", "Ads (coming soon)"] },
	{ id: "plus", name: "Paint+", price: "$4.99/month", perks: ["Everything you have now", "A badge", "Priority pixels*"] },
	{ id: "ultra", name: "Paint+ Pro Max Ultra", price: "$99.99/month", perks: ["Everything in Paint+", "A bigger badge", "It sparkles"] },
]);

const PAYMENT_METHODS = [
	{ id: "exposure", label: "Exposure", detail: "We'll mention you to our friends." },
	{ id: "pixel", label: "Exactly one pixel", detail: "Taken from the top-left corner. You won't notice." },
	{ id: "ad", label: "Watch a short ad", detail: "Only 5 seconds. Probably." },
];

/** @type {{ plan: Plan, since: string, discounted?: boolean }} */
let subscription = { plan: "free", since: "" };
try {
	const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
	if (saved && (saved.plan === "plus" || saved.plan === "ultra")) { subscription = saved; }
} catch { /* fine: free it is */ }

let busy = false;

export function get_plan() {
	return subscription.plan;
}

/** @param {Plan} plan */
function set_plan(plan, { discounted = false } = {}) {
	subscription = plan === "free" ? { plan, since: "" } : { plan, since: subscription.since || new Date().toISOString(), discounted };
	try {
		if (plan === "free") {
			localStorage.removeItem(STORAGE_KEY);
		} else {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(subscription));
		}
	} catch { /* fine */ }
	update_badge();
}

function update_badge() {
	document.querySelectorAll(".paint-plus-badge").forEach((badge) => badge.remove());
	if (subscription.plan === "free") { return; }
	const menus = document.querySelector(".menus");
	if (!menus) { return; }
	const badge = E("span");
	badge.className = "paint-plus-badge";
	const ultra = subscription.plan === "ultra";
	badge.textContent = ultra ? "✨ PLUS PRO MAX ULTRA ✨" : "PLUS";
	badge.title = ultra ? "Paint+ Pro Max Ultra member. Very important." : "Paint+ member";
	Object.assign(badge.style, {
		alignSelf: "center",
		marginLeft: "auto",
		marginRight: "6px",
		padding: ultra ? "1px 8px" : "0 5px",
		font: `bold ${ultra ? 12 : 10}px "MS Sans Serif", Arial, sans-serif`,
		color: "#fff",
		background: ultra ? "linear-gradient(90deg, #c000c0, #0060ff, #00b060, #e0a000)" : "#000080",
		borderRadius: "3px",
		boxShadow: "1px 1px 0 #000",
		whiteSpace: "nowrap",
		cursor: "pointer",
	});
	badge.addEventListener("click", () => show_paint_plus());
	menus.append(badge);
}

/** A little fake progress window. Resolves when done, or false if closed. */
function processing(/** @type {string} */ title, /** @type {string[]} */ steps, duration = 2200) {
	return new Promise((resolve) => {
		const $w = $DialogWindow(title);
		$w.addClass("paint-plus-processing");
		$w.$main.css({ padding: "10px", width: "280px", whiteSpace: "normal" });
		const $step = $(E("p")).css({ margin: "0 0 8px" }).text(steps[0]).appendTo($w.$main);
		const $progress = $(E("progress")).attr({ max: 100, value: 0 }).css({ width: "100%" }).appendTo($w.$main);
		let done = false;
		$w.on("close", () => { if (!done) { resolve(false); } });
		$w.center();
		const started = performance.now();
		const tick = () => {
			if ($w.closed) { return; }
			const t = Math.min(1, (performance.now() - started) / duration);
			$progress.attr("value", Math.round(t * 100));
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

/** The ad you can pay with. It's an ad for Paint+. */
function watch_ad() {
	return new Promise((resolve) => {
		const $w = $DialogWindow("Advertisement");
		$w.addClass("paint-plus-ad");
		$w.$main.css({ padding: "0", width: "320px", whiteSpace: "normal" });
		const $ad = $(E("div")).css({
			padding: "18px 14px",
			textAlign: "center",
			color: "#fff",
			background: "linear-gradient(135deg, #000080, #1084d0)",
			font: "bold 16px 'MS Sans Serif', Arial, sans-serif",
		}).appendTo($w.$main);
		$(E("p")).css({ margin: "0 0 6px", fontSize: "20px" }).text("Tired of ads?").appendTo($ad);
		$(E("p")).css({ margin: 0, fontWeight: "normal" }).text("Upgrade to Paint+ and never see this ad again, except right now, while you upgrade to Paint+.").appendTo($ad);
		const $countdown = $(E("p")).css({ margin: "8px 10px", fontSize: "11px" }).appendTo($w.$main);
		let seconds = 5;
		let finished = false;
		const $skip = $w.$Button("Skip Ad", () => {
			finished = true;
			$w.close();
			resolve(true);
		}).prop("disabled", true).addClass("paint-plus-skip");
		$w.on("close", () => { if (!finished) { resolve(false); } });
		$w.center();
		const tick = () => {
			if ($w.closed) { return; }
			$countdown.text(seconds > 0 ? `Your ad will end in ${seconds}... You can skip it in ${seconds}.` : "You may now skip the ad you just watched.");
			if (seconds <= 0) {
				$skip.prop("disabled", false);
				return;
			}
			seconds--;
			setTimeout(tick, 1000);
		};
		tick();
	});
}

/**
 * Subscribes to a plan, after the "payment."
 * @param {"plus" | "ultra"} plan
 * @param {string} method
 */
async function subscribe(plan, method) {
	if (busy) { return; }
	busy = true;
	try {
		if (method === "ad" && !await watch_ad()) { return; }
		const paid = await processing("Paint+", [
			"Contacting your bank...",
			"Your bank is laughing...",
			"Processing anyway...",
			method === "pixel" ? "Removing one pixel..." : method === "exposure" ? "Exposing you..." : "Counting ad impressions...",
			"Activating badge...",
		]);
		if (!paid) { return; }
		set_plan(plan);
		const name = plan === "ultra" ? "Paint+ Pro Max Ultra" : "Paint+";
		$status_text.text(`Welcome to ${name}! Everything works exactly the same, but now you have a badge.`);
		showMessageBox({
			title: name,
			iconID: "info",
			message: `Welcome to ${name}!\n\nYou now have access to:\n• Everything you had before\n• ${plan === "ultra" ? "A bigger badge (look up and to the right)\n• Sparkles" : "A badge (look up and to the right)"}\n\nYour first month is free. So are all the others.`,
		});
	} finally {
		busy = false;
	}
}

/** The plans, side by side, with a choice of "payment". */
function show_plans() {
	const $w = $DialogWindow("Upgrade to Paint+");
	$w.addClass("paint-plus-window");
	$w.$main.css({ padding: "8px", whiteSpace: "normal" });
	$(E("p")).css({ margin: "0 0 8px", fontWeight: "bold", fontSize: "14px" }).text("Choose the plan that's right for you.").appendTo($w.$main);

	const $plans = $(E("div")).css({ display: "flex", gap: "8px" }).appendTo($w.$main);
	let method = PAYMENT_METHODS[0].id;
	for (const plan of PLANS) {
		const current = subscription.plan === plan.id;
		const $plan = $(E("fieldset")).css({ width: "140px", margin: 0, display: "flex", flexDirection: "column", gap: "6px" }).appendTo($plans);
		$(E("legend")).text(plan.name).appendTo($plan);
		$(E("div")).css({ fontSize: "16px", fontWeight: "bold" }).text(plan.price).appendTo($plan);
		const $perks = $(E("ul")).css({ margin: 0, paddingLeft: "16px", flex: 1 }).appendTo($plan);
		for (const perk of plan.perks) { $(E("li")).text(perk).appendTo($perks); }
		const $button = $(E("button")).attr("type", "button").addClass(`paint-plus-choose-${plan.id}`).appendTo($plan);
		if (current) {
			$button.text("Current Plan").prop("disabled", true);
		} else if (plan.id === "free") {
			$button.text("Downgrade").on("click", () => {
				$w.close();
				cancel_subscription();
			});
		} else {
			$button.text("Subscribe").on("click", () => {
				$w.close();
				subscribe(/** @type {"plus" | "ultra"} */ (plan.id), method);
			});
		}
	}

	const $payment = $(E("fieldset")).css({ margin: "8px 0 0" }).appendTo($w.$main);
	$(E("legend")).text("Payment method").appendTo($payment);
	for (const option of PAYMENT_METHODS) {
		// (the theme draws radio buttons on the label that follows them)
		const id = `paint-plus-payment-${option.id}`;
		const $field = $(E("div")).addClass("radio-field").css({ margin: "2px 0" }).appendTo($payment);
		$(E("input")).attr({ type: "radio", name: "paint-plus-payment", value: option.id, id }).prop("checked", option.id === method)
			.on("change", () => { method = option.id; }).appendTo($field);
		const $label = $(E("label")).attr("for", id).text(option.label).appendTo($field);
		$(E("span")).css({ color: "#555", marginLeft: "0.4em" }).text(`(${option.detail})`).appendTo($label);
	}
	const $fine_print = $(E("p")).css({ margin: "8px 0 0", fontSize: "11px", color: "#555" }).appendTo($w.$main);
	$fine_print.append("*Priority pixels are the same pixels, but first. By subscribing you agree to the ");
	$(E("a")).attr("href", "#").text("Terms of Service").on("click", (event) => {
		event.preventDefault();
		show_terms_of_service();
	}).appendTo($fine_print);
	$fine_print.append(", which you already agreed to.");
	$w.$Button("Close", () => { $w.close(); });
	$w.center();
}

/** Canceling: as easy as it is anywhere else. */
async function cancel_subscription() {
	const name = subscription.plan === "ultra" ? "Paint+ Pro Max Ultra" : "Paint+";
	const sure = await showMessageBox({
		title: `Cancel ${name}`,
		iconID: "warning",
		message: `Are you sure you want to cancel ${name}?\n\nYou'll lose your badge.`,
		buttons: [
			{ label: `Keep ${name}`, value: "keep", default: true },
			{ label: "Continue canceling", value: "continue" },
		],
	});
	if (sure !== "continue") { return; }
	const offer = await showMessageBox({
		title: `Cancel ${name}`,
		iconID: "info",
		message: "Wait! Before you go, how about 50% off?\n\nThat's a badge that's 50% as shiny, for half the price.",
		buttons: [
			{ label: "Accept offer", value: "accept", default: true },
			{ label: "No, cancel", value: "cancel" },
		],
	});
	if (offer === "accept") {
		set_plan(subscription.plan, { discounted: true });
		$status_text.text("Great news! Your badge is now 50% off, and exactly as shiny as before.");
		return;
	}
	if (offer !== "cancel") { return; }
	const reason = await showMessageBox({
		title: `Cancel ${name}`,
		iconID: "info",
		message: "We're sorry to see you go. Please tell us why you're leaving:",
		buttons: [
			{ label: "Too expensive", value: "price" },
			{ label: "Not enough features", value: "features" },
			{ label: "I wanted to see what would happen", value: "curious" },
		],
	});
	if (reason === "closed") { return; }
	set_plan("free");
	$status_text.text("We'll miss you. (We've kept your data. You agreed to this in the Terms of Service.)");
	showMessageBox({
		title: name,
		iconID: "info",
		message: `Your ${name} subscription has been canceled, and your badge has been removed.\n\nYou can still use everything you could before, which is everything.`,
	});
}

/** Your subscription, with options to upgrade or (try to) cancel. */
function show_manage() {
	const name = subscription.plan === "ultra" ? "Paint+ Pro Max Ultra" : "Paint+";
	const price = subscription.plan === "ultra" ? "$99.99/month" : "$4.99/month";
	const $w = $DialogWindow("Manage Subscription");
	$w.addClass("paint-plus-manage");
	$w.$main.css({ padding: "10px", width: "300px", whiteSpace: "normal" });
	const since = subscription.since ? new Date(subscription.since).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "a while ago";
	const lines = [
		`Plan: ${name}`,
		`Price: ${price}${subscription.discounted ? " (50% off, still $0.00)" : ""}`,
		`Member since: ${since}`,
		"Next billing date: never, probably",
	];
	for (const line of lines) { $(E("p")).css({ margin: "0 0 4px" }).text(line).appendTo($w.$main); }
	if (subscription.plan === "plus") {
		$w.$Button("Upgrade to Pro Max Ultra", () => {
			$w.close();
			subscribe("ultra", "exposure");
		});
	} else {
		$(E("p")).css({ margin: "8px 0 0", fontStyle: "italic" }).text("You have the best plan. There is nothing more to buy. For now.").appendTo($w.$main);
	}
	$w.$Button("Cancel Subscription", () => {
		$w.close();
		cancel_subscription();
	});
	$w.$Button("Close", () => { $w.close(); });
	$w.center();
}

/** Help > Upgrade to Paint+... (or manage it, if you already have it) */
export function show_paint_plus() {
	if (subscription.plan === "free") {
		show_plans();
	} else {
		show_manage();
	}
}

// The occasional upsell for free users, in the status bar
let actions = 0;
/** @type {object | null} */
let last_history_node = null;
$G.on("history-update", () => {
	const previous = last_history_node;
	last_history_node = current_history_node;
	if (subscription.plan !== "free" || !previous || current_history_node.parent !== previous) { return; }
	actions++;
	if (actions % ACTIONS_PER_NAG === 0) {
		$status_text.text("Enjoying Paint? Paint+ members enjoy it exactly as much. Help > Upgrade to Paint+...");
	}
});

// The badge, once the menu bar exists
setTimeout(update_badge, 0);
