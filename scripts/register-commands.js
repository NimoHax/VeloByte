require("dotenv").config();
const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");

const commands = [];
const dir = path.join(__dirname, "..", "src", "commands");
for (const file of fs.readdirSync(dir).filter(f=>f.endsWith(".js"))) {
  const loaded = require(path.join(dir,file));
  for (const c of (Array.isArray(loaded)?loaded:[loaded])) commands.push(c.data.toJSON());
}

const rest = new REST({version:"10"}).setToken(process.env.DISCORD_TOKEN);

(async()=>{
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_GUILD_ID) throw new Error("DISCORD_CLIENT_ID and DISCORD_GUILD_ID are required.");
  await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID), {body:commands});
  console.log(`Registered ${commands.length} guild commands.`);
})().catch(e=>{console.error(e);process.exit(1);});
