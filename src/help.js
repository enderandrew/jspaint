// @ts-check
/* global $Window, localize */
// import { localize } from "./app-localization.js";
import { show_error_message } from "./functions.js";
import { $G, E } from "./helpers.js";
import { showMessageBox } from "./msgbox.js";
import { $DialogWindow } from "./$ToolWindow.js";

let $help_window;
function show_help() {
	if ($help_window) {
		$help_window.focus();
		return;
	}
	$help_window = open_help_viewer({
		title: localize("Paint Help"),
		root: "help",
		contentsFile: "help/mspaint.hhc",
		indexFile: "help/mspaint.hhk",
	}).$help_window;
	$help_window.on("close", () => {
		$help_window = null;
	});
}

// shared code with 98.js.org
// (copy-pasted / manually synced for now)

function open_help_viewer(options) {
	const $help_window = $Window({
		title: options.title || "Help Topics",
		icons: {
			16: "images/chm-16x16.png",
		},
		resizable: true,
	});
	$help_window.addClass("help-window");

	let ignore_one_load = true;
	let back_length = 0;
	let forward_length = 0;

	const $main = $(E("div")).addClass("main");
	const $toolbar = $(E("div")).addClass("toolbar");
	const add_toolbar_button = (name, sprite_n, action_fn, enabled_fn) => {
		const $button = /** @type JQuery<HTMLButtonElement> */ ($("<button class='lightweight'>")
			.append($("<span>").text(name))
			.appendTo($toolbar)
			.on("click", () => {
				action_fn();
			})
		);
		$("<div class='icon'/>")
			.appendTo($button)
			.css({
				backgroundPosition: `${-sprite_n * 55}px 0px`,
			});
		const update_enabled = () => {
			$button[0].disabled = enabled_fn && !enabled_fn();
		};
		update_enabled();
		$help_window.on("click", "*", update_enabled);
		$help_window.on("update-buttons", update_enabled);
		return $button;
	};
	const measure_sidebar_width = () =>
		$sidebar.outerWidth() +
		parseFloat(getComputedStyle($sidebar[0]).getPropertyValue("margin-left")) +
		parseFloat(getComputedStyle($sidebar[0]).getPropertyValue("margin-right")) +
		$resizer.outerWidth();
	const $hide_button = add_toolbar_button("Hide", 0, () => {
		const toggling_width = measure_sidebar_width();
		$sidebar.hide();
		$resizer.hide();
		$hide_button.hide();
		$show_button.show();
		$help_window.width($help_window.width() - toggling_width);
		$help_window.css("left", $help_window.offset().left + toggling_width);
		$help_window.bringTitleBarInBounds();
	});
	const $show_button = add_toolbar_button("Show", 5, () => {
		$sidebar.show();
		$resizer.show();
		$show_button.hide();
		$hide_button.show();
		const toggling_width = measure_sidebar_width();
		$help_window.css("max-width", "unset");
		$help_window.width($help_window.width() + toggling_width);
		$help_window.css("left", $help_window.offset().left - toggling_width);
		// $help_window.applyBounds() would push the window to fit (before trimming it only if needed)
		// Trim the window to fit (especially for if maximized)
		if ($help_window.offset().left < 0) {
			$help_window.width($help_window.width() + $help_window.offset().left);
			$help_window.css("left", 0);
		}
		$help_window.css("max-width", "");
	}).hide();
	add_toolbar_button("Back", 1, () => {
		$iframe[0].contentWindow.history.back();
		ignore_one_load = true;
		back_length -= 1;
		forward_length += 1;
	}, () => back_length > 0);
	add_toolbar_button("Forward", 2, () => {
		$iframe[0].contentWindow.history.forward();
		ignore_one_load = true;
		forward_length -= 1;
		back_length += 1;
	}, () => forward_length > 0);
	add_toolbar_button("Options", 3, () => { }, () => false); // @TODO: hotkey and underline on O
	add_toolbar_button("Web Help", 4, () => {
		iframe.src = "help/online_support.htm";
	});

	const $iframe = $Iframe({ src: "help/default.html" }).addClass("inset-deep");
	const iframe = $iframe[0];
	iframe.$window = $help_window; // for focus handling integration
	const $resizer = $(E("div")).addClass("resizer");
	const $contents = $(E("ul")).addClass("contents inset-deep");
	// The sidebar: Contents, Index, and Search tabs, like Windows 98's HTML Help
	const { $sidebar, show_tab } = make_help_sidebar($contents, (src) => { $iframe.attr({ src }); }, options);

	// @TODO: fix race conditions
	$iframe.on("load", () => {
		if (!ignore_one_load) {
			back_length += 1;
			forward_length = 0;
		}
		// iframe.contentWindow.location.href
		ignore_one_load = false;
		$help_window.triggerHandler("update-buttons");
		enable_glossary_popups(iframe);
	});

	$main.append($sidebar, $resizer, $iframe);
	$help_window.$content.append($toolbar, $main);

	$help_window.css({ width: 800, height: 600 });

	$iframe.attr({ name: "help-frame" });
	$iframe.css({
		backgroundColor: "white",
		border: "",
		margin: "1px",
	});
	$sidebar.css({
		margin: "1px",
	});
	$help_window.center();

	$main.css({
		position: "relative", // for resizer
	});

	const resizer_width = 4;
	$resizer.css({
		cursor: "ew-resize",
		width: resizer_width,
		boxSizing: "border-box",
		background: "var(--ButtonFace)",
		borderLeft: "1px solid var(--ButtonShadow)",
		boxShadow: "inset 1px 0 0 var(--ButtonHilight)",
		top: 0,
		bottom: 0,
		zIndex: 1,
	});
	$resizer.on("pointerdown", () => {
		let pointermove, pointerup;
		const getPos = (e) =>
			Math.min($help_window.width() - 100, Math.max(20,
				e.clientX - $help_window.$content.offset().left
			));
		$G.on("pointermove", pointermove = (e) => {
			$resizer.css({
				position: "absolute",
				left: getPos(e),
			});
			$sidebar.css({
				marginRight: resizer_width,
			});
		});
		$G.on("pointerup", pointerup = (e) => {
			$G.off("pointermove", pointermove);
			$G.off("pointerup", pointerup);
			$resizer.css({
				position: "",
				left: "",
			});
			$sidebar.css({
				flexBasis: getPos(e) - resizer_width,
				marginRight: "",
			});
		});
	});

	const parse_object_params = ($object) => {
		// parse an $(<object>) to a plain object of key value pairs
		const object = {};
		for (const param of $object.children("param").get()) {
			object[param.name] = param.value;
		}
		return object;
	};

	let $last_expanded;

	const $Item = (text) => {
		const $item = $(E("div")).addClass("item").text(text.trim());
		$item.on("mousedown", () => {
			$contents.find(".item").removeClass("selected");
			$item.addClass("selected");
		});
		$item.on("click", () => {
			const $li = $item.parent();
			if ($li.is(".folder")) {
				if ($last_expanded) {
					$last_expanded.not($li).removeClass("expanded");
				}
				$li.toggleClass("expanded");
				$last_expanded = $li;
			}
		});
		return $item;
	};

	const $default_item_li = $(E("li")).addClass("page");
	$default_item_li.append($Item("Welcome to Help").on("click", () => {
		$iframe.attr({ src: "help/default.html" });
	}));
	$contents.append($default_item_li);

	function renderItem(source_li, $folder_items_ul) {
		const object = parse_object_params($(source_li).children("object"));
		if ($(source_li).find("li").length > 0) {

			const $folder_li = $(E("li")).addClass("folder");
			$folder_li.append($Item(object.Name));
			$contents.append($folder_li);

			const $folder_items_ul = $(E("ul"));
			$folder_li.append($folder_items_ul);

			$(source_li).children("ul").children().get().forEach((li) => {
				renderItem(li, $folder_items_ul);
			});
		} else {
			const $item_li = $(E("li")).addClass("page");
			$item_li.append($Item(object.Name).on("click", () => {
				$iframe.attr({ src: `${options.root}/${object.Local}` });
			}));
			if ($folder_items_ul) {
				$folder_items_ul.append($item_li);
			} else {
				$contents.append($item_li);
			}
		}
	}

	fetch(options.contentsFile).then((response) => {
		response.text().then((hhc) => {
			$($.parseHTML(hhc)).filter("ul").children().get().forEach((li) => {
				renderItem(li, null);
			});
		}, (error) => {
			show_error_message(`${localize("Failed to launch help.")} Failed to read ${options.contentsFile}.`, error);
		});
	}, (_error) => {
		// access to error message is not allowed either, basically
		if (location.protocol === "file:") {
			showMessageBox({
				// <p>${localize("Failed to launch help.")}</p>
				// but it's already launched at this point

				// what's a good tutorial for starting a web server?
				// https://gist.github.com/willurd/5720255 - impressive list, but not a tutorial
				// https://attacomsian.com/blog/local-web-server - OK, good enough
				messageHTML: `
					<p>Help is not available when running from the <code>file:</code> protocol.</p>
					<p>To use this feature, <a href="https://attacomsian.com/blog/local-web-server">start a web server</a>.</p>
				`,
				iconID: "error",
			});
		} else {
			show_error_message(`${localize("Failed to launch help.")} ${localize("Access to %1 was denied.", options.contentsFile)}`);
		}
	});

	// @TODO: keyboard accessability
	// $help_window.on("keydown", (e)=> {
	// 	switch(e.keyCode){
	// 		case 37:
	// 			show_error_message("MOVE IT");
	// 			break;
	// 	}
	// });
	// var task = new Task($help_window);
	var task = {};
	task.$help_window = $help_window;
	task.show_tab = show_tab;
	return task;
}


var programs_being_loaded = 0;

/**
 * @typedef {object} I$Iframe
 * @property {() => void} focus_contents
 * @property {() => void} destroy
 *
 * @param {object} options
 * @param {string} options.src
 *
 * @returns {JQuery<HTMLIFrameElement & {$window: OSGUI$Window}>} $iframe
 */
function $Iframe(options) {
	var $iframe = /** @type {JQuery<HTMLIFrameElement & {$window: OSGUI$Window}> & I$Iframe} */ (
		$("<iframe allowfullscreen sandbox='allow-same-origin allow-scripts allow-forms allow-pointer-lock allow-modals allow-popups allow-downloads'>")
	);
	var iframe = $iframe[0];

	var disable_delegate_pointerup = false;

	$iframe.focus_contents = function () {
		if (!iframe.contentWindow) {
			return;
		}
		if (iframe.contentDocument.hasFocus()) {
			return;
		}

		disable_delegate_pointerup = true;
		iframe.contentWindow.focus();
		setTimeout(function () {
			iframe.contentWindow.focus();
			disable_delegate_pointerup = false;
		});
	};

	// Let the iframe to handle mouseup events outside itself
	var delegate_pointerup = function () {
		if (disable_delegate_pointerup) {
			return;
		}
		// (This try-catch may only be needed when the iframe's document isn't reachable.)
		try {
			if (iframe.contentWindow && iframe.contentWindow.jQuery) {
				iframe.contentWindow.jQuery("body").trigger("pointerup");
			}
			if (iframe.contentWindow) {
				const event = new iframe.contentWindow.MouseEvent("mouseup", { button: 0 });
				iframe.contentWindow.dispatchEvent(event);
				const event2 = new iframe.contentWindow.MouseEvent("mouseup", { button: 2 });
				iframe.contentWindow.dispatchEvent(event2);
			}
		} catch (error) {
			console.log("Failed to access iframe to delegate pointerup; got", error);
		}
	};
	$G.on("mouseup blur", delegate_pointerup);
	$iframe.destroy = () => {
		$G.off("mouseup blur", delegate_pointerup);
	};

	// @TODO: delegate pointermove events too?

	$("body").addClass("loading-program");
	programs_being_loaded += 1;

	$iframe.on("load", function () {

		if (--programs_being_loaded <= 0) {
			$("body").removeClass("loading-program");
		}

		// (This try-catch may only be needed when the iframe's document isn't reachable.)
		try {
			if (window.themeCSSProperties && window.applyTheme) {
				window.applyTheme(window.themeCSSProperties, iframe.contentDocument.documentElement);
			}

			// on Wayback Machine, and iframe's url not saved yet
			if (iframe.contentDocument.querySelector("#error #livewebInfo.available")) {
				var message = document.createElement("div");
				message.style.position = "absolute";
				message.style.left = "0";
				message.style.right = "0";
				message.style.top = "0";
				message.style.bottom = "0";
				message.style.background = "#c0c0c0";
				message.style.color = "#000";
				message.style.padding = "50px";
				iframe.contentDocument.body.appendChild(message);
				message.innerHTML = `<a target="_blank">Save this url in the Wayback Machine</a>`;
				message.querySelector("a").href =
					"https://web.archive.org/save/https://98.js.org/" +
					iframe.src.replace(/.*https:\/\/98.js.org\/?/, "");
				message.querySelector("a").style.color = "blue";
			}

			var $contentWindow = $(iframe.contentWindow);
			$contentWindow.on("pointerdown click", function () {
				iframe.$window?.focus();

				// from close_menus in $MenuBar
				$(".menu-button").trigger("release");
				// Close any rogue floating submenus
				$(".menu-popup").hide();
			});
			// We want to disable pointer events for other iframes, but not this one
			$contentWindow.on("pointerdown", function () {
				$iframe.css("pointer-events", "all");
				$("body").addClass("dragging");
			});
			$contentWindow.on("pointerup", function () {
				$("body").removeClass("dragging");
				$iframe.css("pointer-events", "");
			});
			// $("iframe").css("pointer-events", ""); is called elsewhere.
			// Otherwise iframes would get stuck in this interaction mode

			iframe.contentWindow.close = function () {
				iframe.$window?.close();
			};
			// @TODO: hook into saveAs (a la FileSaver.js) and another function for opening files
			// iframe.contentWindow.saveAs = function(){
			// 	saveAsDialog();
			// };

		} catch (error) {
			console.log("Failed to reach into iframe; got", error);
		}
	});
	if (options.src) {
		$iframe.attr({ src: options.src });
	}
	$iframe.css({
		minWidth: 0,
		minHeight: 0, // overrides user agent styling apparently, fixes Sound Recorder
		flex: 1,
		border: 0, // overrides user agent styling
	});

	return $iframe;
}

// function $IframeWindow(options) {

// 	var $win = $Window(options);

// 	var $iframe = $win.$iframe = $Iframe({ src: options.src });
// 	$win.$content.append($iframe);
// 	var iframe = $win.iframe = $iframe[0];
// 	// @TODO: should I instead of having iframe.$window, have something like get$Window?
// 	// Where all is $window needed?
// 	// I know it's used from within the iframe contents as frameElement.$window
// 	iframe.$window = $win;

// 	$win.on("close", function () {
// 		$iframe.destroy();
// 	});
// 	$win.onFocus($iframe.focus_contents);

// 	$iframe.on("load", function () {
// 		$win.show();
// 		$win.focus();
// 		// $iframe.focus_contents();
// 	});

// 	$win.setInnerDimensions = ({ width, height }) => {
// 		const width_from_frame = $win.width() - $win.$content.width();
// 		const height_from_frame = $win.height() - $win.$content.height();
// 		$win.css({
// 			width: width + width_from_frame,
// 			height: height + height_from_frame + 21,
// 		});
// 	};
// 	$win.setInnerDimensions({
// 		width: (options.innerWidth || 640),
// 		height: (options.innerHeight || 380),
// 	});
// 	$win.$content.css({
// 		display: "flex",
// 		flexDirection: "column",
// 	});

// 	// @TODO: cascade windows
// 	$win.center();
// 	$win.hide();

// 	return $win;
// }

// Fix dragging things (i.e. windows) over iframes (i.e. other windows)
// (when combined with a bit of css, .dragging iframe { pointer-events: none; })
// (and a similar thing in $IframeWindow)
$(window).on("pointerdown", function () {
	//console.log(e.type);
	$("body").addClass("dragging");
});
$(window).on("pointerup dragend blur", function (e) {
	//console.log(e.type);
	if (e.type === "blur") {
		if (document.activeElement.tagName.match(/iframe/i)) {
			return;
		}
	}
	$("body").removeClass("dragging");
	$("iframe").css("pointer-events", "");
});

// #region Glossary popups
// The original pages link terms with <a data-topic-id="…">; clicking one shows its definition in a small popup over the
// page (selectable text, like a tooltip you can copy from), the way Windows 98's Help did.
const GLOSSARY = {
	gl_pbrush_fore: ["foreground color", "The color you draw with when you use the left mouse button. It's the top square at the left end of the color box. Click a color in the color box to change it."],
	gl_pbrush_back: ["background color", "The color you draw with when you use the right mouse button. It's also the color the Eraser leaves behind, and the color of a selection's background. Right-click a color in the color box to change it."],
	gl_pbrush_opaque_def: ["opaque", "The selection or text covers what's under it, background color and all."],
	gl_pbrush_transparent_def: ["transparent", "The parts of the selection or text that are the background color are see-through, so what's under them shows."],
};

/** @param {HTMLIFrameElement} iframe */
function enable_glossary_popups(iframe) {
	const doc = iframe.contentDocument;
	if (!doc?.body) { return; }
	const style = doc.createElement("style");
	style.textContent = `
		a[data-topic-id] { color: #008000; text-decoration: underline dashed; cursor: pointer; }
		.glossary-popup {
			position: absolute; z-index: 10; max-width: 260px; padding: 6px 8px;
			background: #ffffe1; color: #000; border: 1px solid #000; box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.3);
			user-select: text; -webkit-user-select: text; cursor: text;
		}
	`;
	doc.head.append(style);
	/** @type {HTMLElement | null} */
	let popup = null;
	const close = () => { popup?.remove(); popup = null; };
	doc.addEventListener("click", (event) => {
		const target = /** @type {Element} */ (event.target);
		if (popup && popup.contains(target)) { return; } // clicking inside lets you select the text
		const link = target.closest?.("a[data-topic-id]");
		close();
		if (!link) { return; }
		event.preventDefault();
		const entry = GLOSSARY[/** @type {keyof typeof GLOSSARY} */ (link.getAttribute("data-topic-id")?.toLowerCase())];
		popup = doc.createElement("div");
		popup.className = "glossary-popup";
		popup.setAttribute("role", "tooltip");
		if (entry) {
			const term = doc.createElement("b");
			term.textContent = entry[0];
			popup.append(term, doc.createElement("br"), entry[1]);
		} else {
			popup.textContent = "No definition for this term yet.";
		}
		const rect = link.getBoundingClientRect();
		popup.style.left = `${Math.max(4, Math.min(rect.left + (doc.defaultView?.scrollX ?? 0), doc.documentElement.clientWidth - 270))}px`;
		popup.style.top = `${rect.bottom + (doc.defaultView?.scrollY ?? 0) + 4}px`;
		doc.body.append(popup);
	});
	doc.addEventListener("keydown", (event) => { if (event.key === "Escape") { close(); } });
}
// #endregion

// #region Contents, Index, and Search tabs
/**
 * Reads an HTML Help sitemap list item: its Name/Local params in order.
 * @param {Element} li
 * @returns {{ names: string[], locals: string[] }}
 */
function sitemap_params(li) {
	const object = [...li.children].find((child) => child.tagName === "OBJECT");
	const names = [];
	const locals = [];
	for (const param of object ? [...object.querySelectorAll("param")] : []) {
		const name = param.getAttribute("name")?.toLowerCase();
		if (name === "name") { names.push(param.getAttribute("value") ?? ""); }
		if (name === "local") { locals.push(param.getAttribute("value") ?? ""); }
	}
	return { names, locals };
}

/**
 * The index (.hhk): keywords, each with its topics; sub-keywords are indented under theirs.
 * @param {string} hhk
 * @returns {{ keyword: string, depth: number, topics: { title: string, local: string }[] }[]}
 */
function parse_index(hhk) {
	const doc = new DOMParser().parseFromString(hhk, "text/html");
	const entries = [];
	// Every keyword in document order, indented by how many lists it's in (the sitemap's <LI>s aren't closed, so the
	// parser's tree doesn't always nest sub-keywords inside their keyword's <LI>; counting the lists is reliable).
	for (const li of doc.querySelectorAll("li")) {
		const { names, locals } = sitemap_params(li);
		if (!names.length) { continue; }
		let depth = -1;
		for (let el = li.parentElement; el; el = el.parentElement) {
			if (el.tagName === "UL") { depth++; }
		}
		// the first Name is the keyword; then Name/Local pairs are its topics
		entries.push({ keyword: names[0], depth: Math.max(0, depth), topics: locals.map((local, i) => ({ title: names[i + 1] || local, local })) });
	}
	return entries;
}

/**
 * A list you can pick from with the mouse or the keyboard: ↑/↓ move, Enter (or a double-click) chooses.
 * @param {(index: number) => void} on_choose
 */
function $PickList(on_choose) {
	const $list = $(E("ul")).addClass("help-pick-list inset-deep").attr({ role: "listbox", tabindex: "0" });
	let selected = -1;
	const items = () => $list.children("li");
	const select = (/** @type {number} */ index, /** @type {ScrollLogicalPosition} */ block = "nearest") => {
		const $items = items();
		if (!$items.length) { selected = -1; return; }
		selected = Math.max(0, Math.min($items.length - 1, index));
		$items.removeClass("selected").attr("aria-selected", "false");
		const el = $items.eq(selected).addClass("selected").attr("aria-selected", "true")[0];
		el.scrollIntoView({ block });
	};
	$list.on("pointerdown", "li", (event) => { select(items().index(event.currentTarget)); });
	$list.on("dblclick", "li", (event) => { on_choose(items().index(event.currentTarget)); });
	$list.on("keydown", (event) => {
		if (event.key === "ArrowDown") { select(selected + 1); event.preventDefault(); }
		if (event.key === "ArrowUp") { select(selected - 1); event.preventDefault(); }
		if (event.key === "PageDown") { select(selected + 10); event.preventDefault(); }
		if (event.key === "PageUp") { select(selected - 10); event.preventDefault(); }
		if (event.key === "Enter" && selected >= 0) { on_choose(selected); event.preventDefault(); }
	});
	return {
		$list,
		select,
		get selected() { return selected; },
		/** @param {{ text: string, indent?: number }[]} rows */
		set_items(rows) {
			$list.empty();
			for (const row of rows) {
				$(E("li")).attr({ role: "option" }).css({ paddingLeft: `${4 + (row.indent ?? 0) * 16}px` }).text(row.text).appendTo($list);
			}
			selected = -1;
		},
	};
}

/**
 * Asks which topic to show, when an index keyword has several (Windows 98's "Topics Found").
 * @param {{ title: string, local: string }[]} topics
 * @param {(local: string) => void} show
 */
function choose_topic(topics, show) {
	const $w = $DialogWindow("Topics Found");
	$w.addClass("help-topics-found");
	$w.$main.css({ width: "320px", padding: "8px", whiteSpace: "normal" });
	$(E("p")).css({ margin: "0 0 6px" }).text("Click a topic, then click Display.").appendTo($w.$main);
	const display = (/** @type {number} */ index) => {
		if (index < 0) { return; }
		$w.close();
		show(topics[index].local);
	};
	const list = $PickList(display);
	list.set_items(topics.map((topic) => ({ text: topic.title })));
	list.$list.css({ height: "140px" }).appendTo($w.$main);
	list.select(0);
	$w.$Button("Display", () => { display(list.selected); }, { type: "submit" });
	$w.$Button("Cancel", () => { $w.close(); });
	$w.center();
	list.$list.trigger("focus");
}

/**
 * @param {JQuery<HTMLElement>} $contents - the Contents tree
 * @param {(src: string) => void} navigate
 * @param {{ root: string, contentsFile: string, indexFile?: string }} options
 */
function make_help_sidebar($contents, navigate, options) {
	const $sidebar = $(E("div")).addClass("help-sidebar");
	const $tabs = $(E("div")).addClass("help-tabs").attr({ role: "tablist" }).appendTo($sidebar);
	const $panels = $(E("div")).addClass("help-panels").appendTo($sidebar);
	const show = (/** @type {string} */ local) => { navigate(`${options.root}/${local}`); };

	// Index
	const $index = $(E("div")).addClass("help-panel help-index").attr({ role: "tabpanel" });
	const $index_input = $(E("input")).attr({ type: "text", "aria-label": "Keyword to find", spellcheck: "false" });
	$(E("label")).text("Type in the keyword to find:").append($index_input).appendTo($index);
	/** @type {ReturnType<typeof parse_index>} */
	let index_entries = [];
	const display_keyword = (/** @type {number} */ i) => {
		const entry = index_entries[i];
		if (!entry) { return; }
		if (entry.topics.length === 1) {
			show(entry.topics[0].local);
		} else if (entry.topics.length > 1) {
			choose_topic(entry.topics, show);
		}
	};
	const index_list = $PickList(display_keyword);
	index_list.$list.appendTo($index);
	$(E("button")).attr({ type: "button" }).text("Display").on("click", () => { display_keyword(index_list.selected); }).appendTo($(E("div")).addClass("help-panel-buttons").appendTo($index));
	$index_input.on("input", () => {
		// select the first keyword starting with what's typed
		const typed = String($index_input.val()).trim().toLowerCase();
		if (!typed) { return; }
		const i = index_entries.findIndex((entry) => entry.depth === 0 && entry.keyword.toLowerCase().startsWith(typed));
		if (i >= 0) { index_list.select(i, "start"); } // the match at the top, the way Windows 98's index did it
	});
	$index_input.on("keydown", (event) => {
		if (event.key === "Enter") { display_keyword(index_list.selected); event.preventDefault(); }
		if (event.key === "ArrowDown" || event.key === "ArrowUp") { index_list.$list.trigger("focus").trigger(event); event.preventDefault(); }
	});
	let index_loaded = false;
	const load_index = () => {
		if (index_loaded || !options.indexFile) { return; }
		index_loaded = true;
		fetch(options.indexFile).then((response) => response.text()).then((hhk) => {
			index_entries = parse_index(hhk);
			index_list.set_items(index_entries.map((entry) => ({ text: entry.keyword, indent: entry.depth })));
		}, (error) => {
			index_loaded = false;
			show_error_message(`${localize("Failed to launch help.")} Failed to read ${options.indexFile}.`, error);
		});
	};

	// Search
	const $search = $(E("div")).addClass("help-panel help-search").attr({ role: "tabpanel" });
	const $search_input = $(E("input")).attr({ type: "text", "aria-label": "Words to search for", spellcheck: "false" });
	$(E("label")).text("Type in the word(s) to search for:").append($search_input).appendTo($search);
	const $search_buttons = $(E("div")).addClass("help-panel-buttons").appendTo($search);
	const $search_status = $(E("p")).addClass("help-search-status").appendTo($search);
	/** @type {{ title: string, local: string }[]} */
	let results = [];
	const display_result = (/** @type {number} */ i) => { if (results[i]) { show(results[i].local); } };
	const search_list = $PickList(display_result);
	search_list.$list.appendTo($search);
	$(E("button")).attr({ type: "button" }).text("Display").on("click", () => { display_result(search_list.selected); }).appendTo($(E("div")).addClass("help-panel-buttons").appendTo($search));
	/** @type {Promise<{ title: string, local: string, text: string }[]> | null} */
	let pages_promise = null;
	const load_pages = () => {
		pages_promise ??= fetch(options.contentsFile).then((response) => response.text()).then((hhc) => {
			const locals = [...new Set([...hhc.matchAll(/name="Local" value="([^"]+)"/gi)].map((match) => match[1]))];
			return Promise.all(locals.map(async (local) => {
				try {
					const doc = new DOMParser().parseFromString(await (await fetch(`${options.root}/${local}`)).text(), "text/html");
					return { local, title: doc.title || local, text: `${doc.title} ${doc.body?.textContent ?? ""}`.replace(/\s+/g, " ").toLowerCase() };
				} catch {
					return { local, title: local, text: "" };
				}
			}));
		});
		return pages_promise;
	};
	const search = async () => {
		const words = String($search_input.val()).toLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length) { return; }
		$search_status.text("Searching...");
		const pages = await load_pages();
		results = pages
			.map((page) => ({ page, score: words.every((word) => page.text.includes(word)) ? words.reduce((sum, word) => sum + page.text.split(word).length - 1 + (page.title.toLowerCase().includes(word) ? 10 : 0), 0) : 0 }))
			.filter(({ score }) => score > 0)
			.sort((a, b) => b.score - a.score)
			.map(({ page }) => ({ title: page.title, local: page.local }));
		search_list.set_items(results.map((result) => ({ text: result.title })));
		$search_status.text(results.length ? `Topics found: ${results.length}` : "No topics found. Try fewer or different words.");
		if (results.length) { search_list.select(0); }
	};
	$(E("button")).attr({ type: "button" }).text("List Topics").on("click", search).appendTo($search_buttons);
	$search_input.on("keydown", (event) => {
		if (event.key === "Enter") { search(); event.preventDefault(); }
		if (event.key === "ArrowDown") { search_list.$list.trigger("focus"); event.preventDefault(); }
	});

	const $contents_panel = $(E("div")).addClass("help-panel help-contents-panel").attr({ role: "tabpanel" }).append($contents);
	const panels = { contents: $contents_panel, index: $index, search: $search };
	/** @param {"contents" | "index" | "search"} name */
	const show_tab = (name) => {
		$tabs.children().each((_i, tab) => {
			const on = tab.dataset.tab === name;
			$(tab).toggleClass("selected", on).attr({ "aria-selected": String(on), tabindex: on ? "0" : "-1" });
		});
		for (const [key, $panel] of Object.entries(panels)) { $panel.toggle(key === name); }
		if (name === "index") { load_index(); $index_input.trigger("focus"); }
		if (name === "search") { $search_input.trigger("focus"); }
	};
	for (const [name, label] of /** @type {const} */ ([["contents", "Contents"], ["index", "Index"], ["search", "Search"]])) {
		if (name === "index" && !options.indexFile) { continue; }
		$(E("div")).addClass("help-tab").attr({ role: "tab", "data-tab": name }).text(label)
			.on("click", () => { show_tab(name); })
			.appendTo($tabs);
	}
	$tabs.on("keydown", (event) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") { return; }
		const $all = $tabs.children();
		const current = $all.index($all.filter(".selected"));
		const next = $all.eq((current + (event.key === "ArrowRight" ? 1 : -1) + $all.length) % $all.length);
		show_tab(/** @type {"contents" | "index" | "search"} */ (next.attr("data-tab")));
		next.trigger("focus");
	});
	$panels.append($contents_panel, $index, $search);
	show_tab("contents");
	return { $sidebar, show_tab };
}

$("<style>").text(`
	.help-window .help-sidebar {
		display: flex;
		flex-direction: column;
		flex-basis: 300px;
		flex-grow: 0;
		flex-shrink: 0;
		min-width: 0;
		margin: 1px;
	}
	.help-window .help-tabs {
		display: flex;
		align-items: flex-end;
		padding: 2px 2px 0;
		position: relative;
		z-index: 1;
	}
	.help-window .help-tab {
		padding: 2px 8px 1px;
		margin-right: -1px;
		background: var(--ButtonFace, #c0c0c0);
		color: var(--ButtonText, #000);
		border: 1px solid;
		border-color: var(--ButtonHilight, #fff) var(--ButtonDkShadow, #000) transparent var(--ButtonHilight, #fff);
		box-shadow: inset -1px 0 var(--ButtonShadow, #808080);
		border-radius: 3px 3px 0 0;
		cursor: default;
		user-select: none;
	}
	.help-window .help-tab.selected {
		padding: 3px 10px 3px;
		margin: -2px 0 -1px -2px;
		position: relative;
		z-index: 2;
	}
	.help-window .help-tab:focus-visible {
		outline: 1px dotted currentColor;
		outline-offset: -4px;
	}
	.help-window .help-panels {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		border: 1px solid;
		border-color: var(--ButtonHilight, #fff) var(--ButtonDkShadow, #000) var(--ButtonDkShadow, #000) var(--ButtonHilight, #fff);
		background: var(--ButtonFace, #c0c0c0);
		padding: 4px;
	}
	.help-window .help-panel {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.help-window .help-panel .contents {
		flex: 1;
		flex-basis: auto;
		margin: 0 !important;
	}
	.help-window .help-panel label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		white-space: normal;
	}
	.help-window .help-pick-list {
		flex: 1;
		min-height: 60px;
		overflow: auto;
		background: var(--Window, #fff);
		color: var(--WindowText, #000);
	}
	.help-window .help-pick-list li,
	.help-topics-found .help-pick-list li {
		display: block;
		white-space: nowrap;
		cursor: default;
		padding-right: 4px;
	}
	.help-pick-list li::before {
		display: none !important; /* (not the Contents tree's book and page icons) */
	}
	.help-pick-list li.selected {
		background: var(--Hilight, #000080);
		color: var(--HilightText, #fff);
	}
	.help-pick-list:focus-visible {
		outline: 1px dotted currentColor;
	}
	.help-topics-found .help-pick-list {
		overflow: auto;
		background: var(--Window, #fff);
		color: var(--WindowText, #000);
		margin: 0;
		padding: 0;
	}
	.help-window .help-panel-buttons {
		display: flex;
		justify-content: flex-end;
	}
	.help-window .help-search-status {
		margin: 0;
		min-height: 1.2em;
	}
`).appendTo(document.head);
// #endregion

export { show_help };

