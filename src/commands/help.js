const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show VeloByte Core commands."),

  async execute(i) {
    const e = new EmbedBuilder()
      .setTitle("🤖 VeloByte Core")
      .setDescription(
        [
          "### 🛡️ Moderation",
          "`/warn` `/warnings` `/unwarn`",
          "`/timeout` `/untimeout`",
          "`/kick` `/ban` `/unban` `/softban`",
          "`/clear` `/purge`",
          "`/lock` `/unlock` `/slowmode`",
          "`/nick` `/role-add` `/role-remove`",
          "`/say`",

          "",
          "### 🎫 Support",
          "`/setup-ticket`",

          "",
          "### 👥 Community",
          "`/profile` `/leaderboard` `/suggest`",

          "",
          "### 🐛 Development",
          "`/bug` `/bug-status`",

          "",
          "### 🎉 Events",
          "`/event-create` `/event-join`",

          "",
          "### 🎵 Music",
          "`/play` `/pause` `/resume`",
          "`/skip` `/queue` `/stop`",

          "",
          "### 🔐 Security",
          "`/security`",
        ].join("\n")
      )
      .setColor(0x5865f2)
      .setFooter({
        text: "VeloByte Core • Moderation commands require Administrator",
      });

    await i.reply({
      embeds: [e],
      ephemeral: true,
    });
  },
};
