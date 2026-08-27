const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");

const MANAGE_GUILD =
  PermissionFlagsBits.ManageGuild;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("security")
    .setDescription(
      "Show VeloByte security status."
    )
    .setDefaultMemberPermissions(
      MANAGE_GUILD
    )
    .setDMPermission(false),

  async execute(interaction) {
    if (
      !interaction.memberPermissions?.has(
        MANAGE_GUILD
      )
    ) {
      return interaction.reply({
        content:
          "❌ You need **Manage Server** permission to use this command.",
        ephemeral: true,
      });
    }

    const invite =
      process.env.INVITE_BLOCK === "true"
        ? "🟢 Enabled"
        : "🔴 Disabled";

    const antiSpam =
      process.env.SPAM_MESSAGE_COUNT
        ? "🟢 Enabled"
        : "🔴 Disabled";

    const welcome =
      process.env.WELCOME_CHANNEL_ID
        ? "🟢 Configured"
        : "🔴 Not configured";

    const ticket =
      process.env.TICKET_CATEGORY_ID
        ? "🟢 Configured"
        : "🔴 Not configured";

    const bug =
      process.env.BUG_CHANNEL_ID
        ? "🟢 Configured"
        : "🔴 Not configured";

    const logs =
      process.env.MOD_LOG_CHANNEL_ID
        ? "🟢 Configured"
        : "🔴 Not configured";

    const embed =
      new EmbedBuilder()
        .setTitle("🛡️ VeloByte Security")
        .setDescription(
          "Current security and system configuration."
        )
        .addFields(
          {
            name: "Anti-Spam",
            value: antiSpam,
            inline: true,
          },
          {
            name: "Invite Protection",
            value: invite,
            inline: true,
          },
          {
            name: "Welcome",
            value: welcome,
            inline: true,
          },
          {
            name: "Ticket System",
            value: ticket,
            inline: true,
          },
          {
            name: "Bug System",
            value: bug,
            inline: true,
          },
          {
            name: "Mod Logs",
            value: logs,
            inline: true,
          }
        )
        .setColor(0x57f287)
        .setTimestamp();

    return interaction.reply({
      embeds: [embed],
    });
  },
};
