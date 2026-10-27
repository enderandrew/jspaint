// @ts-check
function afterSequence(sequence, action) {
	var index = 0;

	return function (event) {
		var matchedKey = event.keyCode === sequence[index];
		// if it didn't match, reset and try matching against the first key
		if (!matchedKey) {
			index = 0;
			matchedKey = event.keyCode === sequence[index];
		}

		if (matchedKey) {
			index += 1;

			// fix for Firefox with "Search for text when you start typing" enabled
			// https://support.mozilla.org/en-US/kb/search-contents-current-page-text-or-links
			// prevent the default (opening Quick Search) for B and A,
			// which are luckily at the end of the Konami Code sequence
			// (otherwise it could prevent typing A and B in text fields unwantedly)
			if (event.keyCode === 66 || event.keyCode === 65) {
				event.preventDefault();
			}

			if (index === sequence.length) {

				// reset when sequence completed
				index = 0;

				// fire action
				action();
			}
		}

	};
}

/** The Konami code's sound effect, fetched the first time the code is entered. @type {HTMLAudioElement | null} */
let konami_audio = null;
/** Plays audio/KONAMI.ogg (quietly does nothing if the browser won't play it). */
export function play_konami_sound() {
	konami_audio ??= new Audio("audio/KONAMI.ogg");
	konami_audio.currentTime = 0;
	konami_audio.play().catch(() => { /* (no sound: autoplay blocked, or no Ogg support) */ });
}

export function onKonamiCodeEntered(action) {
	addEventListener("keydown", afterSequence([38, 38, 40, 40, 37, 39, 37, 39, 66, 65], action));
}
