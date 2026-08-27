const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

// ============================================================
// ADMIN ONLY MODERATION
// ============================================================

const ADMIN = PermissionFlagsBits.Administrator;

function adminOnly(builder) {
  return builder
    .setDefaultMemberPermissions(ADMIN.bitfield)
    .setDMPermission(false);
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(ADMIN);
}

function deny(interaction) {
  return interaction.reply({
    content: "❌ You need Administrator permission to use this command.",
    ephemeral: true,
  });
}

// ============================================================
// PROTECTED ROLES
// ============================================================

function getProtectedRoleIds() {
  return (process.env.PROTECTED_ROLE_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function isProtectedRole(roleId) {
  return getProtectedRoleIds().includes(roleId);
}

// ============================================================
// TARGET CHECK
// ============================================================

function canModerateMember(interaction, member) {
  if (!member) return false;

  // Server owner cannot be moderated
  if (member.id === interaction.guild.ownerId) return false;

  // Protected roles cannot be moderated
  const protectedIds = getProtectedRoleIds();

  if (
    member.roles.cache.some((role) =>
      protectedIds.includes(role.id)
    )
  ) {
    return false;
  }

  // Bot must be above target
  if (
    interaction.guild.members.me &&
    member.roles.highest.position >=
      interaction.guild.members.me.roles.highest.position
  ) {
    return false;
  }

  return true;
}

// ============================================================
// MODULE
// ============================================================

module.exports = [

  // ==========================================================
  // WARN
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("warn")
        .setDescription("Warn a member.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Target member")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Reason")
            .setRequired(true)
        )
    ),

    async execute(i, { db, logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user = i.options.getUser("user");
      const reason = i.options.getString("reason");

      const member = await i.guild.members
        .fetch(user.id)
        .catch(() => null);

      if (!canModerateMember(i, member)) {
        return i.reply({
          content:
            "❌ I cannot moderate this member. They may be protected or higher than my role.",
          ephemeral: true,
        });
      }

      await db(
        `INSERT INTO users(guild_id,user_id,warnings)
         VALUES($1,$2,1)
         ON CONFLICT(guild_id,user_id)
         DO UPDATE SET warnings=users.warnings+1`,
        [i.guild.id, member.id]
      );

      await db(
        `INSERT INTO moderation_cases
         (guild_id,user_id,moderator_id,action,reason)
         VALUES($1,$2,$3,'warn',$4)`,
        [i.guild.id, member.id, i.user.id, reason]
      );

      await logAction(
        i.guild,
        "⚠️ Warning",
        `${member} was warned by ${i.user}.\nReason: ${reason}`,
        0xFEE75C
      );

      await i.reply(
        `⚠️ ${member.user.tag} has been warned.`
      );
    },
  },

  // ==========================================================
  // WARNINGS
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("warnings")
        .setDescription("View a member's warning history.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Target member")
            .setRequired(true)
        )
    ),

    async execute(i, { db }) {
      if (!isAdmin(i)) return deny(i);

      const user = i.options.getUser("user");

      const result = await db(
        `SELECT id, reason, moderator_id, created_at
         FROM moderation_cases
         WHERE guild_id=$1
         AND user_id=$2
         AND action='warn'
         ORDER BY created_at DESC
         LIMIT 20`,
        [i.guild.id, user.id]
      );

      if (!result.rows.length) {
        return i.reply(
          `ℹ️ ${user.tag} has no warnings.`
        );
      }

      const text = result.rows
        .map(
          (row, index) =>
            `**${index + 1}.** ${row.reason || "No reason"}\n` +
            `Case #${row.id} • <@${row.moderator_id}> • ` +
            `<t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R>`
        )
        .join("\n\n");

      await i.reply({
        content: `⚠️ **Warnings for ${user.tag}**\n\n${text}`,
        ephemeral: true,
      });
    },
  },

  // ==========================================================
  // UNWARN
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("unwarn")
        .setDescription("Remove a warning from a member.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Target member")
            .setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName("case")
            .setDescription("Warning case ID")
            .setRequired(true)
        )
    ),

    async execute(i, { db, logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user = i.options.getUser("user");
      const caseId = i.options.getInteger("case");

      const result = await db(
        `DELETE FROM moderation_cases
         WHERE id=$1
         AND guild_id=$2
         AND user_id=$3
         AND action='warn'
         RETURNING id`,
        [caseId, i.guild.id, user.id]
      );

      if (!result.rows.length) {
        return i.reply({
          content: "❌ Warning case not found.",
          ephemeral: true,
        });
      }

      await db(
        `UPDATE users
         SET warnings=GREATEST(warnings-1,0)
         WHERE guild_id=$1 AND user_id=$2`,
        [i.guild.id, user.id]
      );

      await logAction(
        i.guild,
        "✅ Warning removed",
        `Warning #${caseId} was removed from ${user} by ${i.user}.`,
        0x57F287
      );

      await i.reply(
        `✅ Warning #${caseId} removed from ${user.tag}.`
      );
    },
  },

  // ==========================================================
  // TIMEOUT
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("timeout")
        .setDescription("Timeout a member.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Target member")
            .setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName("minutes")
            .setDescription("Timeout duration in minutes")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10080)
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Reason")
            .setRequired(true)
        )
    ),

    async execute(i, { db, logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user = i.options.getUser("user");
      const minutes = i.options.getInteger("minutes");
      const reason = i.options.getString("reason");

      const member = await i.guild.members
        .fetch(user.id)
        .catch(() => null);

      if (!canModerateMember(i, member) || !member.moderatable) {
        return i.reply({
          content: "❌ I cannot timeout this member.",
          ephemeral: true,
        });
      }

      await member.timeout(
        minutes * 60 * 1000,
        reason
      );

      await db(
        `INSERT INTO moderation_cases
         (guild_id,user_id,moderator_id,action,reason,duration_seconds)
         VALUES($1,$2,$3,'timeout',$4,$5)`,
        [
          i.guild.id,
          member.id,
          i.user.id,
          reason,
          minutes * 60,
        ]
      );

      await logAction(
        i.guild,
        "⏳ Timeout",
        `${member} timed out for ${minutes} minute(s).\nReason: ${reason}`,
        0xFEE75C
      );

      await i.reply(
        `⏳ ${member.user.tag} timed out for ${minutes} minute(s).`
      );
    },
  },

  // ==========================================================
  // UNTIMEOUT
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("untimeout")
        .setDescription("Remove a member's timeout.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Target member")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Reason")
            .setRequired(false)
        )
    ),

    async execute(i, { logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user = i.options.getUser("user");
      const reason =
        i.options.getString("reason") || "Timeout removed";

      const member = await i.guild.members
        .fetch(user.id)
        .catch(() => null);

      if (!canModerateMember(i, member) || !member.moderatable) {
        return i.reply({
          content: "❌ I cannot remove this member's timeout.",
          ephemeral: true,
        });
      }

      await member.timeout(null, reason);

      await logAction(
        i.guild,
        "✅ Timeout removed",
        `${member} timeout was removed by ${i.user}.\nReason: ${reason}`,
        0x57F287
      );

      await i.reply(
        `✅ Timeout removed from ${member.user.tag}.`
      );
    },
  },

  // ==========================================================
  // KICK
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Kick a member.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Target member")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Reason")
            .setRequired(true)
        )
    ),

    async execute(i, { db, logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user = i.options.getUser("user");
      const reason = i.options.getString("reason");

      const member = await i.guild.members
        .fetch(user.id)
        .catch(() => null);

      if (!canModerateMember(i, member) || !member.kickable) {
        return i.reply({
          content: "❌ I cannot kick this member.",
          ephemeral: true,
        });
      }

      await member.kick(reason);

      await db(
        `INSERT INTO moderation_cases
         (guild_id,user_id,moderator_id,action,reason)
         VALUES($1,$2,$3,'kick',$4)`,
        [i.guild.id, member.id, i.user.id, reason]
      );

      await logAction(
        i.guild,
        "👢 Kick",
        `${member.user.tag} kicked by ${i.user}.\nReason: ${reason}`,
        0xED4245
      );

      await i.reply(
        `👢 ${member.user.tag} was kicked.`
      );
    },
  },

  // ==========================================================
  // BAN
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Ban a member.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Target member")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Reason")
            .setRequired(true)
        )
    ),

    async execute(i, { db, logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user = i.options.getUser("user");
      const reason = i.options.getString("reason");

      const member = await i.guild.members
        .fetch(user.id)
        .catch(() => null);

      if (!member) {
        return i.reply({
          content: "❌ Member not found.",
          ephemeral: true,
        });
      }

      if (!canModerateMember(i, member) || !member.bannable) {
        return i.reply({
          content: "❌ I cannot ban this member.",
          ephemeral: true,
        });
      }

      await member.ban({ reason });

      await db(
        `INSERT INTO moderation_cases
         (guild_id,user_id,moderator_id,action,reason)
         VALUES($1,$2,$3,'ban',$4)`,
        [i.guild.id, member.id, i.user.id, reason]
      );

      await logAction(
        i.guild,
        "🔨 Ban",
        `${member.user.tag} banned by ${i.user}.\nReason: ${reason}`,
        0xED4245
      );

      await i.reply(
        `🔨 ${member.user.tag} was banned.`
      );
    },
  },

  // ==========================================================
  // UNBAN
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("unban")
        .setDescription("Unban a user.")
        .addStringOption((o) =>
          o
            .setName("userid")
            .setDescription("Discord User ID")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Reason")
            .setRequired(false)
        )
    ),

    async execute(i, { logAction }) {
      if (!isAdmin(i)) return deny(i);

      const userId = i.options.getString("userid");
      const reason =
        i.options.getString("reason") || "Unbanned by administrator";

      try {
        await i.guild.members.unban(
          userId,
          reason
        );
      } catch (error) {
        return i.reply({
          content: "❌ User is not banned or the ID is invalid.",
          ephemeral: true,
        });
      }

      await logAction(
        i.guild,
        "✅ Unban",
        `<@${userId}> was unbanned by ${i.user}.\nReason: ${reason}`,
        0x57F287
      );

      await i.reply(
        `✅ User **${userId}** has been unbanned.`
      );
    },
  },

  // ==========================================================
  // SOFTBAN
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("softban")
        .setDescription("Ban and immediately unban a member.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Target member")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Reason")
            .setRequired(true)
        )
    ),

    async execute(i, { db, logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user = i.options.getUser("user");
      const reason = i.options.getString("reason");

      const member = await i.guild.members
        .fetch(user.id)
        .catch(() => null);

      if (!canModerateMember(i, member) || !member.bannable) {
        return i.reply({
          content: "❌ I cannot softban this member.",
          ephemeral: true,
        });
      }

      await member.ban({
        deleteMessageSeconds: 604800,
        reason,
      });

      await i.guild.members.unban(
        user.id,
        "Softban completed"
      );

      await db(
        `INSERT INTO moderation_cases
         (guild_id,user_id,moderator_id,action,reason)
         VALUES($1,$2,$3,'softban',$4)`,
        [i.guild.id, user.id, i.user.id, reason]
      );

      await logAction(
        i.guild,
        "🔨 Softban",
        `${user.tag} softbanned by ${i.user}.\nReason: ${reason}`,
        0xED4245
      );

      await i.reply(
        `🔨 ${user.tag} was softbanned.`
      );
    },
  },

  // ==========================================================
  // CLEAR
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("clear")
        .setDescription("Delete messages.")
        .addIntegerOption((o) =>
          o
            .setName("amount")
            .setDescription("1-100")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
    ),

    async execute(i, { logAction }) {
      if (!isAdmin(i)) return deny(i);

      const amount = i.options.getInteger("amount");

      if (
        !i.channel ||
        !i.channel.isTextBased() ||
        !i.channel.bulkDelete
      ) {
        return i.reply({
          content: "❌ This command is not supported here.",
          ephemeral: true,
        });
      }

      await i.deferReply({
        ephemeral: true,
      });

      const deleted = await i.channel.bulkDelete(
        amount,
        true
      );

      await logAction(
        i.guild,
        "🧹 Messages cleared",
        `${i.user} deleted ${deleted.size} message(s) in ${i.channel}.`
      );

      await i.editReply(
        `🧹 Deleted ${deleted.size} message(s).`
      );
    },
  },

  // ==========================================================
  // PURGE USER
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("purge")
        .setDescription("Delete recent messages from a specific user.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Target user")
            .setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName("amount")
            .setDescription("Messages to check, 1-100")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
    ),

    async execute(i, { logAction }) {
      if (!isAdmin(i)) return deny(i);

      if (
        !i.channel ||
        !i.channel.isTextBased()
      ) {
        return i.reply({
          content: "❌ This command is not supported here.",
          ephemeral: true,
        });
      }

      const user = i.options.getUser("user");
      const amount = i.options.getInteger("amount");

      await i.deferReply({
        ephemeral: true,
      });

      const messages = await i.channel.messages.fetch({
        limit: 100,
      });

      const targets = messages.filter(
        (message) =>
          message.author.id === user.id
      ).first(amount);

      if (!targets.length) {
        return i.editReply(
          `ℹ️ No recent messages from ${user.tag} found.`
        );
      }

      let deleted = 0;

      for (const message of targets) {
        await message.delete().catch(() => {});
        deleted++;
      }

      await logAction(
        i.guild,
        "🧹 User purge",
        `${i.user} deleted ${deleted} message(s) from ${user} in ${i.channel}.`
      );

      await i.editReply(
        `🧹 Deleted ${deleted} message(s) from ${user.tag}.`
      );
    },
  },

  // ==========================================================
  // LOCK
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("lock")
        .setDescription("Lock the current channel.")
    ),

    async execute(i, { logAction }) {
      if (!isAdmin(i)) return deny(i);

      if (
        !i.channel ||
        !i.channel.permissionOverwrites
      ) {
        return i.reply({
          content: "❌ Cannot lock this channel.",
          ephemeral: true,
        });
      }

      await i.channel.permissionOverwrites.edit(
        i.guild.roles.everyone,
        {
          SendMessages: false,
        },
        {
          reason: `Channel locked by ${i.user.tag}`,
        }
      );

      await logAction(
        i.guild,
        "🔒 Channel locked",
        `${i.channel} was locked by ${i.user}.`
      );

      await i.reply(
        "🔒 This channel has been locked."
      );
    },
  },

  // ==========================================================
  // UNLOCK
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("unlock")
        .setDescription("Unlock the current channel.")
    ),

    async execute(i, { logAction }) {
      if (!isAdmin(i)) return deny(i);

      if (
        !i.channel ||
        !i.channel.permissionOverwrites
      ) {
        return i.reply({
          content: "❌ Cannot unlock this channel.",
          ephemeral: true,
        });
      }

      await i.channel.permissionOverwrites.edit(
        i.guild.roles.everyone,
        {
          SendMessages: null,
        },
        {
          reason: `Channel unlocked by ${i.user.tag}`,
        }
      );

      await logAction(
        i.guild,
        "🔓 Channel unlocked",
        `${i.channel} was unlocked by ${i.user}.`
      );

      await i.reply(
        "🔓 This channel has been unlocked."
      );
    },
  },

  // ==========================================================
  // SLOWMODE
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("slowmode")
        .setDescription("Set channel slowmode.")
        .addIntegerOption((o) =>
          o
            .setName("seconds")
            .setDescription("0-21600 seconds")
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(21600)
        )
    ),

    async execute(i, { logAction }) {
      if (!isAdmin(i)) return deny(i);

      if (
        !i.channel ||
        !("setRateLimitPerUser" in i.channel)
      ) {
        return i.reply({
          content: "❌ Slowmode is not supported here.",
          ephemeral: true,
        });
      }

      const seconds =
        i.options.getInteger("seconds");

      await i.channel.setRateLimitPerUser(
        seconds,
        `Slowmode changed by ${i.user.tag}`
      );

      await logAction(
        i.guild,
        "🐢 Slowmode",
        `${i.user} set slowmode in ${i.channel} to ${seconds}s.`
      );

      await i.reply(
        seconds === 0
          ? "🐢 Slowmode disabled."
          : `🐢 Slowmode set to **${seconds} seconds**.`
      );
    },
  },

  // ==========================================================
  // NICK
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("nick")
        .setDescription("Change a member's nickname.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Target member")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("nickname")
            .setDescription("New nickname")
            .setRequired(true)
            .setMaxLength(32)
        )
    ),

    async execute(i, { logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user = i.options.getUser("user");

      const nickname =
        i.options.getString("nickname");

      const member = await i.guild.members
        .fetch(user.id)
        .catch(() => null);

      if (!canModerateMember(i, member) || !member.manageable) {
        return i.reply({
          content: "❌ I cannot change this member's nickname.",
          ephemeral: true,
        });
      }

      await member.setNickname(
        nickname,
        `Nickname changed by ${i.user.tag}`
      );

      await logAction(
        i.guild,
        "🏷️ Nickname changed",
        `${user} nickname changed to **${nickname}** by ${i.user}.`
      );

      await i.reply(
        `🏷️ Nickname changed for ${user.tag}.`
      );
    },
  },

  // ==========================================================
  // ROLE ADD
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("role-add")
        .setDescription("Add a role to a member.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Target member")
            .setRequired(true)
        )
        .addRoleOption((o) =>
          o
            .setName("role")
            .setDescription("Role to add")
            .setRequired(true)
        )
    ),

    async execute(i, { logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user = i.options.getUser("user");
      const role = i.options.getRole("role");

      if (isProtectedRole(role.id)) {
        return i.reply({
          content: "❌ This role is protected.",
          ephemeral: true,
        });
      }

      if (role.managed) {
        return i.reply({
          content: "❌ Managed/integration roles cannot be assigned.",
          ephemeral: true,
        });
      }

      const botMember = i.guild.members.me;

      if (
        botMember &&
        role.position >= botMember.roles.highest.position
      ) {
        return i.reply({
          content: "❌ I cannot assign a role higher than my highest role.",
          ephemeral: true,
        });
      }

      const member = await i.guild.members
        .fetch(user.id)
        .catch(() => null);

      if (!member) {
        return i.reply({
          content: "❌ Member not found.",
          ephemeral: true,
        });
      }

      await member.roles.add(
        role,
        `Role added by ${i.user.tag}`
      );

      await logAction(
        i.guild,
        "➕ Role added",
        `${role} added to ${user} by ${i.user}.`
      );

      await i.reply(
        `✅ Added ${role} to ${user.tag}.`
      );
    },
  },

  // ==========================================================
  // ROLE REMOVE
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("role-remove")
        .setDescription("Remove a role from a member.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Target member")
            .setRequired(true)
        )
        .addRoleOption((o) =>
          o
            .setName("role")
            .setDescription("Role to remove")
            .setRequired(true)
        )
    ),

    async execute(i, { logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user = i.options.getUser("user");
      const role = i.options.getRole("role");

      if (isProtectedRole(role.id)) {
        return i.reply({
          content: "❌ This role is protected.",
          ephemeral: true,
        });
      }

      if (role.managed) {
        return i.reply({
          content: "❌ Managed/integration roles cannot be removed.",
          ephemeral: true,
        });
      }

      const botMember = i.guild.members.me;

      if (
        botMember &&
        role.position >= botMember.roles.highest.position
      ) {
        return i.reply({
          content: "❌ I cannot remove a role higher than my highest role.",
          ephemeral: true,
        });
      }

      const member = await i.guild.members
        .fetch(user.id)
        .catch(() => null);

      if (!member) {
        return i.reply({
          content: "❌ Member not found.",
          ephemeral: true,
        });
      }

      await member.roles.remove(
        role,
        `Role removed by ${i.user.tag}`
      );

      await logAction(
        i.guild,
        "➖ Role removed",
        `${role} removed from ${user} by ${i.user}.`
      );

      await i.reply(
        `✅ Removed ${role} from ${user.tag}.`
      );
    },
  },

  // ==========================================================
  // SAY
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("say")
        .setDescription("Send a message as the bot.")
        .addStringOption((o) =>
          o
            .setName("message")
            .setDescription("Message to send")
            .setRequired(true)
            .setMaxLength(2000)
        )
    ),

    async execute(i) {
      if (!isAdmin(i)) return deny(i);

      if (
        !i.channel ||
        !i.channel.isTextBased()
      ) {
        return i.reply({
          content: "❌ This command can only be used in a text channel.",
          ephemeral: true,
        });
      }

      const message =
        i.options.getString("message");

      await i.channel.send({
        content: message,

        // Prevent @everyone / @here / mass role mentions
        allowedMentions: {
          parse: [],
        },
      });

      await i.reply({
        content: "✅ Message sent.",
        ephemeral: true,
      });
    },
  },
];
