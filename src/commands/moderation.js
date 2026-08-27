const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const ADMIN = PermissionFlagsBits.Administrator;

// ============================================================
// ADMIN ONLY
// ============================================================

function adminOnly(builder) {
  return builder
    .setDefaultMemberPermissions(ADMIN)
    .setDMPermission(false);
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(ADMIN);
}

async function deny(interaction) {
  return interaction.reply({
    content:
      "❌ You need Administrator permission to use this command.",
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
// PROTECTED MEMBER
// ============================================================

function isProtectedMember(member) {
  if (!member) return false;

  // Server owner can never be moderated
  if (member.id === member.guild.ownerId) {
    return true;
  }

  // Protected roles
  return member.roles.cache.some((role) =>
    isProtectedRole(role.id)
  );
}

// ============================================================
// BOT HIERARCHY
// ============================================================

function botMember(interaction) {
  return interaction.guild.members.me;
}

function canModerate(interaction, member) {
  const bot = botMember(interaction);

  if (!bot) {
    return {
      ok: false,
      message:
        "❌ I could not find my server member information.",
    };
  }

  if (member.id === interaction.guild.ownerId) {
    return {
      ok: false,
      message:
        "❌ I cannot moderate the server owner.",
    };
  }

  if (member.id === bot.id) {
    return {
      ok: false,
      message:
        "❌ I cannot moderate myself.",
    };
  }

  if (
    member.roles.highest.position >=
    bot.roles.highest.position
  ) {
    return {
      ok: false,
      message:
        "❌ I cannot moderate this member because their highest role is equal to or higher than my highest role.",
    };
  }

  if (isProtectedMember(member)) {
    return {
      ok: false,
      message:
        "❌ This member is protected and cannot be moderated.",
    };
  }

  return {
    ok: true,
  };
}

// ============================================================
// FETCH MEMBER
// ============================================================

async function getMember(interaction, user) {
  return interaction.guild.members
    .fetch(user.id)
    .catch(() => null);
}

// ============================================================
// LOG
// ============================================================

async function safeLog(
  logAction,
  guild,
  title,
  description,
  color
) {
  if (typeof logAction !== "function") return;

  await logAction(
    guild,
    title,
    description,
    color
  ).catch(() => {});
}

// ============================================================
// CASE DATABASE
// ============================================================

async function createCase(
  db,
  interaction,
  target,
  action,
  reason,
  durationSeconds = null
) {
  if (typeof db !== "function") return;

  await db(
    `INSERT INTO moderation_cases
     (
       guild_id,
       user_id,
       moderator_id,
       action,
       reason,
       duration_seconds
     )
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      interaction.guild.id,
      target.id,
      interaction.user.id,
      action,
      reason || null,
      durationSeconds,
    ]
  ).catch((error) => {
    console.error(
      "❌ Failed to create moderation case:",
      error
    );
  });
}

// ============================================================
// COMMANDS
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
            .setDescription("Member to warn")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Reason for the warning")
            .setRequired(true)
            .setMaxLength(500)
        )
    ),

    async execute(i, { db, logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user = i.options.getUser("user");
      const reason =
        i.options.getString("reason");

      const member =
        await getMember(i, user);

      if (!member) {
        return i.reply({
          content: "❌ Member not found.",
          ephemeral: true,
        });
      }

      const check =
        canModerate(i, member);

      if (!check.ok) {
        return i.reply({
          content: check.message,
          ephemeral: true,
        });
      }

      await db(
        `INSERT INTO users
         (guild_id,user_id,warnings)
         VALUES($1,$2,1)
         ON CONFLICT (guild_id,user_id)
         DO UPDATE SET warnings = users.warnings + 1`,
        [
          i.guild.id,
          user.id,
        ]
      );

      await createCase(
        db,
        i,
        user,
        "warn",
        reason
      );

      await safeLog(
        logAction,
        i.guild,
        "⚠️ Member warned",
        `${user} was warned by ${i.user}.\n**Reason:** ${reason}`,
        0xfee75c
      );

      await i.reply(
        `⚠️ **${user.tag}** has been warned.\n**Reason:** ${reason}`
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
        .setDescription("View a member's warnings.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Member")
            .setRequired(true)
        )
    ),

    async execute(i, { db }) {
      if (!isAdmin(i)) return deny(i);

      const user =
        i.options.getUser("user");

      const result =
        await db(
          `SELECT warnings
           FROM users
           WHERE guild_id=$1
           AND user_id=$2`,
          [
            i.guild.id,
            user.id,
          ]
        );

      const warnings =
        result.rows[0]?.warnings || 0;

      return i.reply(
        `⚠️ **${user.tag}** has **${warnings}** warning(s).`
      );
    },
  },

  // ==========================================================
  // UNWARN
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("unwarn")
        .setDescription("Remove one warning from a member.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Member")
            .setRequired(true)
        )
    ),

    async execute(i, { db, logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user =
        i.options.getUser("user");

      await db(
        `UPDATE users
         SET warnings = GREATEST(warnings - 1, 0)
         WHERE guild_id=$1
         AND user_id=$2`,
        [
          i.guild.id,
          user.id,
        ]
      );

      await safeLog(
        logAction,
        i.guild,
        "✅ Warning removed",
        `One warning was removed from ${user} by ${i.user}.`,
        0x57f287
      );

      return i.reply(
        `✅ Removed one warning from **${user.tag}**.`
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
            .setDescription("Member")
            .setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName("minutes")
            .setDescription("Timeout duration in minutes")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(40320)
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Reason")
            .setRequired(false)
            .setMaxLength(500)
        )
    ),

    async execute(i, { db, logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user =
        i.options.getUser("user");

      const minutes =
        i.options.getInteger("minutes");

      const reason =
        i.options.getString("reason") ||
        "No reason provided";

      const member =
        await getMember(i, user);

      if (!member) {
        return i.reply({
          content: "❌ Member not found.",
          ephemeral: true,
        });
      }

      const check =
        canModerate(i, member);

      if (!check.ok) {
        return i.reply({
          content: check.message,
          ephemeral: true,
        });
      }

      if (!member.moderatable) {
        return i.reply({
          content:
            "❌ I don't have permission to timeout this member.",
          ephemeral: true,
        });
      }

      await member.timeout(
        minutes * 60 * 1000,
        reason
      );

      await createCase(
        db,
        i,
        user,
        "timeout",
        reason,
        minutes * 60
      );

      await safeLog(
        logAction,
        i.guild,
        "⏱️ Member timed out",
        `${user} was timed out by ${i.user} for **${minutes} minute(s)**.\n**Reason:** ${reason}`,
        0xfee75c
      );

      return i.reply(
        `⏱️ **${user.tag}** has been timed out for **${minutes} minute(s)**.`
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
            .setDescription("Member")
            .setRequired(true)
        )
    ),

    async execute(i, { db, logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user =
        i.options.getUser("user");

      const member =
        await getMember(i, user);

      if (!member) {
        return i.reply({
          content: "❌ Member not found.",
          ephemeral: true,
        });
      }

      const check =
        canModerate(i, member);

      if (!check.ok) {
        return i.reply({
          content: check.message,
          ephemeral: true,
        });
      }

      if (!member.moderatable) {
        return i.reply({
          content:
            "❌ I cannot remove this member's timeout.",
          ephemeral: true,
        });
      }

      await member.timeout(
        null,
        `Timeout removed by ${i.user.tag}`
      );

      await createCase(
        db,
        i,
        user,
        "untimeout",
        "Timeout removed"
      );

      await safeLog(
        logAction,
        i.guild,
        "✅ Timeout removed",
        `${user} had their timeout removed by ${i.user}.`,
        0x57f287
      );

      return i.reply(
        `✅ Timeout removed from **${user.tag}**.`
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
            .setDescription("Member to kick")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Reason")
            .setRequired(false)
            .setMaxLength(500)
        )
    ),

    async execute(i, { db, logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user =
        i.options.getUser("user");

      const reason =
        i.options.getString("reason") ||
        "No reason provided";

      const member =
        await getMember(i, user);

      if (!member) {
        return i.reply({
          content: "❌ Member not found.",
          ephemeral: true,
        });
      }

      const check =
        canModerate(i, member);

      if (!check.ok) {
        return i.reply({
          content: check.message,
          ephemeral: true,
        });
      }

      if (!member.kickable) {
        return i.reply({
          content:
            "❌ I don't have permission to kick this member.",
          ephemeral: true,
        });
      }

      await member.kick(reason);

      await createCase(
        db,
        i,
        user,
        "kick",
        reason
      );

      await safeLog(
        logAction,
        i.guild,
        "👢 Member kicked",
        `${user.tag} was kicked by ${i.user}.\n**Reason:** ${reason}`,
        0xed4245
      );

      return i.reply(
        `👢 **${user.tag}** has been kicked.`
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
            .setDescription("Member to ban")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Reason")
            .setRequired(false)
            .setMaxLength(500)
        )
    ),

    async execute(i, { db, logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user =
        i.options.getUser("user");

      const reason =
        i.options.getString("reason") ||
        "No reason provided";

      const member =
        await getMember(i, user);

      if (member) {
        const check =
          canModerate(i, member);

        if (!check.ok) {
          return i.reply({
            content: check.message,
            ephemeral: true,
          });
        }

        if (!member.bannable) {
          return i.reply({
            content:
              "❌ I don't have permission to ban this member.",
            ephemeral: true,
          });
        }
      }

      await i.guild.members.ban(
        user.id,
        {
          reason,
          deleteMessageSeconds: 0,
        }
      );

      await createCase(
        db,
        i,
        user,
        "ban",
        reason
      );

      await safeLog(
        logAction,
        i.guild,
        "🔨 Member banned",
        `${user.tag} was banned by ${i.user}.\n**Reason:** ${reason}`,
        0xed4245
      );

      return i.reply(
        `🔨 **${user.tag}** has been banned.`
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
            .setName("user_id")
            .setDescription("User ID")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Reason")
            .setRequired(false)
        )
    ),

    async execute(i, { db, logAction }) {
      if (!isAdmin(i)) return deny(i);

      const userId =
        i.options.getString("user_id");

      const reason =
        i.options.getString("reason") ||
        "No reason provided";

      if (!/^\d{17,20}$/.test(userId)) {
        return i.reply({
          content:
            "❌ Invalid Discord user ID.",
          ephemeral: true,
        });
      }

      try {
        await i.guild.members.unban(
          userId,
          reason
        );
      } catch (error) {
        return i.reply({
          content:
            "❌ User is not banned or could not be unbanned.",
          ephemeral: true,
        });
      }

      await createCase(
        db,
        i,
        { id: userId },
        "unban",
        reason
      );

      await safeLog(
        logAction,
        i.guild,
        "🔓 User unbanned",
        `User ID **${userId}** was unbanned by ${i.user}.\n**Reason:** ${reason}`,
        0x57f287
      );

      return i.reply(
        `🔓 User **${userId}** has been unbanned.`
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
            .setDescription("Member")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("reason")
            .setDescription("Reason")
            .setRequired(false)
        )
    ),

    async execute(i, { db, logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user =
        i.options.getUser("user");

      const reason =
        i.options.getString("reason") ||
        "No reason provided";

      const member =
        await getMember(i, user);

      if (!member) {
        return i.reply({
          content: "❌ Member not found.",
          ephemeral: true,
        });
      }

      const check =
        canModerate(i, member);

      if (!check.ok) {
        return i.reply({
          content: check.message,
          ephemeral: true,
        });
      }

      if (!member.bannable) {
        return i.reply({
          content:
            "❌ I cannot ban this member.",
          ephemeral: true,
        });
      }

      await i.guild.members.ban(
        user.id,
        {
          reason,
          deleteMessageSeconds: 3600,
        }
      );

      await i.guild.members.unban(
        user.id,
        "Softban"
      );

      await createCase(
        db,
        i,
        user,
        "softban",
        reason
      );

      await safeLog(
        logAction,
        i.guild,
        "🧹 Softban",
        `${user.tag} was softbanned by ${i.user}.\n**Reason:** ${reason}`,
        0xed4245
      );

      return i.reply(
        `🧹 **${user.tag}** has been softbanned.`
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
            .setDescription("Number of messages")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
    ),

    async execute(i, { logAction }) {
      if (!isAdmin(i)) return deny(i);

      if (
        !i.channel ||
        !i.channel.isTextBased() ||
        !("bulkDelete" in i.channel)
      ) {
        return i.reply({
          content:
            "❌ This command cannot be used here.",
          ephemeral: true,
        });
      }

      const amount =
        i.options.getInteger("amount");

      await i.deferReply({
        ephemeral: true,
      });

      const deleted =
        await i.channel.bulkDelete(
          amount,
          true
        );

      await safeLog(
        logAction,
        i.guild,
        "🧹 Messages cleared",
        `${i.user} deleted **${deleted.size}** message(s) in ${i.channel}.`,
        0x5865f2
      );

      return i.editReply(
        `🧹 Deleted **${deleted.size}** message(s).`
      );
    },
  },

  // ==========================================================
  // PURGE
  // ==========================================================

  {
    data: adminOnly(
      new SlashCommandBuilder()
        .setName("purge")
        .setDescription("Delete messages.")
        .addIntegerOption((o) =>
          o
            .setName("amount")
            .setDescription("Number of messages")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
    ),

    async execute(i, context) {
      const command =
        context?.client?.commands?.get(
          "clear"
        );

      if (!isAdmin(i)) return deny(i);

      if (
        !i.channel ||
        !i.channel.isTextBased() ||
        !("bulkDelete" in i.channel)
      ) {
        return i.reply({
          content:
            "❌ This command cannot be used here.",
          ephemeral: true,
        });
      }

      const amount =
        i.options.getInteger("amount");

      await i.deferReply({
        ephemeral: true,
      });

      const deleted =
        await i.channel.bulkDelete(
          amount,
          true
        );

      return i.editReply(
        `🧹 Purged **${deleted.size}** message(s).`
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

      const channel = i.channel;

      if (
        !channel ||
        !channel.isTextBased()
      ) {
        return i.reply({
          content:
            "❌ This command cannot be used here.",
          ephemeral: true,
        });
      }

      const everyone =
        i.guild.roles.everyone;

      await channel.permissionOverwrites.edit(
        everyone,
        {
          SendMessages: false,
        }
      );

      await safeLog(
        logAction,
        i.guild,
        "🔒 Channel locked",
        `${channel} was locked by ${i.user}.`,
        0xed4245
      );

      return i.reply(
        "🔒 Channel locked."
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

      const channel = i.channel;

      if (
        !channel ||
        !channel.isTextBased()
      ) {
        return i.reply({
          content:
            "❌ This command cannot be used here.",
          ephemeral: true,
        });
      }

      const everyone =
        i.guild.roles.everyone;

      await channel.permissionOverwrites.edit(
        everyone,
        {
          SendMessages: null,
        }
      );

      await safeLog(
        logAction,
        i.guild,
        "🔓 Channel unlocked",
        `${channel} was unlocked by ${i.user}.`,
        0x57f287
      );

      return i.reply(
        "🔓 Channel unlocked."
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
            .setDescription("Slowmode seconds")
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(21600)
        )
    ),

    async execute(i, { logAction }) {
      if (!isAdmin(i)) return deny(i);

      const channel = i.channel;

      if (
        !channel ||
        !channel.isTextBased() ||
        !("setRateLimitPerUser" in channel)
      ) {
        return i.reply({
          content:
            "❌ Slowmode is not supported in this channel.",
          ephemeral: true,
        });
      }

      const seconds =
        i.options.getInteger("seconds");

      await channel.setRateLimitPerUser(
        seconds,
        `Slowmode changed by ${i.user.tag}`
      );

      await safeLog(
        logAction,
        i.guild,
        "🐢 Slowmode changed",
        `${i.user} set slowmode in ${channel} to **${seconds}s**.`,
        0x5865f2
      );

      return i.reply(
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
            .setDescription("Member")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("nickname")
            .setDescription("New nickname")
            .setRequired(false)
            .setMaxLength(32)
        )
    ),

    async execute(i, { logAction }) {
      if (!isAdmin(i)) return deny(i);

      const user =
        i.options.getUser("user");

      const nickname =
        i.options.getString("nickname");

      const member =
        await getMember(i, user);

      if (!member) {
        return i.reply({
          content: "❌ Member not found.",
          ephemeral: true,
        });
      }

      const check =
        canModerate(i, member);

      if (!check.ok) {
        return i.reply({
          content: check.message,
          ephemeral: true,
        });
      }

      if (!member.manageable) {
        return i.reply({
          content:
            "❌ I cannot change this member's nickname.",
          ephemeral: true,
        });
      }

      await member.setNickname(
        nickname || null,
        `Nickname changed by ${i.user.tag}`
      );

      await safeLog(
        logAction,
        i.guild,
        "✏️ Nickname changed",
        `${user} nickname was changed by ${i.user}.`,
        0x5865f2
      );

      return i.reply(
        nickname
          ? `✏️ Nickname changed to **${nickname}**.`
          : "✏️ Nickname reset."
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

      const user =
        i.options.getUser("user");

      const role =
        i.options.getRole("role");

      const member =
        await getMember(i, user);

      if (!member) {
        return i.reply({
          content: "❌ Member not found.",
          ephemeral: true,
        });
      }

      if (isProtectedRole(role.id)) {
        return i.reply({
          content:
            "❌ This role is protected.",
          ephemeral: true,
        });
      }

      if (role.managed) {
        return i.reply({
          content:
            "❌ Managed/integration roles cannot be assigned.",
          ephemeral: true,
        });
      }

      const bot =
        botMember(i);

      if (!bot) {
        return i.reply({
          content:
            "❌ Bot member not found.",
          ephemeral: true,
        });
      }

      if (
        role.position >=
        bot.roles.highest.position
      ) {
        return i.reply({
          content:
            "❌ I cannot assign a role equal to or higher than my highest role.",
          ephemeral: true,
        });
      }

      if (
        member.roles.highest.position >=
        bot.roles.highest.position
      ) {
        return i.reply({
          content:
            "❌ I cannot manage this member's roles.",
          ephemeral: true,
        });
      }

      await member.roles.add(
        role,
        `Role added by ${i.user.tag}`
      );

      await safeLog(
        logAction,
        i.guild,
        "➕ Role added",
        `${role} added to ${user} by ${i.user}.`,
        0x57f287
      );

      return i.reply(
        `✅ Added ${role} to **${user.tag}**.`
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

      const user =
        i.options.getUser("user");

      const role =
        i.options.getRole("role");

      const member =
        await getMember(i, user);

      if (!member) {
        return i.reply({
          content: "❌ Member not found.",
          ephemeral: true,
        });
      }

      if (isProtectedRole(role.id)) {
        return i.reply({
          content:
            "❌ This role is protected.",
          ephemeral: true,
        });
      }

      if (role.managed) {
        return i.reply({
          content:
            "❌ Managed/integration roles cannot be removed.",
          ephemeral: true,
        });
      }

      const bot =
        botMember(i);

      if (!bot) {
        return i.reply({
          content:
            "❌ Bot member not found.",
          ephemeral: true,
        });
      }

      if (
        role.position >=
        bot.roles.highest.position
      ) {
        return i.reply({
          content:
            "❌ I cannot remove a role equal to or higher than my highest role.",
          ephemeral: true,
        });
      }

      await member.roles.remove(
        role,
        `Role removed by ${i.user.tag}`
      );

      await safeLog(
        logAction,
        i.guild,
        "➖ Role removed",
        `${role} removed from ${user} by ${i.user}.`,
        0xed4245
      );

      return i.reply(
        `✅ Removed ${role} from **${user.tag}**.`
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
          content:
            "❌ This command can only be used in a text channel.",
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

      return i.reply({
        content:
          "✅ Message sent.",
        ephemeral: true,
      });
    },
  },
];
