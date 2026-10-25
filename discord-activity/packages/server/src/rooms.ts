// Shared pictures for the Discord activity's multi-user rooms (src/sessions.js RESTSession), kept as 64×64 PNG tiles
// (src/tile-sync.js), so a change sends only the tiles it touched and the others get only the tiles that changed.
// (It used to keep one PNG of the whole picture, uploaded on every change and downloaded by everyone every second.)
//
//   GET   /api/rooms/:room/picture?since=<version>[&wait=1]
//         → 200 { version, width, height, whole, tiles }: the tiles changed after `since` (all of them, with
//           whole: true, when the picture was replaced or resized since then, or since=0); 204 nothing new;
//           200 { version: 0, empty: true } no picture yet (not a 404, which browsers log as an error).
//           With wait=1, an up-to-date client is answered when something changes (or 204 after WAIT_MS),
//           instead of asking again every second.
//   PUT   /api/rooms/:room/picture  { width, height, tiles }  the whole picture (a new room, or a new size)
//   PATCH /api/rooms/:room/picture  { width, height, tiles }  just these tiles (409 if the size isn't the room's)
//         → 200 { version }
//
// No framework here (app.ts wires it to Express), so the tests use exactly this.

export const TILE_SIZE = 64;
/** How long a waiting GET is held before it's answered with nothing new. */
export const WAIT_MS = 25000;
const MAX_SIDE = 10000;
const MAX_TILE_LENGTH = 65536;
/** A room nobody has touched for this long is forgotten. */
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const ROOM_PATTERN = /^[-\wÀ-￿]{1,100}$/;
const TILE_KEY = /^(\d{1,4})_(\d{1,4})$/;

type Tile = { uri: string; version: number };
type Room = {
	version: number;
	/** The version when the picture was last replaced whole (or resized). */
	whole_version: number;
	width: number;
	height: number;
	tiles: Map<string, Tile>;
	waiters: Set<() => void>;
	touched: number;
};
export type Reply = { status: number; body?: unknown };
type Picture = { width: number; height: number; tiles: Record<string, string> };

export class Rooms {
	private rooms = new Map<string, Room>();
	/** Only for tests: the clock. */
	now: () => number = () => Date.now();

	/** Answers a GET. */
	async get(room_id: string, since_text: unknown, wait: boolean): Promise<Reply> {
		if (!ROOM_PATTERN.test(room_id)) { return { status: 400, body: { error: "Bad room name" } }; }
		const since = Number(since_text) || 0;
		let room = this.rooms.get(room_id);
		if (!room) { return { status: 200, body: { version: 0, empty: true } }; }
		if (wait && since >= room.version) {
			const waiting = room;
			await new Promise<void>((resolve) => {
				const done = () => { clearTimeout(timer); waiting.waiters.delete(done); resolve(); };
				const timer = setTimeout(done, WAIT_MS);
				waiting.waiters.add(done);
			});
			room = this.rooms.get(room_id);
			if (!room) { return { status: 200, body: { version: 0, empty: true } }; }
		}
		room.touched = this.now();
		if (since >= room.version) { return { status: 204 }; }
		const whole = since < room.whole_version;
		const tiles: Record<string, string> = {};
		for (const [key, tile] of room.tiles) {
			if (whole || tile.version > since) { tiles[key] = tile.uri; }
		}
		return { status: 200, body: { version: room.version, width: room.width, height: room.height, whole, tiles } };
	}

	/** Answers a PUT (whole: true) or PATCH. */
	put(room_id: string, body: unknown, whole: boolean): Reply {
		if (!ROOM_PATTERN.test(room_id)) { return { status: 400, body: { error: "Bad room name" } }; }
		const picture = valid_picture(body);
		if (typeof picture === "string") { return { status: 400, body: { error: picture } }; }
		let room = this.rooms.get(room_id);
		if (whole || !room) {
			if (!whole) { return { status: 409, body: { error: "No picture yet: send the whole picture" } }; }
			const version = (room?.version ?? 0) + 1;
			const waiters = room?.waiters ?? new Set<() => void>();
			room = { version, whole_version: version, width: picture.width, height: picture.height, tiles: new Map(), waiters, touched: this.now() };
			for (const [key, uri] of Object.entries(picture.tiles)) { room.tiles.set(key, { uri, version }); }
			this.rooms.set(room_id, room);
		} else {
			if (picture.width !== room.width || picture.height !== room.height) {
				return { status: 409, body: { error: "The picture is a different size now: send the whole picture" } };
			}
			room.version++;
			for (const [key, uri] of Object.entries(picture.tiles)) { room.tiles.set(key, { uri, version: room.version }); }
			room.touched = this.now();
		}
		for (const waiter of [...room.waiters]) { waiter(); }
		this.forget_old_rooms();
		return { status: 200, body: { version: room.version } };
	}

	private forget_old_rooms() {
		const cutoff = this.now() - ROOM_TTL_MS;
		for (const [id, room] of this.rooms) {
			if (room.touched < cutoff && room.waiters.size === 0) { this.rooms.delete(id); }
		}
	}
}

function valid_picture(body: unknown): Picture | string {
	if (!body || typeof body !== "object") { return "Expected { width, height, tiles }"; }
	const { width, height, tiles } = body as Partial<Picture>;
	if (!Number.isInteger(width) || !Number.isInteger(height) || width! < 1 || height! < 1 || width! > MAX_SIDE || height! > MAX_SIDE) {
		return "Bad picture size";
	}
	if (!tiles || typeof tiles !== "object") { return "Expected tiles"; }
	for (const [key, uri] of Object.entries(tiles)) {
		const match = TILE_KEY.exec(key);
		if (!match || Number(match[1]) * TILE_SIZE >= width! || Number(match[2]) * TILE_SIZE >= height!) { return `Bad tile ${key}`; }
		if (typeof uri !== "string" || !uri.startsWith("data:image/png;base64,") || uri.length > MAX_TILE_LENGTH) { return `Bad tile ${key}`; }
	}
	return { width: width!, height: height!, tiles: tiles as Record<string, string> };
}
