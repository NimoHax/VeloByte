const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
module.exports = [
  { data:new SlashCommandBuilder().setName("profile").setDescription("Show your VeloByte profile."),
    async execute(i,{db}) {
      const r=await db("SELECT xp,level,warnings FROM users WHERE guild_id=$1 AND user_id=$2",[i.guild.id,i.user.id]);
      const u=r.rows[0]||{xp:0,level:0,warnings:0};
      await i.reply({embeds:[new EmbedBuilder().setTitle(`👤 ${i.user.username}`).setThumbnail(i.user.displayAvatarURL()).addFields(
        {name:"⭐ Level",value:String(u.level),inline:true},{name:"✨ XP",value:String(u.xp),inline:true},{name:"⚠️ Warnings",value:String(u.warnings),inline:true}
      ).setColor(0x5865F2)]});
    }
  },
  { data:new SlashCommandBuilder().setName("leaderboard").setDescription("Show the XP leaderboard."),
    async execute(i,{db}) {
      const r=await db("SELECT user_id,xp,level FROM users WHERE guild_id=$1 ORDER BY xp DESC LIMIT 10",[i.guild.id]);
      const text=r.rows.map((x,n)=>`${n+1}. <@${x.user_id}> — Level ${x.level} • ${x.xp} XP`).join("\n")||"No data yet.";
      await i.reply({embeds:[new EmbedBuilder().setTitle("🏆 VeloByte Leaderboard").setDescription(text).setColor(0xFEE75C)]});
    }
  },
  { data:new SlashCommandBuilder().setName("suggest").setDescription("Submit a community suggestion.")
      .addStringOption(o=>o.setName("title").setDescription("Suggestion title").setRequired(true))
      .addStringOption(o=>o.setName("description").setDescription("Details").setRequired(true)),
    async execute(i,{db}) {
      const r=await db("INSERT INTO suggestions(guild_id,author_id,title,description) VALUES($1,$2,$3,$4) RETURNING id",[i.guild.id,i.user.id,i.options.getString("title"),i.options.getString("description")]);
      const id=r.rows[0].id;
      const channelId=process.env.SUGGESTION_CHANNEL_ID;
      const ch=channelId?i.guild.channels.cache.get(channelId):i.channel;
      if(ch?.isTextBased()) await ch.send({embeds:[new EmbedBuilder().setTitle(`💡 Suggestion #${id}`).setDescription(i.options.getString("description")).addFields({name:"Title",value:i.options.getString("title")},{name:"Submitted by",value:`${i.user}`},{name:"Status",value:"🟡 Under Review"}).setColor(0x5865F2)]});
      await i.reply({content:`✅ Suggestion #${id} submitted.`,ephemeral:true});
    }
  }
];
