const { SlashCommandBuilder } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");
const play = require("play-dl");

const players = new Map();

function getPlayer(guildId) {
  let data = players.get(guildId);

  if (!data) {
    const player = createAudioPlayer();

    data = {
      player,
      connection: null,
      queue: [],
      current: null,
      playing: false,
    };

    player.on("error", (error) => {
      console.error("[Music Player Error]", error);
      data.playing = false;
    });

    player.on(AudioPlayerStatus.Idle, async () => {
      data.playing = false;

      if (data.queue.length > 0) {
        const next = data.queue.shift();

        try {
          await playTrack(guildId, next.url, next.title);
        } catch (error) {
          console.error("[Music Next Track Error]", error);
        }
      } else {
        data.current = null;
      }
    });

    players.set(guildId, data);
  }

  return data;
}

async function getYouTubeTrack(query) {
  // Direct YouTube URL
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(query)) {
    try {
      const info = await play.video_info(query);

      return {
        url: query,
        title: info.video_details?.title || query,
      };
    } catch (error) {
      console.error("[YouTube URL Error]", error);
      throw new Error("Unable to read this YouTube URL.");
    }
  }

  // Search by song name
  const results = await play.search(query, {
    limit: 1,
    source: { youtube: "video" },
  });

  if (!results || !results.length) {
    throw new Error("No YouTube result found.");
  }

  return {
    url: results[0].url,
    title: results[0].title || query,
  };
}

async function playTrack(guildId, url, title) {
  const data = players.get(guildId);

  if (!data || !data.connection) {
    throw new Error("Voice connection is not available.");
  }

  // Get YouTube stream
  const stream = await play.stream(url, {
    quality: 2,
    discordPlayerCompatibility: true,
  });

  const resource = createAudioResource(stream.stream, {
    inputType: stream.type,
    inlineVolume: false,
  });

  data.current = {
    title,
    url,
  };

  data.playing = true;
  data.player.play(resource);
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName("play")
      .setDescription("Play music from YouTube.")
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription("Song name or YouTube URL")
          .setRequired(true)
      ),

    async execute(interaction) {
      const voiceChannel = interaction.member?.voice?.channel;

      if (!voiceChannel) {
        return interaction.reply({
          content: "❌ Join a voice channel first.",
          ephemeral: true,
        });
      }

      await interaction.deferReply();

      const query = interaction.options.getString("query", true);
      const guildId = interaction.guild.id;
      const data = getPlayer(guildId);

      try {
        // Create voice connection
        if (!data.connection) {
          data.connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId,
            adapterCreator: interaction.guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: false,
          });

          await entersState(
            data.connection,
            VoiceConnectionStatus.Ready,
            15_000
          );

          data.connection.subscribe(data.player);
        } else {
          // Make sure bot is in the same voice channel
          const currentChannelId = data.connection.joinConfig.channelId;

          if (currentChannelId !== voiceChannel.id) {
            return interaction.editReply(
              "❌ I am already playing music in another voice channel."
            );
          }
        }

        const track = await getYouTubeTrack(query);

        // If something is already playing, add to queue
        if (data.playing) {
          data.queue.push(track);

          return interaction.editReply(
            `📀 Added to queue: **${track.title}**\n` +
              `📋 Position: **${data.queue.length}**`
          );
        }

        await playTrack(guildId, track.url, track.title);

        return interaction.editReply(
          `🎵 Now playing: **${track.title}**\n` +
            `🔊 Voice: ${voiceChannel}`
        );
      } catch (error) {
        console.error("[Play Command Error]", error);

        return interaction.editReply(
          "❌ Unable to play this track. YouTube may have blocked the stream. Try another song or YouTube URL."
        );
      }
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("pause")
      .setDescription("Pause music."),

    async execute(interaction) {
      const data = players.get(interaction.guild.id);

      if (!data || !data.playing) {
        return interaction.reply({
          content: "❌ Nothing is playing.",
          ephemeral: true,
        });
      }

      data.player.pause();

      await interaction.reply("⏸️ Music paused.");
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("resume")
      .setDescription("Resume music."),

    async execute(interaction) {
      const data = players.get(interaction.guild.id);

      if (!data) {
        return interaction.reply({
          content: "❌ Nothing is playing.",
          ephemeral: true,
        });
      }

      data.player.unpause();

      await interaction.reply("▶️ Music resumed.");
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("skip")
      .setDescription("Skip current song."),

    async execute(interaction) {
      const data = players.get(interaction.guild.id);

      if (!data || !data.playing) {
        return interaction.reply({
          content: "❌ Nothing is playing.",
          ephemeral: true,
        });
      }

      data.player.stop();

      await interaction.reply("⏭️ Skipped.");
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("queue")
      .setDescription("Show music queue."),

    async execute(interaction) {
      const data = players.get(interaction.guild.id);

      if (!data) {
        return interaction.reply("🎵 Nothing is playing.");
      }

      const lines = [];

      if (data.current) {
        lines.push(`🎵 **Now Playing:** ${data.current.title}`);
      }

      if (data.queue.length) {
        lines.push(
          "",
          "📋 **Queue:**",
          ...data.queue.map(
            (track, index) => `${index + 1}. ${track.title}`
          )
        );
      }

      if (!lines.length) {
        return interaction.reply("🎵 Nothing is playing.");
      }

      await interaction.reply(lines.join("\n"));
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Stop music and leave voice channel."),

    async execute(interaction) {
      const data = players.get(interaction.guild.id);

      if (!data) {
        return interaction.reply({
          content: "❌ Nothing is playing.",
          ephemeral: true,
        });
      }

      data.queue = [];
      data.current = null;
      data.playing = false;

      data.player.stop();

      if (data.connection) {
        data.connection.destroy();
      }

      players.delete(interaction.guild.id);

      await interaction.reply("⏹️ Music stopped and disconnected.");
    },
  },
];  if (/^https?:\/\/.+/i.test(query)) {
    return {
      title: query,
      url: query,
    };
  }

  const results = await play.search(query, {
    limit: 5,
    source: {
      youtube: "video",
    },
  });

  if (!results || results.length === 0) {
    return null;
  }

  const result = results[0];

  return {
    title: result.title || query,
    url: result.url,
    duration: result.durationRaw || "Unknown",
    thumbnail: result.thumbnails?.[0]?.url || null,
  };
}

async function playTrack(guildId, track) {
  const music = guildMusic.get(guildId);

  if (!music) return false;

  try {
    const stream = await play.stream(track.url, {
      discordPlayerCompatibility: true,
    });

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true,
    });

    resource.volume?.setVolume(1.0);

    music.current = track;
    music.playing = true;

    music.player.play(resource);

    return true;
  } catch (error) {
    console.error(
      `[Music] Failed to play "${track.title}":`,
      error
    );

    music.playing = false;
    music.current = null;

    return false;
  }
}

async function playNext(guildId) {
  const music = guildMusic.get(guildId);

  if (!music || music.queue.length === 0) {
    if (music) {
      music.current = null;
      music.playing = false;
    }

    return false;
  }

  const nextTrack = music.queue.shift();

  const success = await playTrack(guildId, nextTrack);

  if (!success) {
    if (music.queue.length > 0) {
      return playNext(guildId);
    }

    return false;
  }

  return true;
}

function formatQueue(music) {
  const lines = [];

  if (music.current) {
    lines.push(
      `🎵 **Now Playing:** ${music.current.title}`
    );
  } else {
    lines.push("🎵 **Now Playing:** Nothing");
  }

  if (music.queue.length > 0) {
    lines.push("");
    lines.push("📜 **Up Next:**");

    music.queue.slice(0, 10).forEach((track, index) => {
      lines.push(
        `\`${index + 1}.\` ${track.title}`
      );
    });

    if (music.queue.length > 10) {
      lines.push(
        `\n...and ${music.queue.length - 10} more`
      );
    }
  } else {
    lines.push("\n📭 Queue is empty.");
  }

  return lines.join("\n");
}

function getMusicOrReply(interaction) {
  const music = guildMusic.get(interaction.guild.id);

  if (!music) {
    interaction.reply({
      content: "🎵 Nothing is playing right now.",
      ephemeral: true,
    });

    return null;
  }

  return music;
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName("play")
      .setDescription("Play music from YouTube or a URL.")
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription("Song name or URL")
          .setRequired(true)
      ),

    async execute(interaction) {
      const query = interaction.options.getString("query", true);

      let music = getGuildMusic(interaction.guild.id);

      try {
        const voiceChannel = await connectToVoice(
          interaction,
          music
        );

        music.textChannel = interaction.channel;

        await interaction.deferReply();

        const track = await resolveQuery(query);

        if (!track) {
          return interaction.editReply(
            "❌ No music found for that search."
          );
        }

        if (music.playing || music.current) {
          music.queue.push(track);

          return interaction.editReply(
            `➕ Added to queue: **${track.title}**\n` +
            `📍 Position: **${music.queue.length}**`
          );
        }

        music.queue.push(track);

        const started = await playNext(interaction.guild.id);

        if (!started) {
          return interaction.editReply(
            "❌ Unable to play this track. Try another song."
          );
        }

        return interaction.editReply(
          `🎵 Now playing **${track.title}** in ${voiceChannel}.`
        );
      } catch (error) {
        console.error("[Music] Play command error:", error);

        if (error.message === "JOIN_VOICE") {
          if (interaction.deferred) {
            return interaction.editReply(
              "❌ Join a voice channel first."
            );
          }

          return interaction.reply({
            content: "❌ Join a voice channel first.",
            ephemeral: true,
          });
        }

        if (error.message === "DIFFERENT_VOICE") {
          if (interaction.deferred) {
            return interaction.editReply(
              "❌ I am already playing music in another voice channel."
            );
          }

          return interaction.reply({
            content:
              "❌ I am already playing music in another voice channel.",
            ephemeral: true,
          });
        }

        if (interaction.deferred) {
          return interaction.editReply(
            "❌ Music playback failed."
          );
        }

        return interaction.reply({
          content: "❌ Music playback failed.",
          ephemeral: true,
        });
      }
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("pause")
      .setDescription("Pause the current music."),

    async execute(interaction) {
      const music = getMusicOrReply(interaction);
      if (!music) return;

      if (music.player.state.status === AudioPlayerStatus.Paused) {
        return interaction.reply({
          content: "⏸️ Music is already paused.",
          ephemeral: true,
        });
      }

      if (!music.current) {
        return interaction.reply({
          content: "❌ Nothing is currently playing.",
          ephemeral: true,
        });
      }

      music.player.pause();

      return interaction.reply("⏸️ Music paused.");
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("resume")
      .setDescription("Resume the paused music."),

    async execute(interaction) {
      const music = getMusicOrReply(interaction);
      if (!music) return;

      if (!music.current) {
        return interaction.reply({
          content: "❌ Nothing is currently playing.",
          ephemeral: true,
        });
      }

      if (
        music.player.state.status !==
        AudioPlayerStatus.Paused
      ) {
        return interaction.reply({
          content: "▶️ Music is already playing.",
          ephemeral: true,
        });
      }

      music.player.unpause();

      return interaction.reply("▶️ Music resumed.");
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("skip")
      .setDescription("Skip the current song."),

    async execute(interaction) {
      const music = getMusicOrReply(interaction);
      if (!music) return;

      if (!music.current) {
        return interaction.reply({
          content: "❌ Nothing is currently playing.",
          ephemeral: true,
        });
      }

      const skipped = music.current.title;

      music.playing = false;
      music.player.stop(true);

      const started = await playNext(interaction.guild.id);

      if (started) {
        return interaction.reply(
          `⏭️ Skipped **${skipped}**.\n🎵 Now playing **${music.current.title}**`
        );
      }

      return interaction.reply(
        `⏭️ Skipped **${skipped}**.\n📭 Queue is empty.`
      );
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("queue")
      .setDescription("Show the current music queue."),

    async execute(interaction) {
      const music = guildMusic.get(interaction.guild.id);

      if (!music) {
        return interaction.reply(
          "📭 Music queue is empty."
        );
      }

      return interaction.reply(
        formatQueue(music)
      );
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Stop music and leave the voice channel."),

    async execute(interaction) {
      const music = guildMusic.get(interaction.guild.id);

      if (!music) {
        return interaction.reply({
          content: "❌ Nothing is playing.",
          ephemeral: true,
        });
      }

      music.queue.length = 0;
      music.current = null;
      music.playing = false;

      try {
        music.player.stop(true);
      } catch {}

      try {
        music.connection?.destroy();
      } catch {}

      guildMusic.delete(interaction.guild.id);

      return interaction.reply(
        "⏹️ Music stopped and I left the voice channel."
      );
    },
  },
];

module.exports = commands;
