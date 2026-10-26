// @ts-check
/* global AccessKeys */
// A right-click menu, drawn like the menu bar's menus (OS-GUI's classes, so every theme styles it the same).
// (OS-GUI's MenuPopup only works inside its MenuBar; its source has a "TODO: expose API for context menus".)
// Takes the same item objects as menus.js: { label, shortcutLabel, enabled, action, description } and MENU_DIVIDER.
// Arrow keys, Enter, Escape and access keys work; clicking elsewhere, scrolling, resizing or leaving the window
// closes it.

const MENU_DIVIDER = "MENU_DIVIDER";

/** @param {string} tag @param {Record<string, string>} [attributes] */
const E = (tag, attributes = {}) => {
	const el = document.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) { el.setAttribute(name, value); }
	return el;
};

/** @type {(() => void) | null} */
let close_open_menu = null;

/** Closes the right-click menu, if one is open. */
function close_context_menu() {
	close_open_menu?.();
}

/**
 * Shows a menu at a point on the page.
 * @param {(OSGUIMenuItem | typeof MENU_DIVIDER)[]} items
 * @param {number} client_x
 * @param {number} client_y
 * @returns {HTMLElement} the menu
 */
function show_context_menu(items, client_x, client_y) {
	close_context_menu();
	const previous_focus = /** @type {HTMLElement | null} */ (document.activeElement);
	const menu_el = E("div", { class: "menu-popup context-menu", role: "menu", tabindex: "-1" });
	const table_el = E("table", { class: "menu-popup-table", role: "presentation" });
	menu_el.appendChild(table_el);
	/** @type {{ el: HTMLElement, item: OSGUIMenuItem, enabled: boolean }[]} */
	const rows = [];
	for (const item of items) {
		if (item === MENU_DIVIDER) {
			const row_el = E("tr", { class: "menu-row" });
			const td_el = E("td", { colspan: "4" });
			td_el.appendChild(E("hr", { class: "menu-hr" }));
			row_el.appendChild(td_el);
			table_el.appendChild(row_el);
			continue;
		}
		const enabled = typeof item.enabled === "function" ? item.enabled() : item.enabled !== false;
		const item_el = E("tr", { class: "menu-row menu-item", role: "menuitem", tabindex: "-1" });
		item_el.setAttribute("aria-label", AccessKeys.toText(item.label));
		if (item.description) { item_el.setAttribute("aria-description", item.description); }
		if (!enabled) {
			item_el.setAttribute("disabled", "");
			item_el.setAttribute("aria-disabled", "true");
		}
		const label_el = E("td", { class: "menu-item-label" });
		label_el.innerHTML = AccessKeys.toHTML(item.label);
		const shortcut_el = E("td", { class: "menu-item-shortcut" });
		shortcut_el.textContent = item.shortcutLabel || "";
		item_el.append(E("td", { class: "menu-item-checkbox-area" }), label_el, shortcut_el, E("td", { class: "menu-item-submenu-area" }));
		table_el.appendChild(item_el);
		rows.push({ el: item_el, item, enabled });
	}

	let highlighted = -1;
	const highlight = (/** @type {number} */ index) => {
		rows[highlighted]?.el.classList.remove("highlight");
		highlighted = index;
		rows[highlighted]?.el.classList.add("highlight");
		if (rows[highlighted]) { menu_el.setAttribute("aria-activedescendant", rows[highlighted].el.id = rows[highlighted].el.id || `context-menu-item-${index}`); }
	};
	const activate = (/** @type {number} */ index) => {
		const row = rows[index];
		if (!row || !row.enabled) { return; }
		close();
		row.item.action?.();
	};
	rows.forEach((row, index) => {
		row.el.addEventListener("pointerenter", () => { highlight(index); });
		row.el.addEventListener("pointerleave", () => { if (highlighted === index) { highlight(-1); } });
		row.el.addEventListener("click", () => { activate(index); });
	});

	const step = (/** @type {number} */ by) => {
		if (!rows.some((row) => row.enabled)) { return; }
		let index = highlighted;
		do {
			index = (index + by + rows.length) % rows.length;
		} while (!rows[index].enabled);
		highlight(index);
	};
	menu_el.addEventListener("keydown", (event) => {
		if (event.key === "ArrowDown") {
			step(1);
		} else if (event.key === "ArrowUp") {
			step(highlighted === -1 ? 0 : -1);
		} else if (event.key === "Home") {
			highlight(-1);
			step(1);
		} else if (event.key === "End") {
			highlight(0);
			step(-1);
		} else if (event.key === "Enter" || event.key === " ") {
			activate(highlighted);
		} else if (event.key === "Escape" || event.key === "Tab") {
			close();
		} else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
			// access key: the underlined letter
			const index = rows.findIndex((row) => row.enabled && AccessKeys.get(row.item.label)?.toLowerCase() === event.key.toLowerCase());
			if (index === -1) { return; }
			activate(index);
		} else {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
	});
	menu_el.addEventListener("contextmenu", (event) => { event.preventDefault(); });
	menu_el.addEventListener("pointerdown", (event) => { event.stopPropagation(); });

	// Show it at the point, kept on screen (to the left or above it if there's no room)
	Object.assign(menu_el.style, { position: "fixed", left: "0", top: "0", zIndex: "500000", visibility: "hidden" });
	document.body.appendChild(menu_el);
	const { width, height } = menu_el.getBoundingClientRect();
	const left = client_x + width > innerWidth ? Math.max(0, client_x - width) : client_x;
	const top = client_y + height > innerHeight ? Math.max(0, client_y - height) : client_y;
	Object.assign(menu_el.style, { left: `${left}px`, top: `${top}px`, visibility: "" });
	menu_el.focus({ preventScroll: true });

	const outside = (/** @type {Event} */ event) => {
		if (!menu_el.contains(/** @type {Node} */ (event.target))) { close(); }
	};
	const close = () => {
		if (close_open_menu !== close) { return; }
		close_open_menu = null;
		window.removeEventListener("pointerdown", outside, true);
		window.removeEventListener("blur", close);
		window.removeEventListener("resize", close);
		window.removeEventListener("scroll", close, true);
		menu_el.remove();
		if (previous_focus && previous_focus.isConnected) { previous_focus.focus({ preventScroll: true }); }
	};
	close_open_menu = close;
	// (after this event, so the click that opened it doesn't close it)
	setTimeout(() => {
		if (close_open_menu !== close) { return; }
		window.addEventListener("pointerdown", outside, true);
		window.addEventListener("blur", close);
		window.addEventListener("resize", close);
		window.addEventListener("scroll", close, true);
	}, 0);
	return menu_el;
}

export { MENU_DIVIDER, close_context_menu, show_context_menu };
