require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  REST,
  Routes,
} = require("discord.js");

const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");

// ============================================================
// ENV CHECK
// ============================================================

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing.");
  process.exit(1);
}

if (!process.env.DISCORD_CLIENT_ID) {
  console.error("❌ DISCORD_CLIENT_ID is missing.");
  process.exit(1);
}

if (!process.env.DISCORD_GUILD_ID) {
  console.error("❌ DISCORD_GUILD_ID is missing.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing.");
  process.exit(1);
}

// ============================================================
// DATABASE
// ============================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ============================================================
// DISCORD CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages
  ],

  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.GuildMember,
  ],
});

// ============================================================
// COMMAND COLLECTION
// ============================================================

client.commands = new Collection();

const commandsPath = path.join(
  __dirname,
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

const commandData = [];

console.log("");
console.log("======================================");
console.log("       VELOBYTE COMMAND LOADER");
console.log("======================================");
console.log("");

for (const file of commandFiles) {
  const filePath = path.join(
    commandsPath,
    file
  );

  try {
    delete require.cache[
      require.resolve(filePath)
    ];

    const loaded = require(filePath);

    // Supports:
    // module.exports = command
    // module.exports = [command1, command2, ...]

    const list = Array.isArray(loaded)
      ? loaded
      : [loaded];

    for (const command of list) {
      if (
        !command ||
        !command.data ||
        typeof command.execute !== "function"
      ) {
        console.error(
          `❌ Invalid command export in ${file}`
        );
        continue;
      }

      const name = command.data.name;

      if (!name) {
        console.error(
          `❌ Command name missing in ${file}`
        );
        continue;
      }

      if (client.commands.has(name)) {
        console.error(
          `❌ Duplicate command detected: /${name}`
        );
        process.exit(1);
      }

      client.commands.set(
        name,
        command
      );

      commandData.push(
        command.data.toJSON()
      );

      console.log(
        `✅ Loaded /${name} ← ${file}`
      );
    }
  } catch (error) {
    console.error("");
    console.error(
      `❌ Failed to load command file: ${file}`
    );
    console.error(error);
    console.error("");
    process.exit(1);
  }
}

console.log("");
console.log(
  `📦 Total commands loaded: ${client.commands.size}`
);
console.log("");

// ============================================================
// DATABASE HELPER
// ============================================================

async function db(
  sql,
  params = []
) {
  return pool.query(
    sql,
    params
  );
}

// ============================================================
// MODERATION LOG
// ============================================================

async function logAction(
  guild,
  title,
  description,
  color = 0x5865f2
) {
  try {
    const channelId =
      process.env.MOD_LOG_CHANNEL_ID ||
      process.env.LOG_CHANNEL_ID;

    if (!channelId) return;

    const channel =
      guild.channels.cache.get(
        channelId
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      return;
    }

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setDescription(
            description
          )
          .setColor(color)
          .setTimestamp(),
      ],
    });
  } catch (error) {
    console.error(
      "❌ Moderation log error:",
      error
    );
  }
}

// ============================================================
// REGISTER SLASH COMMANDS AUTOMATICALLY
// ============================================================

async function registerCommands() {
  try {
    console.log("");
    console.log(
      "🔄 Registering Discord slash commands..."
    );

    const rest = new REST({
      version: "10",
    }).setToken(
      process.env.DISCORD_TOKEN
    );

    const registered =
      await rest.put(
        Routes.applicationGuildCommands(
          process.env.DISCORD_CLIENT_ID,
          process.env.DISCORD_GUILD_ID
        ),
        {
          body: commandData,
        }
      );

    console.log(
      `✅ Successfully registered ${registered.length} commands.`
    );

    console.log("");
    console.log(
      "========== REGISTERED COMMANDS =========="
    );

    for (const command of registered) {
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
      "=========================================="
    );
    console.log("");
  } catch (error) {
    console.error("");
    console.error(
      "❌ Slash command registration failed."
    );
    console.error(error);
    console.error("");
  }
}

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function initializeDatabase() {
  await db(`
    CREATE TABLE IF NOT EXISTS users (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 0,
      warnings INTEGER NOT NULL DEFAULT 0,
      last_xp_at TIMESTAMPTZ,
      joined_at TIMESTAMPTZ,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS moderation_cases (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      duration_seconds INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      claimed_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    )
  `);


  await db(`
    CREATE TABLE IF NOT EXISTS modmail_conversations (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      thread_id TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      closed_by TEXT
    )
  `);

  await db(`
    CREATE INDEX IF NOT EXISTS idx_modmail_user_status
    ON modmail_conversations(guild_id, user_id, status)
  `);

  await db(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_modmail_one_open_per_user
    ON modmail_conversations(guild_id, user_id)
    WHERE status='open'
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS bugs (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      reporter_id TEXT NOT NULL,
      product TEXT NOT NULL,
      platform TEXT,
      version TEXT,
      severity TEXT NOT NULL DEFAULT 'medium',
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      assigned_to TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'under_review',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      starts_at TIMESTAMPTZ NOT NULL,
      channel_id TEXT,
      created_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled'
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS event_members (
      event_id BIGINT REFERENCES events(id)
        ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (event_id, user_id)
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS settings (
      guild_id TEXT PRIMARY KEY,
      json JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);

  console.log(
    "✅ PostgreSQL database ready."
  );
}


// ============================================================
// MODMAIL
// ============================================================

function getModMailChannel(guild) {
  const channelId = process.env.MODMAIL_CHANNEL_ID;
  if (!channelId) return null;

  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased()) return null;

  return channel;
}

function isModMailStaff(message) {
  const roleId = process.env.MODMAIL_STAFF_ROLE_ID;
  if (!roleId || !message.member) return false;

  return (
    message.member.roles?.cache?.has(roleId) ||
    message.member.permissions?.has(PermissionsBitField.Flags.ManageMessages) ||
    message.member.permissions?.has(PermissionsBitField.Flags.Administrator)
  );
}

function modMailSafeText(text) {
  if (!text) return "*No text content*";
  return text.length > 3900
    ? `${text.slice(0, 3890)}…`
    : text;
}

async function getOpenModMail(guildId, userId) {
  const result = await db(
    `SELECT *
     FROM modmail_conversations
     WHERE guild_id=$1
       AND user_id=$2
       AND status='open'
     ORDER BY created_at DESC
     LIMIT 1`,
    [guildId, userId]
  );

  return result.rows[0] || null;
}

async function closeModMailByThread(threadId, closedBy) {
  await db(
    `UPDATE modmail_conversations
     SET status='closed',
         closed_at=NOW(),
         closed_by=$2
     WHERE thread_id=$1
       AND status='open'`,
    [threadId, closedBy]
  );
}

async function handleModMailDM(message) {
  const configuredChannelId = process.env.MODMAIL_CHANNEL_ID;

  if (!configuredChannelId) {
    await message.reply(
      "❌ ModMail is not configured yet. Please contact the server staff."
    ).catch(() => {});
    return;
  }

  const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);

  if (!guild) {
    await message.reply(
      "❌ The support server is currently unavailable."
    ).catch(() => {});
    return;
  }

  const inbox = getModMailChannel(guild);

  if (!inbox) {
    console.error(
      `[ModMail] Channel not found or not text based: ${configuredChannelId}`
    );

    await message.reply(
      "❌ ModMail is temporarily unavailable. Please try again later."
    ).catch(() => {});
    return;
  }

  const content = message.content?.trim() || "";
  const attachments = [...message.attachments.values()];

  if (!content && attachments.length === 0) {
    await message.reply(
      "❌ Please send a text message or an attachment."
    ).catch(() => {});
    return;
  }

  let conversation = await getOpenModMail(guild.id, message.author.id);
  let thread = null;

  if (conversation) {
    thread = await guild.channels.fetch(conversation.thread_id).catch(() => null);

    if (!thread || !thread.isThread()) {
      await db(
        `UPDATE modmail_conversations
         SET status='closed', closed_at=NOW(), closed_by=$2
         WHERE thread_id=$1`,
        [conversation.thread_id, client.user.id]
      );
      conversation = null;
    }
  }

  const userLabel = `${message.author.tag} (${message.author.id})`;

  if (!conversation) {
    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("modmail:close:pending")
        .setLabel("Close")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger)
    );

    const starter = await inbox.send({
      components: [closeRow],
      embeds: [{
        title: "📩 New ModMail",
        description:
          `**User:** ${message.author}\n` +
          `**Tag:** ${message.author.tag}\n` +
          `**User ID:** \`${message.author.id}\`\n\n` +
          `**Message:**\n${modMailSafeText(content)}`,
        color: 0x5865f2,
        thumbnail: {
          url: message.author.displayAvatarURL({ size: 256 })
        },
        timestamp: new Date().toISOString(),
      }],
      files: attachments.map(a => ({ attachment: a.url, name: a.name })),
    });

    thread = await starter.startThread({
      name: `📩 ${message.author.username}`.slice(0, 100),
      autoArchiveDuration: 1440,
      reason: `ModMail conversation with ${userLabel}`,
    });

    await db(
      `INSERT INTO modmail_conversations
       (guild_id,user_id,thread_id,status)
       VALUES($1,$2,$3,'open')`,
      [guild.id, message.author.id, thread.id]
    );

    // The first message lives in the inbox channel, not inside the thread.
    // Update its button after the thread is created so the button knows
    // exactly which ModMail conversation it should close.
    await starter.edit({
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`modmail:close:${thread.id}`)
            .setLabel("Close")
            .setEmoji("🔒")
            .setStyle(ButtonStyle.Danger)
        )
      ]
    }).catch((error) => {
      console.error(
        "[ModMail] Failed to update close button:",
        error.message
      );
    });

    await thread.send(
      "💬 **Conversation opened.** Staff can reply here. Use the **🔒 Close** button in the inbox message to close this conversation."
    );
  } else {
    if (thread.archived) {
      await thread.setArchived(false).catch(() => {});
    }

    await thread.send({
      embeds: [{
        title: "👤 User",
        description: modMailSafeText(content),
        color: 0x3498db,
        timestamp: new Date().toISOString(),
      }],
      files: attachments.map(a => ({ attachment: a.url, name: a.name })),
    }).catch(async () => {
      // If the old thread disappeared between fetch and send,
      // start a fresh conversation next time.
    });
  }

  await message.reply(
    "✅ Your message has been sent to the VeloByte support team. You can continue replying here in DM."
  ).catch(() => {});
}

async function handleModMailStaffReply(message) {
  if (!message.channel?.isThread()) return false;

  const inboxId = process.env.MODMAIL_CHANNEL_ID;
  if (!inboxId || message.channel.parentId !== inboxId) return false;

  if (!isModMailStaff(message)) {
    await message.reply(
      "❌ You do not have permission to reply to ModMail."
    ).catch(() => {});
    return true;
  }

  const result = await db(
    `SELECT *
     FROM modmail_conversations
     WHERE thread_id=$1
       AND status='open'
     LIMIT 1`,
    [message.channel.id]
  );

  const conversation = result.rows[0];

  if (!conversation) {
    await message.reply(
      "❌ This ModMail conversation is closed or no longer exists."
    ).catch(() => {});
    return true;
  }

  const user = await client.users.fetch(
    conversation.user_id
  ).catch(() => null);

  if (!user) {
    await message.reply(
      "❌ I could not find this Discord user."
    ).catch(() => {});
    return true;
  }

  const content = message.content?.trim() || "";
  const attachments = [...message.attachments.values()];

  if (!content && attachments.length === 0) return true;

  const staffName = message.member?.displayName || message.author.tag;

  try {
    const prefix = `💬 **VeloByte Support — ${staffName}**\n`;
    const body = content ? `${prefix}${content}` : prefix;

    await user.send({
      content: body.slice(0, 2000),
      files: attachments.map(a => ({ attachment: a.url, name: a.name })),
    });

    await message.react("📨").catch(() => {});
  } catch (error) {
    console.error(
      `[ModMail] Failed to DM ${conversation.user_id}:`,
      error
    );

    await message.reply(
      "❌ I could not send the reply. The user may have DMs disabled or blocked the bot."
    ).catch(() => {});
  }

  return true;
}

// ============================================================
// READY
// ============================================================

client.once(
  Events.ClientReady,
  async (c) => {
    console.log(
      `🤖 VeloByte Core online as ${c.user.tag}`
    );

    try {
      await initializeDatabase();

      // Automatically update slash commands
      await registerCommands();
    } catch (error) {
      console.error(
        "❌ Startup error:",
        error
      );
    }
  }
);

// ============================================================
// INTERACTION HANDLER
// ============================================================

client.on(
  Events.InteractionCreate,
  async (interaction) => {
    try {

      // ======================================================
      // SLASH COMMANDS
      // ======================================================

      if (
        interaction.isChatInputCommand()
      ) {
        const command =
          client.commands.get(
            interaction.commandName
          );

        if (!command) {
          console.error(
            `❌ Command not loaded: /${interaction.commandName}`
          );

          return interaction.reply({
            content:
              "❌ This command is not loaded by the bot.",
            ephemeral: true,
          });
        }

        console.log(
          `⚡ /${interaction.commandName} → ${interaction.user.tag}`
        );

        try {
          await command.execute(
            interaction,
            {
              db,
              logAction,
              client,
            }
          );
        } catch (error) {
          console.error("");
          console.error(
            `❌ Error executing /${interaction.commandName}`
          );
          console.error(error);
          console.error("");

          const message =
            "❌ Something went wrong while executing this command. Check the bot logs.";

          if (
            interaction.replied ||
            interaction.deferred
          ) {
            await interaction
              .followUp({
                content: message,
                ephemeral: true,
              })
              .catch(() => {});
          } else {
            await interaction
              .reply({
                content: message,
                ephemeral: true,
              })
              .catch(() => {});
          }
        }

        return;
      }

      // ======================================================
      // BUTTONS
      // ======================================================

      if (
        interaction.isButton()
      ) {
        const [
          type,
          value,
          extraValue,
        ] =
          interaction.customId.split(
            ":"
          );

        // ====================================================
        // VERIFY
        // ====================================================

        if (
          type === "verify"
        ) {
          const roleId =
            process.env.MEMBER_ROLE_ID ||
            process.env.VERIFIED_ROLE_ID;

          if (!roleId) {
            return interaction.reply({
              content:
                "❌ Verification role is not configured.",
              ephemeral: true,
            });
          }

          const member =
            await interaction.guild.members.fetch(
              interaction.user.id
            );

          if (
            !member.roles.cache.has(
              roleId
            )
          ) {
            await member.roles.add(
              roleId,
              "VeloByte verification"
            );
          }

          return interaction.reply({
            content:
              "✅ You are verified and have received the Member role.",
            ephemeral: true,
          });
        }

        // ====================================================
        // MODMAIL CLOSE
        // ====================================================

        if (type === "modmail" && value === "close") {
          // The Close button is attached to the original inbox message,
          // so interaction.channel is the ModMail inbox, not the thread.
          // The thread ID is stored in customId as modmail:close:<threadId>.
          const threadId = extraValue || null;

          const inboxId = process.env.MODMAIL_CHANNEL_ID;
          if (
            !inboxId ||
            interaction.channelId !== inboxId
          ) {
            return interaction.reply({
              content: "❌ This is not a ModMail inbox message.",
              ephemeral: true,
            });
          }

          if (!threadId) {
            return interaction.reply({
              content: "❌ ModMail thread information is missing.",
              ephemeral: true,
            });
          }

          const roleId = process.env.MODMAIL_STAFF_ROLE_ID;
          const member = interaction.member;

          const allowed =
            member?.permissions?.has(PermissionsBitField.Flags.Administrator) ||
            member?.permissions?.has(PermissionsBitField.Flags.ManageMessages) ||
            (roleId && member?.roles?.cache?.has(roleId));

          if (!allowed) {
            return interaction.reply({
              content: "❌ You do not have permission to close ModMail.",
              ephemeral: true,
            });
          }

          const result = await db(
            `SELECT *
             FROM modmail_conversations
             WHERE thread_id=$1
               AND status='open'
             LIMIT 1`,
            [threadId]
          );

          const conversation = result.rows[0];

          if (!conversation) {
            return interaction.reply({
              content: "⚠️ This ModMail conversation is already closed.",
              ephemeral: true,
            });
          }

          await closeModMailByThread(
            threadId,
            interaction.user.id
          );

          await interaction.update({
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`modmail:closed:${threadId}`)
                  .setLabel("Closed")
                  .setEmoji("🔒")
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(true)
              )
            ]
          });

          const thread = await guild.channels.fetch(threadId).catch(() => null);

          if (thread?.isThread()) {
            await thread.send(
              `🔒 **ModMail closed by ${interaction.user}.**`
            ).catch(() => {});

            setTimeout(() => {
              thread.setArchived(true).catch(() => {});
              thread.setLocked(true).catch(() => {});
            }, 1500);
          }

          const user = await client.users.fetch(
            conversation.user_id
          ).catch(() => null);

          if (user) {
            await user.send(
              "🔒 Your ModMail conversation has been closed by the VeloByte support team. You can send me a new DM anytime to open a new support conversation."
            ).catch(() => {});
          }

          return;
        }

        // ====================================================
        // TICKET CLOSE
        // ====================================================

        if (
          type === "ticket" &&
          value === "close"
        ) {
          if (
            !interaction.channel ||
            !interaction.channel.name?.startsWith(
              "ticket-"
            )
          ) {
            return interaction.reply({
              content:
                "❌ This is not a ticket channel.",
              ephemeral: true,
            });
          }

          await db(
            `UPDATE tickets
             SET status='closed',
                 closed_at=NOW()
             WHERE channel_id=$1`,
            [
              interaction.channel.id,
            ]
          );

          await interaction.reply(
            "🔒 Ticket closed. This channel will be deleted in 5 seconds."
          );

          setTimeout(() => {
            interaction.channel
              ?.delete(
                "Ticket closed"
              )
              .catch(() => {});
          }, 5000);

          return;
        }

        // ====================================================
        // TICKET CREATE
        // ====================================================

        if (
          type === "ticket"
        ) {
          const existing =
            await db(
              `SELECT channel_id
               FROM tickets
               WHERE guild_id=$1
               AND user_id=$2
               AND status='open'
               LIMIT 1`,
              [
                interaction.guild.id,
                interaction.user.id,
              ]
            );

          if (
            existing.rows[0]
          ) {
            return interaction.reply({
              content:
                `❌ You already have an open ticket: <#${existing.rows[0].channel_id}>`,
              ephemeral: true,
            });
          }

          const category =
            process.env.TICKET_CATEGORY_ID ||
            undefined;

          let channelName =
            `ticket-${interaction.user.username}`
              .toLowerCase()
              .replace(
                /[^a-z0-9-]/g,
                ""
              )
              .slice(
                0,
                80
              );

          if (!channelName) {
            channelName =
              `ticket-${interaction.user.id}`;
          }

          const channel =
            await interaction.guild.channels.create(
              {
                name:
                  channelName,

                type:
                  ChannelType.GuildText,

                parent:
                  category,

                permissionOverwrites: [
                  {
                    id:
                      interaction.guild
                        .roles
                        .everyone.id,

                    deny: [
                      PermissionsBitField
                        .Flags
                        .ViewChannel,
                    ],
                  },

                  {
                    id:
                      interaction.user.id,

                    allow: [
                      PermissionsBitField
                        .Flags
                        .ViewChannel,

                      PermissionsBitField
                        .Flags
                        .SendMessages,

                      PermissionsBitField
                        .Flags
                        .ReadMessageHistory,
                    ],
                  },
                ],
              }
            );

          await db(
            `INSERT INTO tickets
             (guild_id,channel_id,user_id,type)
             VALUES($1,$2,$3,$4)`,
            [
              interaction.guild.id,
              channel.id,
              interaction.user.id,
              value ||
                "general",
            ]
          );

          const row =
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    "ticket:close"
                  )
                  .setLabel(
                    "Close Ticket"
                  )
                  .setStyle(
                    ButtonStyle.Danger
                  )
              );

          await channel.send({
            content:
              `<@${interaction.user.id}>`,

            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "🎫 VeloByte Support"
                )
                .setDescription(
                  "A support ticket has been created. A team member will assist you soon."
                )
                .setColor(
                  0x5865f2
                ),
            ],

            components: [
              row,
            ],
          });

          return interaction.reply({
            content:
              `✅ Ticket created: ${channel}`,
            ephemeral: true,
          });
        }
      }

    } catch (error) {
      console.error(
        "❌ Interaction handler error:",
        error
      );

      try {
        if (
          interaction.replied ||
          interaction.deferred
        ) {
          await interaction.followUp({
            content:
              "❌ Something went wrong. Check bot logs.",
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content:
              "❌ Something went wrong. Check bot logs.",
            ephemeral: true,
          });
        }
      } catch {}
    }
  }
);

// ============================================================
// MEMBER JOIN
// ============================================================

client.on(
  Events.GuildMemberAdd,
  async (member) => {
    try {
      const roleId =
        process.env.MEMBER_ROLE_ID;

      if (roleId) {
        await member.roles
          .add(
            roleId,
            "Automatic VeloByte member role"
          )
          .catch(() => {});
      }

      const channelId =
        process.env.WELCOME_CHANNEL_ID;

      const channel =
        channelId
          ? member.guild.channels.cache.get(
              channelId
            )
          : null;

      if (
        channel?.isTextBased()
      ) {
        const count =
          member.guild.memberCount;

        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "👋 Welcome to VeloByte!"
              )
              .setDescription(
                `Welcome ${member}!\n\n` +
                `🎮 Mobile Gaming\n` +
                `📱 Apps\n` +
                `🛠️ Development\n` +
                `🤖 AI & Technology\n\n` +
                `Please read <#${process.env.RULES_CHANNEL_ID || "rules"}> and check the official links.`
              )
              .addFields(
                {
                  name:
                    "Member",
                  value:
                    `#${count}`,
                  inline: true,
                },
                {
                  name:
                    "Server",
                  value:
                    "VeloByte",
                  inline: true,
                }
              )
              .setColor(
                0x5865f2
              )
              .setThumbnail(
                member.user.displayAvatarURL()
              )
              .setTimestamp(),
          ],
        }).catch(() => {});
      }

      await db(
        `INSERT INTO users
         (guild_id,user_id,joined_at)
         VALUES($1,$2,NOW())
         ON CONFLICT DO NOTHING`,
        [
          member.guild.id,
          member.id,
        ]
      );
    } catch (error) {
      console.error(
        "❌ GuildMemberAdd error:",
        error
      );
    }
  }
);

// ============================================================
// ANTI-SPAM + XP
// ============================================================

const spam = new Map();

client.on(
  Events.MessageCreate,
  async (message) => {
    try {
      if (message.author.bot) {
        return;
      }

      // ======================================================
      // MODMAIL: USER DMs THE BOT
      // ======================================================

      if (!message.guild) {
        await handleModMailDM(message);
        return;
      }

      // ======================================================
      // MODMAIL: STAFF REPLIES IN A MODMAIL THREAD
      // ======================================================

      if (message.channel?.isThread()) {
        const handled = await handleModMailStaffReply(message);
        if (handled) return;
      }

      const now =
        Date.now();

      const key =
        `${message.guild.id}:${message.author.id}`;

      const list =
        spam.get(key) || [];

      list.push(now);

      while (
        list.length &&
        now -
          list[0] >
            Number(
              process.env
                .SPAM_WINDOW_SECONDS ||
                8
            ) *
              1000
      ) {
        list.shift();
      }

      spam.set(
        key,
        list
      );

      // ======================================================
      // INVITE BLOCK
      // ======================================================

      const isInvite =
        /(discord\.gg\/|discord\.com\/invite\/)/i.test(
          message.content
        );

      if (
        process.env.INVITE_BLOCK ===
          "true" &&
        isInvite &&
        !message.member.permissions.has(
          PermissionsBitField
            .Flags
            .ManageMessages
        )
      ) {
        await message
          .delete()
          .catch(() => {});

        await logAction(
          message.guild,
          "🚨 Invite blocked",
          `${message.author} attempted to post a Discord invite.`,
          0xed4245
        );

        return;
      }

      // ======================================================
      // ANTI-SPAM
      // ======================================================

      if (
        list.length >=
          Number(
            process.env
              .SPAM_MESSAGE_COUNT ||
              6
          ) &&
        message.member.moderatable
      ) {
        await message.member
          .timeout(
            60_000,
            "VeloByte anti-spam"
          )
          .catch(() => {});

        spam.delete(
          key
        );

        await logAction(
          message.guild,
          "🛡️ Anti-spam timeout",
          `${message.author} was automatically timed out for message flooding.`,
          0xed4245
        );

        return;
      }

      // ======================================================
      // XP
      // ======================================================

      const cooldown =
        Number(
          process.env
            .XP_COOLDOWN_SECONDS ||
            60
        ) *
        1000;

      const user =
        await db(
          `SELECT xp,level,last_xp_at
           FROM users
           WHERE guild_id=$1
           AND user_id=$2`,
          [
            message.guild.id,
            message.author.id,
          ]
        );

      if (
        !user.rows[0]
      ) {
        await db(
          `INSERT INTO users
           (guild_id,user_id,xp,level,last_xp_at)
           VALUES($1,$2,$3,0,NOW())`,
          [
            message.guild.id,
            message.author.id,
            Number(
              process.env
                .XP_PER_MESSAGE ||
                5
            ),
          ]
        );
      } else {
        const lastXp =
          user.rows[0]
            .last_xp_at;

        if (
          !lastXp ||
          now -
            new Date(
              lastXp
            ).getTime() >=
              cooldown
        ) {
          const oldLevel =
            Number(
              user.rows[0]
                .level ||
                0
            );

          const newXp =
            Number(
              user.rows[0]
                .xp ||
                0
            ) +
            Number(
              process.env
                .XP_PER_MESSAGE ||
                5
            );

          const newLevel =
            Math.floor(
              Math.sqrt(
                newXp /
                  100
              )
            );

          await db(
            `UPDATE users
             SET xp=$3,
                 level=$4,
                 last_xp_at=NOW()
             WHERE guild_id=$1
             AND user_id=$2`,
            [
              message.guild.id,
              message.author.id,
              newXp,
              newLevel,
            ]
          );

          if (
            newLevel >
            oldLevel
          ) {
            await message.channel
              .send(
                `🎉 ${message.author} reached **Level ${newLevel}**!`
              )
              .catch(() => {});
          }
        }
      }
    } catch (error) {
      console.error(
        "❌ MessageCreate error:",
        error
      );
    }
  }
);

// ============================================================
// MEMBER LEAVE
// ============================================================

client.on(
  Events.GuildMemberRemove,
  async (member) => {
    try {
      await logAction(
        member.guild,
        "👋 Member left",
        `${member.user.tag} left VeloByte.`,
        0x99aab5
      );
    } catch (error) {
      console.error(
        "❌ GuildMemberRemove error:",
        error
      );
    }
  }
);

// ============================================================
// PROCESS ERROR HANDLERS
// ============================================================

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "❌ Unhandled Promise Rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "❌ Uncaught Exception:",
      error
    );
  }
);

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function shutdown(
  signal
) {
  console.log(
    `🛑 ${signal} received. Shutting down...`
  );

  try {
    await pool.end();
  } catch {}

  try {
    client.destroy();
  } catch {}

  process.exit(0);
}

process.on(
  "SIGTERM",
  () =>
    shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () =>
    shutdown("SIGINT")
);

// ============================================================
// LOGIN
// ============================================================

client
  .login(
    process.env.DISCORD_TOKEN
  )
  .then(() => {
    console.log(
      "🔑 Discord login successful."
    );
  })
  .catch((error) => {
    console.error(
      "❌ Discord login failed:"
    );
    console.error(error);
    process.exit(1);
  });
