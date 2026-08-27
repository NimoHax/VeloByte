const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("❌ DISCORD_CLIENT_ID is missing.");
  process.exit(1);
}

if (!GUILD_ID) {
  console.error("❌ DISCORD_GUILD_ID is missing.");
  process.exit(1);
}

const commandsPath = path.join(
  __dirname,
  "..",
  "src",
  "commands"
);

if (!fs.existsSync(commandsPath)) {
  console.error(
    `❌ Commands folder not found: ${commandsPath}`
  );
  process.exit(1);
}

const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

const commands = [];

console.log("");
console.log("======================================");
console.log("       VeloByte Command Register");
console.log("======================================");
console.log("");

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);

  try {
    delete require.cache[require.resolve(filePath)];

    const loaded = require(filePath);

    const commandList = Array.isArray(loaded)
      ? loaded
      : [loaded];

    for (const command of commandList) {
      if (!command || !command.data) {
        console.log(
          `⚠️ Skipped ${file}: invalid command`
        );
        continue;
      }

      const data = command.data.toJSON();

      if (!data.name) {
        console.log(
          `⚠️ Skipped ${file}: command name missing`
        );
        continue;
      }

      commands.push(data);

      const adminOnly =
        data.default_member_permissions === "8";

      console.log(
        adminOnly
          ? `🔐 /${data.name} [ADMIN ONLY]`
          : `✅ /${data.name}`
      );
    }
  } catch (error) {
    console.error("");
    console.error(`❌ Error loading ${file}`);
    console.error(error);
    console.error("");
  }
}

console.log("");
console.log(`📦 Total commands: ${commands.length}`);
console.log("");

// ============================================================
// DUPLICATE CHECK
// ============================================================

const seen = new Set();

for (const command of commands) {
  if (seen.has(command.name)) {
    console.error(
      `❌ Duplicate command: /${command.name}`
    );
    process.exit(1);
  }

  seen.add(command.name);
}

// ============================================================
// REGISTER
// ============================================================

const rest = new REST({
  version: "10",
}).setToken(TOKEN);

(async () => {
  try {
    console.log("🔄 Updating Discord guild commands...");
    console.log("");

    const result = await rest.put(
      Routes.applicationGuildCommands(
        CLIENT_ID,
        GUILD_ID
      ),
      {
        body: commands,
      }
    );

    console.log(
      `✅ Successfully registered ${result.length} commands.`
    );

    console.log("");
    console.log("========== REGISTERED ==========");

    for (const command of result) {
      const adminOnly =
        command.default_member_permissions === "8";

      console.log(
        `${adminOnly ? "🔐" : "✅"} /${command.name}`
      );
    }

    console.log("");
    console.log("================================");
    console.log("       Registration Complete");
    console.log("================================");
    console.log("");
  } catch (error) {
    console.error("");
    console.error("❌ Discord registration failed:");
    console.error(error);
    console.error("");
    process.exit(1);
  }
})();
