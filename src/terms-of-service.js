// @ts-check

// Help > Terms of Service: a parody of the "We've updated our Terms of Service" pop-up.
// It shows up on load until you've agreed to this version (remembered in this browser), with a wall of
// legal text and an "I Agree" button that only works once you've scrolled to the bottom. "I Disagree" also agrees.
// It stays away in automated browsers (navigator.webdriver), so it doesn't get in the way of tests.

import { $DialogWindow } from "./$ToolWindow.js";
import { E } from "./helpers.js";
import { showMessageBox } from "./msgbox.js";

export const TOS_VERSION = "98.0.3";
const STORAGE_KEY = "jspaint terms of service agreed";

const TERMS = [
	["Acceptance", "By opening Paint, looking at Paint, or thinking about Paint, you agree to these Terms. If you do not agree, you also agree."],
	["Your Pictures", "You keep all rights to your pictures. We keep all rights to the pixels they're made of."],
	["Pixels Are Licensed, Not Sold", "Each pixel is licensed to you for one use. Reusing a pixel (for example, by undoing and redoing) may result in a fee of $0.00, payable immediately."],
	["Colors", "The color Teal is used under license. Do not stare directly at Teal. Custom colors you create remain yours until you forget how you made them."],
	["AI Features", "We may use your pictures to train our AI, which is a paperclip. The paperclip does not learn anything, but it appreciates the effort."],
	["Undo", "Undo is provided \"as is.\" We do not guarantee that undoing something will make you feel better about it."],
	["Prohibited Uses", "You may not use Paint to (a) draw a better Paint, (b) count all the pixels, (c) draw hands without a license, or (d) read these Terms out loud at parties."],
	["Defragmentation", "Defragmenting your picture is at your own risk. Contiguous pixels may not be returned to their original order."],
	["Dispute Resolution", "Any dispute will be settled by a game of Minesweeper, best of three. The first click is not guaranteed to be safe."],
	["Paint+", "Paint+ members get everything free members get, plus a badge. Badges are non-transferable and non-refundable, and have no cash value, or any other kind."],
	["Changes to These Terms", "We may update these Terms at any time, and we will, often, usually when you're in the middle of something."],
	["Termination", "We may end your session if your art is too powerful."],
	["Severability", "If any part of these Terms is found unenforceable, the rest is still binding, and also a little bit sad."],
	["Entire Agreement", "These Terms, plus the ones we'll add later, are the entire agreement between you and Paint."],
	["Congratulations", "You read all the way to the bottom. Nobody does that. You may now click \"I Agree.\""],
];

let open = false;

export function has_agreed_to_terms() {
	try {
		return localStorage.getItem(STORAGE_KEY) === TOS_VERSION;
	} catch {
		return false;
	}
}

function remember_agreement() {
	try { localStorage.setItem(STORAGE_KEY, TOS_VERSION); } catch { /* fine */ }
}

/**
 * Shows the Terms of Service.
 * @param {{ update?: boolean }} [options] update: worded as the "we've updated our terms" pop-up
 */
export function show_terms_of_service({ update = false } = {}) {
	if (open) { return; }
	open = true;
	const $w = $DialogWindow(update ? "Terms of Service Update" : "Terms of Service");
	$w.addClass("terms-of-service-window");
	$w.$main.css({ padding: "8px", width: "400px", display: "flex", flexDirection: "column", gap: "8px", whiteSpace: "normal" });

	const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
	if (update) {
		$(E("p")).css({ margin: 0, fontWeight: "bold" }).text("We've updated our Terms of Service.").appendTo($w.$main);
		$(E("p")).css({ margin: 0 }).text("Here's a summary of what changed: everything, and nothing important. Please read and agree to the new Terms to keep using Paint, which you can do either way.").appendTo($w.$main);
	}
	const terms = E("div");
	terms.className = "terms-of-service-text inset-deep";
	Object.assign(terms.style, { height: "220px", overflowY: "auto", background: "#fff", color: "#000", padding: "6px 8px", fontSize: "12px", lineHeight: "1.4" });
	$(E("p")).css({ margin: "0 0 8px", textAlign: "center", fontWeight: "bold" }).text(`PAINT TERMS OF SERVICE, version ${TOS_VERSION}`).appendTo(terms);
	$(E("p")).css({ margin: "0 0 8px", textAlign: "center" }).text(`Last updated: ${today} (they're always updated today)`).appendTo(terms);
	TERMS.forEach(([heading, text], i) => {
		const p = E("p");
		p.style.margin = "0 0 8px";
		$(E("b")).text(`${i + 1}. ${heading}. `).appendTo(p);
		p.append(text);
		terms.append(p);
	});
	$w.$main.append(terms);
	const $hint = $(E("p")).css({ margin: 0, fontSize: "11px" }).text("Please scroll to the bottom to agree.").appendTo($w.$main);

	const agree = () => {
		remember_agreement();
		$w.close();
	};
	const $agree = $w.$Button("I Agree", agree).prop("disabled", true).addClass("terms-agree");
	$w.$Button("I Disagree", () => {
		agree();
		showMessageBox({
			title: "Terms of Service",
			iconID: "info",
			message: "Your disagreement has been noted, and filed under \"Agreements.\"\n\nThank you for agreeing to the Terms of Service.",
		});
	});
	const check_scrolled = () => {
		if (terms.scrollTop + terms.clientHeight >= terms.scrollHeight - 4) {
			$agree.prop("disabled", false);
			$hint.text("Thank you for reading. (We know you didn't.)");
		}
	};
	terms.addEventListener("scroll", check_scrolled, { passive: true });
	$w.on("close", () => { open = false; });
	$w.center();
	check_scrolled();
}

// The pop-up on load, until this version is agreed to
if (!has_agreed_to_terms() && !navigator.webdriver) {
	setTimeout(() => show_terms_of_service({ update: true }), 1500);
}
