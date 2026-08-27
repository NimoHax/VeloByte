const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const MANAGE_GUILD = PermissionFlagsBits.ManageGuild;

module.exports = [
  // ==========================================================
  // BUG REPORT
  // ==========================================================

  {
    data: new SlashCommandBuilder()
      .setName("bug")
      .setDescription(
        "Report a VeloByte product bug."
      )
      .setDMPermission(false)

      .addStringOption((o) =>
        o
          .setName("product")
          .setDescription("Game/app name")
          .setRequired(true)
          .setMaxLength(100)
      )

      .addStringOption((o) =>
        o
          .setName("description")
          .setDescription("Bug description")
          .setRequired(true)
          .setMaxLength(2000)
      )

      .addStringOption((o) =>
        o
          .setName("platform")
          .setDescription("Android/iOS/etc")
          .setMaxLength(100)
      )

      .addStringOption((o) =>
        o
          .setName("version")
          .setDescription("Product version")
          .setMaxLength(50)
      )

      .addStringOption((o) =>
        o
          .setName("severity")
          .setDescription("Bug severity")
          .addChoices(
            {
              name: "Low",
              value: "low",
            },
            {
              name: "Medium",
              value: "medium",
            },
            {
              name: "High",
              value: "high",
            },
            {
              name: "Critical",
              value: "critical",
            }
          )
      ),

    async execute(i, { db }) {
      try {
        const product =
          i.options.getString("product");

        const description =
          i.options.getString("description");

        const platform =
          i.options.getString("platform");

        const version =
          i.options.getString("version");

        const severity =
          i.options.getString("severity") ||
          "medium";

        const result = await db(
          `INSERT INTO bugs
           (
             guild_id,
             reporter_id,
             product,
             description,
             platform,
             version,
             severity
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id`,
          [
            i.guild.id,
            i.user.id,
            product,
            description,
            platform,
            version,
            severity,
          ]
        );

        const id = result.rows[0].id;

        const channel =
          process.env.BUG_CHANNEL_ID
            ? i.guild.channels.cache.get(
                process.env.BUG_CHANNEL_ID
              )
            : i.channel;

        if (channel?.isTextBased()) {
          const embed =
            new EmbedBuilder()
              .setTitle(
                `🐛 BUG #VB-${id}`
              )
              .setDescription(
                description
              )
              .addFields(
                {
                  name: "Product",
                  value: product,
                  inline: true,
                },
                {
                  name: "Platform",
                  value:
                    platform ||
                    "Not provided",
                  inline: true,
                },
                {
                  name: "Version",
                  value:
                    version ||
                    "Not provided",
                  inline: true,
                },
                {
                  name: "Severity",
                  value: severity,
                  inline: true,
                },
                {
                  name: "Reporter",
                  value: `${i.user}`,
                  inline: true,
                },
                {
                  name: "Status",
                  value: "🔴 Open",
                  inline: true,
                }
              )
              .setColor(0xed4245)
              .setTimestamp();

          await channel.send({
            embeds: [embed],
          });
        }

        return i.reply({
          content:
            `🐛 Bug report #VB-${id} created. Thank you!`,
          ephemeral: true,
        });
      } catch (error) {
        console.error(
          "❌ Bug command error:",
          error
        );

        return i.reply({
          content:
            "❌ Failed to create the bug report.",
          ephemeral: true,
        });
      }
    },
  },

  // ==========================================================
  // BUG STATUS - ADMIN / MANAGE SERVER ONLY
  // ==========================================================

  {
    data: new SlashCommandBuilder()
      .setName("bug-status")
      .setDescription(
        "Change a bug status."
      )
      .setDMPermission(false)

      .addIntegerOption((o) =>
        o
          .setName("id")
          .setDescription("Bug ID")
          .setRequired(true)
      )

      .addStringOption((o) =>
        o
          .setName("status")
          .setDescription("New status")
          .setRequired(true)
          .addChoices(
            {
              name: "Open",
              value: "open",
            },
            {
              name: "Investigating",
              value: "investigating",
            },
            {
              name: "In Development",
              value: "development",
            },
            {
              name: "Testing",
              value: "testing",
            },
            {
              name: "Fixed",
              value: "fixed",
            }
          )
      )

      .setDefaultMemberPermissions(
        MANAGE_GUILD
      ),

    async execute(i, { db }) {
      // Runtime permission protection
      if (
        !i.memberPermissions?.has(
          MANAGE_GUILD
        )
      ) {
        return i.reply({
          content:
            "❌ You need **Manage Server** permission to use this command.",
          ephemeral: true,
        });
      }

      try {
        const id =
          i.options.getInteger("id");

        const status =
          i.options.getString("status");

        const result = await db(
          `UPDATE bugs
           SET status=$2,
               updated_at=NOW()
           WHERE guild_id=$1
           AND id=$3
           RETURNING id`,
          [
            i.guild.id,
            status,
            id,
          ]
        );

        if (!result.rows[0]) {
          return i.reply({
            content:
              "❌ Bug not found.",
            ephemeral: true,
          });
        }

        const fixedChannel =
          process.env.FIXED_BUG_CHANNEL_ID
            ? i.guild.channels.cache.get(
                process.env.FIXED_BUG_CHANNEL_ID
              )
            : null;

        if (
          status === "fixed" &&
          fixedChannel?.isTextBased()
        ) {
          await fixedChannel.send(
            `✅ **Bug #VB-${id}** has been fixed.`
          );
        }

        return i.reply(
          `✅ Bug #VB-${id} status changed to **${status}**.`
        );
      } catch (error) {
        console.error(
          "❌ Bug status error:",
          error
        );

        return i.reply({
          content:
            "❌ Failed to update bug status.",
          ephemeral: true,
        });
      }
    },
  },
];
