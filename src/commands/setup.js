const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
module.exports = {
  data: new SlashCommandBuilder().setName("setup-ticket").setDescription("Post the VeloByte ticket panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.bitfield),
  async execute(i) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ticket:general").setLabel("General Support").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("ticket:technical").setLabel("Technical").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("ticket:bug").setLabel("Bug Report").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ticket:business").setLabel("Business").setStyle(ButtonStyle.Success)
    );
    await i.channel.send({embeds:[new EmbedBuilder().setTitle("🎫 VeloByte Support Center").setDescription("Need help? Choose the appropriate option below. A private ticket will be created for you.").setColor(0x5865F2)],components:[row]});
    await i.reply({content:"✅ Ticket panel posted.",ephemeral:true});
  }
};
