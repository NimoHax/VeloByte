const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

function base(name, description, optionName, required = true) {
  return new SlashCommandBuilder().setName(name).setDescription(description)
    .addUserOption(o => o.setName("user").setDescription("Target member").setRequired(true))
    .addStringOption(o => o.setName(optionName).setDescription("Reason").setRequired(required))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers.bitfield);
}

module.exports = [
  {
    data: base("warn", "Warn a member.", "reason"),
    async execute(i,{db,logAction}) {
      const m = await i.guild.members.fetch(i.options.getUser("user").id);
      const reason=i.options.getString("reason");
      if (m.id===i.guild.ownerId || !m.moderatable) return i.reply({content:"❌ I cannot moderate this member.",ephemeral:true});
      await db("INSERT INTO users(guild_id,user_id,warnings) VALUES($1,$2,1) ON CONFLICT(guild_id,user_id) DO UPDATE SET warnings=users.warnings+1",[i.guild.id,m.id]);
      await db("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason) VALUES($1,$2,$3,'warn',$4)",[i.guild.id,m.id,i.user.id,reason]);
      await logAction(i.guild,"⚠️ Warning",`${m} was warned by ${i.user}.\nReason: ${reason}`,0xFEE75C);
      await i.reply(`⚠️ ${m} has been warned.`);
    }
  },
  {
    data: new SlashCommandBuilder().setName("timeout").setDescription("Timeout a member.")
      .addUserOption(o=>o.setName("user").setDescription("Target").setRequired(true))
      .addIntegerOption(o=>o.setName("minutes").setDescription("Minutes").setRequired(true).setMinValue(1).setMaxValue(10080))
      .addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers.bitfield),
    async execute(i,{db,logAction}) {
      const m=await i.guild.members.fetch(i.options.getUser("user").id), min=i.options.getInteger("minutes"), reason=i.options.getString("reason");
      if(m.id===i.guild.ownerId || !m.moderatable) return i.reply({content:"❌ I cannot timeout this member.",ephemeral:true});
      await m.timeout(min*60000,reason);
      await db("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,duration_seconds) VALUES($1,$2,$3,'timeout',$4,$5)",[i.guild.id,m.id,i.user.id,reason,min*60]);
      await logAction(i.guild,"⏳ Timeout",`${m} timed out for ${min} minute(s).\nReason: ${reason}`,0xFEE75C);
      await i.reply(`⏳ ${m} timed out for ${min} minute(s).`);
    }
  },
  {
    data: new SlashCommandBuilder().setName("kick").setDescription("Kick a member.")
      .addUserOption(o=>o.setName("user").setDescription("Target").setRequired(true))
      .addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers.bitfield),
    async execute(i,{db,logAction}) {
      const m=await i.guild.members.fetch(i.options.getUser("user").id), reason=i.options.getString("reason");
      if(m.id===i.guild.ownerId || !m.kickable) return i.reply({content:"❌ I cannot kick this member.",ephemeral:true});
      await m.kick(reason);
      await db("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason) VALUES($1,$2,$3,'kick',$4)",[i.guild.id,m.id,i.user.id,reason]);
      await logAction(i.guild,"👢 Kick",`${m.user.tag} kicked by ${i.user}.\nReason: ${reason}`,0xED4245);
      await i.reply(`👢 ${m.user.tag} was kicked.`);
    }
  },
  {
    data: new SlashCommandBuilder().setName("ban").setDescription("Ban a member.")
      .addUserOption(o=>o.setName("user").setDescription("Target").setRequired(true))
      .addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers.bitfield),
    async execute(i,{db,logAction}) {
      const m=await i.guild.members.fetch(i.options.getUser("user").id), reason=i.options.getString("reason");
      if(m.id===i.guild.ownerId || !m.bannable) return i.reply({content:"❌ I cannot ban this member.",ephemeral:true});
      await m.ban({reason});
      await db("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason) VALUES($1,$2,$3,'ban',$4)",[i.guild.id,m.id,i.user.id,reason]);
      await logAction(i.guild,"🔨 Ban",`${m.user.tag} banned by ${i.user}.\nReason: ${reason}`,0xED4245);
      await i.reply(`🔨 ${m.user.tag} was banned.`);
    }
  },
  {
    data: new SlashCommandBuilder().setName("clear").setDescription("Delete messages.")
      .addIntegerOption(o=>o.setName("amount").setDescription("1-100").setRequired(true).setMinValue(1).setMaxValue(100))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.bitfield),
    async execute(i,{logAction}) {
      const amount=i.options.getInteger("amount");
      if(!i.channel.isTextBased() || !i.channel.bulkDelete) return i.reply({content:"❌ Not supported here.",ephemeral:true});
      await i.deferReply({ephemeral:true});
      const deleted=await i.channel.bulkDelete(amount,true);
      await logAction(i.guild,"🧹 Messages cleared",`${i.user} deleted ${deleted.size} message(s) in ${i.channel}.`);
      await i.editReply(`🧹 Deleted ${deleted.size} message(s).`);
    }
  }
];
