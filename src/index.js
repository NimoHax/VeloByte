require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events
} = require("discord.js");
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"))) {
  const loaded = require(path.join(commandsPath, file));
  const list = Array.isArray(loaded) ? loaded : [loaded];
  for (const command of list) client.commands.set(command.data.name, command);
}

async function db(sql, params = []) {
  return pool.query(sql, params);
}

async function logAction(guild, title, description, color = 0x5865F2) {
  const id = process.env.MOD_LOG_CHANNEL_ID || process.env.LOG_CHANNEL_ID;
  if (!id) return;
  const channel = guild.channels.cache.get(id);
  if (!channel?.isTextBased()) return;
  await channel.send({
    embeds: [new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp()]
  }).catch(() => {});
}

client.once(Events.ClientReady, async c => {
  console.log(`VeloByte Core online as ${c.user.tag}`);
  await db("CREATE TABLE IF NOT EXISTS users (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 0, warnings INTEGER NOT NULL DEFAULT 0, last_xp_at TIMESTAMPTZ, joined_at TIMESTAMPTZ, PRIMARY KEY (guild_id,user_id))");
  await db("CREATE TABLE IF NOT EXISTS moderation_cases (id BIGSERIAL PRIMARY KEY,guild_id TEXT NOT NULL,user_id TEXT NOT NULL,moderator_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT,duration_seconds INTEGER,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await db("CREATE TABLE IF NOT EXISTS tickets (id BIGSERIAL PRIMARY KEY,guild_id TEXT NOT NULL,channel_id TEXT UNIQUE NOT NULL,user_id TEXT NOT NULL,type TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',claimed_by TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),closed_at TIMESTAMPTZ)");
  await db("CREATE TABLE IF NOT EXISTS bugs (id BIGSERIAL PRIMARY KEY,guild_id TEXT NOT NULL,reporter_id TEXT NOT NULL,product TEXT NOT NULL,platform TEXT,version TEXT,severity TEXT NOT NULL DEFAULT 'medium',description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',assigned_to TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await db("CREATE TABLE IF NOT EXISTS suggestions (id BIGSERIAL PRIMARY KEY,guild_id TEXT NOT NULL,author_id TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'under_review',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await db("CREATE TABLE IF NOT EXISTS events (id BIGSERIAL PRIMARY KEY,guild_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT,starts_at TIMESTAMPTZ NOT NULL,channel_id TEXT,created_by TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled')");
  await db("CREATE TABLE IF NOT EXISTS event_members (event_id BIGINT REFERENCES events(id) ON DELETE CASCADE,user_id TEXT NOT NULL,joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(event_id,user_id))");
  await db("CREATE TABLE IF NOT EXISTS settings (guild_id TEXT PRIMARY KEY,json JSONB NOT NULL DEFAULT '{}'::jsonb)");
  console.log(`Connected to PostgreSQL`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction, { db, logAction, client });
    }

    if (interaction.isButton()) {
      const [type, value] = interaction.customId.split(":");

      if (type === "verify") {
        const roleId = process.env.MEMBER_ROLE_ID || process.env.VERIFIED_ROLE_ID;
        if (!roleId) return interaction.reply({ content: "Verification role is not configured.", ephemeral: true });
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(roleId)) await member.roles.add(roleId, "VeloByte verification");
        return interaction.reply({ content: "✅ You are verified and have received the Member role.", ephemeral: true });
      }

      if (type === "ticket" && value === "close") {
        if (!interaction.channel?.name.startsWith("ticket-")) return interaction.reply({ content: "This is not a ticket channel.", ephemeral: true });
        await db("UPDATE tickets SET status='closed', closed_at=NOW() WHERE channel_id=$1", [interaction.channel.id]);
        await interaction.reply("🔒 Ticket closed. This channel will be deleted in 5 seconds.");
        setTimeout(() => interaction.channel.delete("Ticket closed").catch(() => {}), 5000);
        return;
      }

      if (type === "ticket") {
        const existing = await db("SELECT channel_id FROM tickets WHERE guild_id=$1 AND user_id=$2 AND status='open' LIMIT 1", [interaction.guild.id, interaction.user.id]);
        if (existing.rows[0]) return interaction.reply({ content: `You already have an open ticket: <#${existing.rows[0].channel_id}>`, ephemeral: true });

        const category = process.env.TICKET_CATEGORY_ID || undefined;
        const channel = await interaction.guild.channels.create({
          name: `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80),
          type: ChannelType.GuildText,
          parent: category,
          permissionOverwrites: [
            { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
          ]
        });
        await db("INSERT INTO tickets(guild_id,channel_id,user_id,type) VALUES($1,$2,$3,$4)", [interaction.guild.id, channel.id, interaction.user.id, value || "general"]);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("ticket:close").setLabel("Close Ticket").setStyle(ButtonStyle.Danger)
        );
        await channel.send({ content: `<@${interaction.user.id}>`, embeds: [new EmbedBuilder().setTitle("🎫 VeloByte Support").setDescription("A support ticket has been created. A team member will assist you soon.").setColor(0x5865F2)], components: [row] });
        return interaction.reply({ content: `✅ Ticket created: ${channel}`, ephemeral: true });
      }


    }
  } catch (e) {
    console.error(e);
    if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: "❌ Something went wrong. Check bot logs.", ephemeral: true }).catch(() => {});
  }
});

client.on(Events.GuildMemberAdd, async member => {
  const roleId = process.env.MEMBER_ROLE_ID;
  if (roleId) await member.roles.add(roleId, "Automatic VeloByte member role").catch(() => {});
  const channelId = process.env.WELCOME_CHANNEL_ID;
  const channel = channelId ? member.guild.channels.cache.get(channelId) : null;
  if (channel?.isTextBased()) {
    const count = member.guild.memberCount;
    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle("👋 Welcome to VeloByte!")
        .setDescription(`Welcome ${member}!\n\n🎮 Mobile Gaming\n📱 Apps\n🛠️ Development\n🤖 AI & Technology\n\nPlease read <#${process.env.RULES_CHANNEL_ID || "rules"}> and check the official links.`)
        .addFields({ name: "Member", value: `#${count}`, inline: true }, { name: "Server", value: "VeloByte", inline: true })
        .setColor(0x5865F2).setThumbnail(member.user.displayAvatarURL()).setTimestamp()]
    }).catch(() => {});
  }
  await db("INSERT INTO users(guild_id,user_id,joined_at) VALUES($1,$2,NOW()) ON CONFLICT DO NOTHING", [member.guild.id, member.id]);
});

const spam = new Map();

client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot) return;

  const now = Date.now();
  const key = `${message.guild.id}:${message.author.id}`;
  const list = spam.get(key) || [];
  list.push(now);
  while (list.length && now - list[0] > Number(process.env.SPAM_WINDOW_SECONDS || 8) * 1000) list.shift();
  spam.set(key, list);

  const isInvite = /(discord\.gg\/|discord\.com\/invite\/)/i.test(message.content);
  if (process.env.INVITE_BLOCK === "true" && isInvite && !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
    await message.delete().catch(() => {});
    await logAction(message.guild, "🚨 Invite blocked", `${message.author} attempted to post a Discord invite.`, 0xED4245);
    return;
  }

  if (list.length >= Number(process.env.SPAM_MESSAGE_COUNT || 6) && message.member.moderatable) {
    await message.member.timeout(60_000, "VeloByte anti-spam").catch(() => {});
    spam.delete(key);
    await logAction(message.guild, "🛡️ Anti-spam timeout", `${message.author} was automatically timed out for message flooding.`, 0xED4245);
    return;
  }

  const cooldown = Number(process.env.XP_COOLDOWN_SECONDS || 60) * 1000;
  const user = await db("SELECT xp,level,last_xp_at FROM users WHERE guild_id=$1 AND user_id=$2", [message.guild.id, message.author.id]);
  if (!user.rows[0]) await db("INSERT INTO users(guild_id,user_id,xp,level,last_xp_at) VALUES($1,$2,$3,0,NOW())", [message.guild.id,message.author.id,Number(process.env.XP_PER_MESSAGE || 5)]);
  else if (!user.rows[0].last_xp_at || now - new Date(user.rows[0].last_xp_at).getTime() >= cooldown) {
    const oldLevel = Number(user.rows[0].level || 0);
    const newXp = Number(user.rows[0].xp || 0) + Number(process.env.XP_PER_MESSAGE || 5);
    const newLevel = Math.floor(Math.sqrt(newXp / 100));
    await db("UPDATE users SET xp=$3,level=$4,last_xp_at=NOW() WHERE guild_id=$1 AND user_id=$2", [message.guild.id,message.author.id,newXp,newLevel]);
    if (newLevel > oldLevel) {
      await message.channel.send(`🎉 ${message.author} reached **Level ${newLevel}**!`).catch(() => {});
    }
  }
});

client.on(Events.GuildMemberRemove, async member => {
  await logAction(member.guild, "👋 Member left", `${member.user.tag} left VeloByte.`, 0x99AAB5);
});

process.on("SIGTERM", async () => {
  await pool.end();
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
