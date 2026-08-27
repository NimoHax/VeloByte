const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");

// ModMail is intentionally configured through environment variables.
// The actual DM -> thread routing lives in src/index.js so it can
// coexist with the bot's existing MessageCreate handler.

const command = {
  data: new SlashCommandBuilder()
    .setName("modmail")
    .setDescription("Show ModMail configuration/status.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages.toString()
    ),

  async execute(interaction) {
    const channelId = process.env.MODMAIL_CHANNEL_ID;
    const roleId = process.env.MODMAIL_STAFF_ROLE_ID;

    if (!channelId || !roleId) {
      return interaction.reply({
        content:
          "❌ ModMail is not configured. Set MODMAIL_CHANNEL_ID and MODMAIL_STAFF_ROLE_ID in Coolify.",
        ephemeral: true,
      });
    }

    return interaction.reply({
      content:
        `✅ ModMail is enabled.\n` +
        `📨 Inbox: <#${channelId}>\n` +
        `👮 Staff role: <@&${roleId}>`,
      ephemeral: true,
    });
  },
};

module.exports = command;
