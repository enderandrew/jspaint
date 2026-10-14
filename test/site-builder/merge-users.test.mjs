// One account per email (worker/editor/merge-users.js, run by the Accounts Durable Object on every wake): addresses
// lowercased; rows a split sign-in doubled merged into the oldest — its identities, sessions, sites and favorites
// follow, a lock on any row locks the person; then the unique index, after which a second row for an address is
// refused. Runs on node:sqlite behind the same `exec` shape as the Durable Object's; no server needed.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { unify_user_emails } from "../../worker/editor/merge-users.js";

const db = new DatabaseSync(":memory:");
/** The Durable Object's `sql.exec(query, ...bindings)` → cursor, over node:sqlite */
const sql = {
	/** @param {string} query @param {...any} bindings */
	exec(query, ...bindings) {
		const statement = db.prepare(query);
		const rows = /^\s*(SELECT|WITH|PRAGMA)\b/i.test(query) ? statement.all(...bindings).map((row) => ({ ...row })) : (statement.run(...bindings), []); // (plain objects, as the DO's cursor gives)
		return { toArray: () => rows, one: () => rows[0] };
	},
};
// The tables as accounts.js makes them (locked and note are the added columns)
sql.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT, created INTEGER NOT NULL, seen INTEGER NOT NULL, locked INTEGER NOT NULL DEFAULT 0, note TEXT)");
sql.exec("CREATE TABLE identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT, created INTEGER NOT NULL, PRIMARY KEY (provider, subject))");
sql.exec("CREATE TABLE sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)");
sql.exec("CREATE TABLE owners (site TEXT PRIMARY KEY, user_id TEXT NOT NULL, claimed INTEGER NOT NULL)");
sql.exec("CREATE TABLE favorites (user_id TEXT NOT NULL, gif TEXT NOT NULL, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (user_id, gif))");

// Pat signed in three times before the index existed: the oldest row (a), a plain duplicate (b), and one with the
// address typed in capitals that the admin locked (c). Sam is one row, Robin has no email. Plus a stranger whose
// case-variant address collides only after lowercasing.
const add = (/** @type {[string, string | null, string, number, number, number, string | null]} */ ...row) => sql.exec("INSERT INTO users (id, email, name, created, seen, locked, note) VALUES (?, ?, ?, ?, ?, ?, ?)", ...row);
add("a", "pat@example.com", "Pat", 100, 150, 0, null);
add("b", "pat@example.com", "Pat Two", 200, 900, 0, null);
add("c", "Pat@Example.com", "", 300, 400, 1, "spam");
add("s", "sam@example.com", "Sam", 100, 100, 0, null);
add("r", null, "Robin", 100, 100, 0, null);
add("q", null, "Quinn", 100, 100, 0, null);
for (const [provider, subject, user] of [["google", "1", "a"], ["google", "2", "b"], ["google", "3", "c"], ["google", "9", "s"]]) { sql.exec("INSERT INTO identities (provider, subject, user_id, email, created) VALUES (?, ?, ?, ?, ?)", provider, subject, user, "x", 1); }
for (const [hash, user] of [["h1", "a"], ["h2", "b"], ["h3", "c"], ["h9", "s"]]) { sql.exec("INSERT INTO sessions (hash, user_id, created, expires) VALUES (?, ?, 1, 2)", hash, user); }
for (const [site, user] of [["pats-first", "a"], ["pats-second", "b"], ["pats-third", "c"], ["sam-site", "s"]]) { sql.exec("INSERT INTO owners (site, user_id, claimed) VALUES (?, ?, 1)", site, user); }
for (const [user, gif, at] of [["a", "gifcities:ONE", 10], ["b", "gifcities:ONE", 30], ["b", "gifcities:TWO", 20], ["c", "gifcities:THREE", 40]]) { sql.exec("INSERT INTO favorites (user_id, gif, width, height, at) VALUES (?, ?, 1, 1, ?)", user, gif, at); }

assert.deepEqual(unify_user_emails(sql), { merged: 2, indexed: true });

// Pat is one row — the oldest — with everything the others had
const users = sql.exec("SELECT id, email, name, seen, locked, note FROM users ORDER BY id").toArray();
assert.deepEqual(users, [
	{ id: "a", email: "pat@example.com", name: "Pat", seen: 900, locked: 1, note: "spam" },
	{ id: "q", email: null, name: "Quinn", seen: 100, locked: 0, note: null },
	{ id: "r", email: null, name: "Robin", seen: 100, locked: 0, note: null },
	{ id: "s", email: "sam@example.com", name: "Sam", seen: 100, locked: 0, note: null },
]);
assert.deepEqual(sql.exec("SELECT subject FROM identities WHERE user_id = 'a' ORDER BY subject").toArray().map((r) => r.subject), ["1", "2", "3"], "all three Google identities are Pat's");
assert.deepEqual(sql.exec("SELECT hash FROM sessions WHERE user_id = 'a' ORDER BY hash").toArray().map((r) => r.hash), ["h1", "h2", "h3"]);
assert.deepEqual(sql.exec("SELECT site FROM owners WHERE user_id = 'a' ORDER BY site").toArray().map((r) => r.site), ["pats-first", "pats-second", "pats-third"]);
assert.deepEqual(sql.exec("SELECT gif, at FROM favorites WHERE user_id = 'a' ORDER BY gif").toArray().map((r) => [r.gif, r.at]), [["gifcities:ONE", 30], ["gifcities:THREE", 40], ["gifcities:TWO", 20]], "favorites merged; a shared one keeps the later time");
assert.equal(sql.exec("SELECT COUNT(*) AS n FROM favorites WHERE user_id IN ('b', 'c')").one().n, 0);
assert.deepEqual(sql.exec("SELECT site FROM owners WHERE user_id = 's'").toArray().map((r) => r.site), ["sam-site"], "Sam untouched");

// From now on the database refuses a second row for an address; several rows without one are fine
assert.throws(() => sql.exec("INSERT INTO users (id, email, name, created, seen) VALUES ('z', 'pat@example.com', 'Imposter', 1, 1)"), /UNIQUE/);
sql.exec("INSERT INTO users (id, email, name, created, seen) VALUES ('n', NULL, 'Nobody', 1, 1)");
// …and the insert sign-in uses is ignored rather than refused, leaving the row that was there
sql.exec("INSERT OR IGNORE INTO users (id, email, name, created, seen) VALUES ('z', 'pat@example.com', 'Imposter', 1, 1)");
assert.equal(sql.exec("SELECT id FROM users WHERE email = 'pat@example.com'").one().id, "a");

// Again: nothing to do
assert.deepEqual(unify_user_emails(sql), { merged: 0, indexed: true });
assert.equal(sql.exec("SELECT COUNT(*) AS n FROM users").one().n, 5);

console.log("merge-users: ok");
