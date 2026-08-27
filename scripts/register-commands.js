require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  REST,
  Routes,
} = require("discord.js");

const TOKEN =
  process.env.DISCORD_TOKEN;

const CLIENT_ID =
  process.env.DISCORD_CLIENT_ID;

const GUILD_ID =
  process.env.DISCORD_GUILD_ID;

if (!TOKEN) {
  console.error(
    "❌ DISCORD_TOKEN is missing."
  );
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error(
    "❌ DISCORD_CLIENT_ID is missing."
  );
  process.exit(1);
}

if (!GUILD_ID) {
  console.error(
    "❌ DISCORD_GUILD_ID is missing."
  );
  process.exit(1);
}

const commandsPath =
  path.join(
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

const commandFiles =
  fs
    .readdirSync(commandsPath)
    .filter((file) =>
      file.endsWith(".js")
    );

const commands = [];
const names = new Set();

console.log("");
console.log(
  "======================================"
);
console.log(
  "      VELOBYTE COMMAND REGISTER"
);
console.log(
  "======================================"
);
console.log("");

for (const file of commandFiles) {
  const filePath =
    path.join(
      commandsPath,
      file
    );

  try {
    delete require.cache[
      require.resolve(filePath)
    ];

    const loaded =
      require(filePath);

    const list =
      Array.isArray(loaded)
        ? loaded
        : [loaded];

    for (const command of list) {
      if (
        !command ||
        !command.data ||
        typeof command.execute !==
          "function"
      ) {
        console.error(
          `❌ Invalid command in ${file}`
        );
        continue;
      }

      const data =
        command.data.toJSON();

      if (!data.name) {
        console.error(
          `❌ Command name missing in ${file}`
        );
        continue;
      }

      if (names.has(data.name)) {
        console.error(
          `❌ Duplicate command: /${data.name}`
        );
        process.exit(1);
      }

      names.add(data.name);
      commands.push(data);

      const adminOnly =
        data.default_member_permissions ===
        "8";

      console.log(
        adminOnly
          ? `🔐 /${data.name} [ADMIN ONLY]`
          : `✅ /${data.name}`
      );
    }
  } catch (error) {
    console.error("");
    console.error(
      `❌ Failed to load ${file}`
    );
    console.error(error);
    console.error("");
    process.exit(1);
  }
}

console.log("");
console.log(
  `📦 Total commands: ${commands.length}`
);
console.log("");

const rest =
  new REST({
    version: "10",
  }).setToken(TOKEN);

(async () => {
  try {
    console.log(
      "🔄 Updating guild slash commands..."
    );

    const result =
      await rest.put(
        Routes.applicationGuildCommands(
          CLIENT_ID,
          GUILD_ID
        ),
        {
          body: commands,
        }
      );

    console.log("");
    console.log(
      `✅ Successfully registered ${result.length} commands.`
    );

    console.log("");
    console.log(
      "========== COMMAND STATUS =========="
    );

    for (const command of result) {
      const adminOnly =
        command.default_member_permissions ===
        "8";

      console.log(
        adminOnly
          ? `🔐 /${command.name} [ADMIN ONLY]`
          : `✅ /${command.name}`
      );
    }

    console.log(
      "===================================="
    );
    console.log("");
  } catch (error) {
    console.error("");
    console.error(
      "❌ Failed to register commands."
    );
    console.error(error);
    console.error("");

    process.exit(1);
  }
})();
