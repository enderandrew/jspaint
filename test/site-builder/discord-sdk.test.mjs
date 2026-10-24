// The bundled Discord Embedded App SDK (lib/, used by src/discord-activity-client.js when Paint runs as a Discord
// Activity) loads as a module and has what the client uses. (Outside Discord, the SDK's mock stands in for it.)
import { assert, open_paint } from "./helpers.mjs";

const { page, close } = await open_paint();
const result = await page.evaluate(async () => {
	const Discord = await import("./lib/discord-embedded-app-sdk-v2.5.0.js");
	const sdk = new Discord.DiscordSDKMock("123456789012345678", "guild", "channel", null);
	await sdk.ready();
	const { code } = await sdk.commands.authorize({ client_id: "123456789012345678", response_type: "code", state: "", prompt: "none", scope: ["identify"] });
	return {
		exports: ["DiscordSDK", "DiscordSDKMock", "Events"].every((name) => name in Discord),
		code: typeof code,
		commands: ["authorize", "authenticate", "openExternalLink"].every((name) => typeof sdk.commands[name] === "function"),
		instance: typeof sdk.instanceId,
		guild: sdk.guildId,
	};
});
assert.deepEqual(result, { exports: true, code: "string", commands: true, instance: "string", guild: "guild" });
await close();
console.log("discord-sdk: ok");
