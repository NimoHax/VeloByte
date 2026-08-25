const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
module.exports = [
  { data:new SlashCommandBuilder().setName("bug").setDescription("Report a VeloByte product bug.")
      .addStringOption(o=>o.setName("product").setDescription("Game/app name").setRequired(true))
      .addStringOption(o=>o.setName("description").setDescription("Bug description").setRequired(true))
      .addStringOption(o=>o.setName("platform").setDescription("Android/iOS/etc"))
      .addStringOption(o=>o.setName("version").setDescription("Product version"))
      .addStringOption(o=>o.setName("severity").setDescription("low/medium/high/critical").addChoices(
        {name:"Low",value:"low"},{name:"Medium",value:"medium"},{name:"High",value:"high"},{name:"Critical",value:"critical"})),
    async execute(i,{db}) {
      const r=await db("INSERT INTO bugs(guild_id,reporter_id,product,description,platform,version,severity) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [i.guild.id,i.user.id,i.options.getString("product"),i.options.getString("description"),i.options.getString("platform"),i.options.getString("version"),i.options.getString("severity")||"medium"]);
      const id=r.rows[0].id;
      const ch=process.env.BUG_CHANNEL_ID?i.guild.channels.cache.get(process.env.BUG_CHANNEL_ID):i.channel;
      if(ch?.isTextBased()) await ch.send({embeds:[new EmbedBuilder().setTitle(`🐛 BUG #VB-${id}`).setDescription(i.options.getString("description")).addFields(
        {name:"Product",value:i.options.getString("product"),inline:true},
        {name:"Platform",value:i.options.getString("platform")||"Not provided",inline:true},
        {name:"Version",value:i.options.getString("version")||"Not provided",inline:true},
        {name:"Severity",value:i.options.getString("severity")||"medium",inline:true},
        {name:"Reporter",value:`${i.user}`,inline:true},
        {name:"Status",value:"🔴 Open",inline:true}
      ).setColor(0xED4245)]});
      await i.reply({content:`🐛 Bug report #VB-${id} created. Thank you!`,ephemeral:true});
    }
  },
  { data:new SlashCommandBuilder().setName("bug-status").setDescription("Change a bug status.")
      .addIntegerOption(o=>o.setName("id").setDescription("Bug ID").setRequired(true))
      .addStringOption(o=>o.setName("status").setDescription("New status").setRequired(true).addChoices(
        {name:"Open",value:"open"},{name:"Investigating",value:"investigating"},{name:"In Development",value:"development"},{name:"Testing",value:"testing"},{name:"Fixed",value:"fixed"}))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.bitfield),
    async execute(i,{db}) {
      const id=i.options.getInteger("id"), status=i.options.getString("status");
      const r=await db("UPDATE bugs SET status=$2,updated_at=NOW() WHERE guild_id=$1 AND id=$3 RETURNING id",[i.guild.id,status,id]);
      if(!r.rows[0]) return i.reply({content:"❌ Bug not found.",ephemeral:true});
      const fixed=process.env.FIXED_BUG_CHANNEL_ID?i.guild.channels.cache.get(process.env.FIXED_BUG_CHANNEL_ID):null;
      if(status==="fixed" && fixed?.isTextBased()) await fixed.send(`✅ **Bug #VB-${id}** has been fixed.`);
      await i.reply(`✅ Bug #VB-${id} status changed to **${status}**.`);
    }
  }
];
