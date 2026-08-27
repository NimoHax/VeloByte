const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const MANAGE_GUILD =
  PermissionFlagsBits.ManageGuild;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup-ticket")
    .setDescription(
      "Post the VeloByte ticket panel."
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

    if (
      !interaction.channel ||
      !interaction.channel.isTextBased()
    ) {
      return interaction.reply({
        content:
          "❌ This command can only be used in a text channel.",
        ephemeral: true,
      });
    }

    const bot =
      interaction.guild.members.me;

    if (
      !bot?.permissions.has(
        PermissionFlagsBits.SendMessages
      )
    ) {
      return interaction.reply({
        content:
          "❌ I need **Send Messages** permission in this channel.",
        ephemeral: true,
      });
    }

    const row =
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket:general")
          .setLabel("General Support")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("ticket:technical")
          .setLabel("Technical")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("ticket:bug")
          .setLabel("Bug Report")
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId("ticket:business")
          .setLabel("Business")
          .setStyle(ButtonStyle.Success)
      );

    const embed =
      new EmbedBuilder()
        .setTitle("🎫 VeloByte Support Center")
        .setDescription(
          "Need help? Choose the appropriate option below. A private ticket will be created for you."
        )
        .setColor(0x5865f2)
        .setTimestamp();

    try {
      await interaction.channel.send({
        embeds: [embed],
        components: [row],
      });

      return interaction.reply({
        content:
          "✅ Ticket panel posted successfully.",
        ephemeral: true,
      });
    } catch (error) {
      console.error(
        "❌ Ticket setup error:",
        error
      );

      return interaction.reply({
        content:
          "❌ Failed to post the ticket panel.",
        ephemeral: true,
      });
    }
  },
};
