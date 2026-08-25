const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
module.exports = {
  data:new SlashCommandBuilder().setName("security").setDescription("Show VeloByte security status.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.bitfield),
  async execute(i) {
    const invite=process.env.INVITE_BLOCK==="true"?"🟢":"🔴";
    const antiSpam=process.env.SPAM_MESSAGE_COUNT?"🟢":"🔴";
    await i.reply({embeds:[new EmbedBuilder().setTitle("🛡️ VeloByte Security").addFields(
      {name:"Anti-Spam",value:antiSpam,inline:true},
      {name:"Invite Protection",value:invite,inline:true},
      {name:"Welcome",value:process.env.WELCOME_CHANNEL_ID?"🟢":"🔴",inline:true},
      {name:"Ticket System",value:process.env.TICKET_CATEGORY_ID?"🟢":"🔴",inline:true},
      {name:"Bug System",value:process.env.BUG_CHANNEL_ID?"🟢":"🔴",inline:true},
      {name:"Mod Logs",value:process.env.MOD_LOG_CHANNEL_ID?"🟢":"🔴",inline:true}
    ).setColor(0x57F287)]});
  }
};
