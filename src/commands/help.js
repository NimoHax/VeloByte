const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
module.exports = {
  data: new SlashCommandBuilder().setName("help").setDescription("Show VeloByte Core commands."),
  async execute(i) {
    const e = new EmbedBuilder().setTitle("🤖 VeloByte Core").setDescription([
      "**Moderation:** `/warn` `/timeout` `/kick` `/ban` `/clear`",
      "**Support:** `/setup-ticket`",
      "**Community:** `/profile` `/leaderboard` `/suggest`",
      "**Development:** `/bug` `/bug-status`",
      "**Events:** `/event-create` `/event-join`",
      "**Music:** `/play` `/pause` `/resume` `/skip` `/queue` `/stop`",
      "**Security:** `/security`"
    ].join("\n")).setColor(0x5865F2);
    await i.reply({ embeds: [e], ephemeral: true });
  }
};
