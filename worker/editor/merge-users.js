// One account per verified email (docs/DESIGN.md §9: identities are rows joined by email). Before `users.email` had a
// unique index, two first sign-ins at the same instant could make two rows for one address — the "split sign-in"
// support case. Accounts runs this on every wake, before anything else: addresses lowercased, duplicate rows merged
// into the oldest (its identities, sessions, sites, favorites and any lock follow), then the index, which the
// database keeps from then on. A no-op when there's nothing to do. Plain SQL over an `exec` so it runs in the
// Durable Object and, with node:sqlite behind the same shape, in test/site-builder/merge-users.test.mjs.

/**
 * @param {{ exec: (query: string, ...bindings: any[]) => { toArray: () => Record<string, any>[] } }} sql
 * @returns {{ merged: number, indexed: boolean }} how many duplicate rows were folded away; whether the index is there
 */
export function unify_user_emails(sql) {
	sql.exec("UPDATE users SET email = NULLIF(LOWER(TRIM(email)), '') WHERE email IS NOT NULL AND email != NULLIF(LOWER(TRIM(email)), '')");
	let merged = 0;
	const groups = sql.exec("SELECT email FROM users WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1").toArray();
	for (const { email } of groups) {
		const rows = sql.exec("SELECT id, locked, note, seen FROM users WHERE email = ? ORDER BY created, id", email).toArray();
		const keep = rows[0];
		for (const dup of rows.slice(1)) {
			sql.exec("UPDATE identities SET user_id = ? WHERE user_id = ?", keep.id, dup.id);
			sql.exec("UPDATE sessions SET user_id = ? WHERE user_id = ?", keep.id, dup.id);
			sql.exec("UPDATE owners SET user_id = ? WHERE user_id = ?", keep.id, dup.id);
			sql.exec("INSERT INTO favorites (user_id, gif, width, height, at) SELECT ?, gif, width, height, at FROM favorites WHERE user_id = ? ON CONFLICT(user_id, gif) DO UPDATE SET at = MAX(favorites.at, excluded.at)", keep.id, dup.id);
			sql.exec("DELETE FROM favorites WHERE user_id = ?", dup.id);
			// A lock on any of the rows is a lock on the person (with its note); the latest activity counts
			sql.exec("UPDATE users SET locked = MAX(locked, ?), note = COALESCE(NULLIF(?, ''), note), seen = MAX(seen, ?) WHERE id = ?", Number(dup.locked) ? 1 : 0, Number(dup.locked) ? String(dup.note || "") : "", Number(dup.seen), keep.id);
			sql.exec("DELETE FROM users WHERE id = ?", dup.id);
			merged++;
		}
	}
	let indexed = true;
	try {
		sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email)");
	} catch (error) {
		indexed = false; // (sign-in still works — it looks before it inserts; the index is the backstop it then lacks)
		console.error("accounts: users.email couldn't be made unique:", error);
	}
	return { merged, indexed };
}
