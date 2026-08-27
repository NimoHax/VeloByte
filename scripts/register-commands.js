require("dotenv").config();

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
  console.error(`❌ Commands folder not found: ${commandsPath}`);
  process.exit(1);
}

const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

const commands = [];

console.log("");
console.log("======================================");
console.log("      VeloByte Command Register");
console.log("======================================");
console.log("");

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);

  try {
    delete require.cache[require.resolve(filePath)];

    const loaded = require(filePath);

    // Supports:
    // module.exports = command
    // module.exports = [command1, command2, ...]
    const commandList = Array.isArray(loaded)
      ? loaded
      : [loaded];

    for (const command of commandList) {
      if (!command || !command.data) {
        console.warn(
          `⚠️ Skipping ${file}: invalid command export`
        );
        continue;
      }

      const data = command.data.toJSON();

      if (!data.name) {
        console.warn(
          `⚠️ Skipping ${file}: command name missing`
        );
        continue;
      }

      commands.push(data);

      const permissions =
        data.default_member_permissions;

      const adminOnly =
        permissions === "8" ||
        permissions === 8;

      console.log(
        adminOnly
          ? `🔐 /${data.name} [ADMIN ONLY]`
          : `✅ /${data.name}`
      );
    }
  } catch (error) {
    console.error("");
    console.error(`❌ Failed to load ${file}`);
    console.error(error);
    console.error("");
  }
}

console.log("");
console.log(`📦 Total commands found: ${commands.length}`);
console.log("");

// ============================================================
// DUPLICATE COMMAND CHECK
// ============================================================

const commandNames = new Set();

for (const command of commands) {
  if (commandNames.has(command.name)) {
    console.error(
      `❌ Duplicate command detected: /${command.name}`
    );

    process.exit(1);
  }

  commandNames.add(command.name);
}

// ============================================================
// DISCORD REST
// ============================================================

const rest = new REST({
  version: "10",
}).setToken(TOKEN);

// ============================================================
// REGISTER GUILD COMMANDS
// ============================================================

(async () => {
  try {
    console.log("🔄 Updating Discord slash commands...");
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
    console.log("========== REGISTERED COMMANDS ==========");

    for (const command of result) {
      const permissions =
        command.default_member_permissions;

      const adminOnly =
        permissions === "8" ||
        permissions === 8;

      console.log(
        adminOnly
          ? `🔐 /${command.name} [ADMIN ONLY]`
          : `✅ /${command.name}`
      );
    }

    console.log("");
    console.log("==========================================");
    console.log("       Command Registration Complete");
    console.log("==========================================");
    console.log("");
  } catch (error) {
    console.error("");
    console.error("❌ Discord command registration failed.");
    console.error("");

    if (error?.rawError) {
      console.error(error.rawError);
    } else {
      console.error(error);
    }

    console.error("");
    process.exit(1);
  }
})();
