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

// ============================================================
// FIND COMMAND FILES
// ============================================================

const commandsPath = path.join(__dirname, "..", "src", "commands");

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

    // Command file can export:
    // 1. One command object
    // 2. An array of command objects
    const commandList = Array.isArray(loaded)
      ? loaded
      : [loaded];

    for (const command of commandList) {
      if (!command || !command.data) {
        console.warn(
          `⚠️ Skipping ${file}: invalid command export.`
        );
        continue;
      }

      const json = command.data.toJSON();

      if (!json.name) {
        console.warn(
          `⚠️ Skipping ${file}: command name missing.`
        );
        continue;
      }

      commands.push(json);

      const permissions =
        json.default_member_permissions;

      if (
        permissions === "8" ||
        permissions === "Administrator"
      ) {
        console.log(`🔐 /${json.name} [ADMIN ONLY]`);
      } else {
        console.log(`✅ /${json.name}`);
      }
    }
  } catch (error) {
    console.error(
      `❌ Failed to load ${file}:`
    );
    console.error(error);
  }
}

console.log("");
console.log(`📦 Commands found: ${commands.length}`);
console.log("");

// ============================================================
// DUPLICATE CHECK
// ============================================================

const names = new Set();
const duplicates = [];

for (const command of commands) {
  if (names.has(command.name)) {
    duplicates.push(command.name);
  }

  names.add(command.name);
}

if (duplicates.length) {
  console.error(
    `❌ Duplicate commands found: ${duplicates.join(", ")}`
  );
  process.exit(1);
}

// ============================================================
// REGISTER COMMANDS
// ============================================================

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("🔄 Registering guild commands...");
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
      `✅ Successfully registered ${result.length} guild commands.`
    );

    console.log("");
    console.log("======================================");
    console.log("          Registration Done");
    console.log("======================================");
    console.log("");

    console.log("Registered commands:");

    for (const command of result) {
      const adminOnly =
        command.default_member_permissions === "8";

      console.log(
        `• /${command.name}${adminOnly ? " [ADMIN ONLY]" : ""}`
      );
    }

    console.log("");
  } catch (error) {
    console.error("");
    console.error("❌ Command registration failed:");
    console.error(error);
    console.error("");
    process.exit(1);
  }
})();
