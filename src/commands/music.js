// src/commands/music.js

const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");

const { spawn } = require("child_process");

// ==================================================
// MUSIC PLAYERS
// ==================================================

const players = new Map();

// ==================================================
// GET / CREATE GUILD PLAYER
// ==================================================

function getGuildPlayer(guildId) {
  let data = players.get(guildId);

  if (data) {
    return data;
  }

  const player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Play,
    },
  });

  data = {
    player,
    connection: null,

    queue: [],
    current: null,

    currentProcess: null,

    playing: false,
    paused: false,
    stopping: false,

    textChannel: null,
  };

  players.set(guildId, data);

  // ----------------------------------------------
  // PLAYER ERROR
  // ----------------------------------------------

  player.on("error", (error) => {
    console.error("[Music] Audio Player Error:", error);

    const currentData = players.get(guildId);

    if (!currentData) {
      return;
    }

    if (currentData.currentProcess) {
      try {
        currentData.currentProcess.kill("SIGKILL");
      } catch {}

      currentData.currentProcess = null;
    }

    currentData.playing = false;
    currentData.paused = false;

    if (
      currentData.queue.length > 0 &&
      !currentData.stopping
    ) {
      playNext(guildId).catch((err) => {
        console.error(
          "[Music] Failed to play next:",
          err
        );
      });
    }
  });

  // ----------------------------------------------
  // SONG FINISHED
  // ----------------------------------------------

  player.on(
    AudioPlayerStatus.Idle,
    async () => {
      const currentData = players.get(guildId);

      if (!currentData) {
        return;
      }

      if (currentData.stopping) {
        return;
      }

      const finishedSong =
        currentData.current?.title || "Unknown";

      console.log(
        `[Music] Finished: ${finishedSong}`
      );

      if (currentData.currentProcess) {
        try {
          currentData.currentProcess.kill(
            "SIGKILL"
          );
        } catch {}

        currentData.currentProcess = null;
      }

      currentData.current = null;
      currentData.playing = false;
      currentData.paused = false;

      // ------------------------------------------
      // PLAY NEXT FROM QUEUE
      // ------------------------------------------

      if (currentData.queue.length > 0) {
        await playNext(guildId);
      }
    }
  );

  return data;
}

// ==================================================
// CLEANUP GUILD
// ==================================================

function cleanupGuild(guildId) {
  const data = players.get(guildId);

  if (!data) {
    return;
  }

  data.stopping = true;

  // Stop yt-dlp
  if (data.currentProcess) {
    try {
      data.currentProcess.kill("SIGKILL");
    } catch {}

    data.currentProcess = null;
  }

  // Stop player
  try {
    data.player.stop(true);
  } catch {}

  // Disconnect voice
  try {
    if (data.connection) {
      data.connection.destroy();
    }
  } catch {}

  data.queue = [];
  data.current = null;
  data.playing = false;
  data.paused = false;

  players.delete(guildId);

  console.log(
    `[Music] Cleaned up guild: ${guildId}`
  );
}

// ==================================================
// GET YOUTUBE INFORMATION
// ==================================================

function getYoutubeInfo(query) {
  return new Promise((resolve, reject) => {
    const args = [
      "--js-runtimes",
      "node",

      "--remote-components",
      "ejs:github",

      "--dump-single-json",
      "--no-playlist",
      "--skip-download",

      "--quiet",
      "--no-warnings",

      query,
    ];

    console.log(
      `[Music] Searching YouTube: ${query}`
    );

    const process = spawn(
      "yt-dlp",
      args,
      {
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      }
    );

    let output = "";
    let errorOutput = "";

    process.stdout.on("data", (data) => {
      output += data.toString();
    });

    process.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    process.on("error", (error) => {
      reject(error);
    });

    process.on("close", (code) => {
      if (code !== 0) {
        console.error(
          "[yt-dlp info error]",
          errorOutput
        );

        return reject(
          new Error("YTDLP_FAILED")
        );
      }

      if (!output.trim()) {
        return reject(
          new Error("NO_OUTPUT")
        );
      }

      try {
        const info = JSON.parse(output);

        resolve(info);
      } catch (error) {
        console.error(
          "[Music] JSON parse error:",
          error
        );

        console.error(
          "[Music] yt-dlp output:",
          output
        );

        reject(error);
      }
    });
  });
}

// ==================================================
// RESOLVE TRACK
// ==================================================

async function resolveTrack(query) {
  const cleanQuery = query.trim();

  if (!cleanQuery) {
    throw new Error("EMPTY_QUERY");
  }

  let searchQuery;

  // ----------------------------------------------
  // DIRECT YOUTUBE URL
  // ----------------------------------------------

  if (
    /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(
      cleanQuery
    )
  ) {
    searchQuery = cleanQuery;
  } else {
    // --------------------------------------------
    // YOUTUBE SEARCH
    // --------------------------------------------

    searchQuery = `ytsearch1:${cleanQuery}`;
  }

  const info = await getYoutubeInfo(
    searchQuery
  );

  if (!info) {
    throw new Error("NO_RESULT");
  }

  let video = info;

  // ytsearch result
  if (Array.isArray(info.entries)) {
    video = info.entries.find(
      (entry) =>
        entry &&
        entry.webpage_url
    );
  }

  if (
    !video ||
    !video.webpage_url
  ) {
    throw new Error("NO_RESULT");
  }

  return {
    title:
      video.title ||
      "Unknown Song",

    url:
      video.webpage_url,

    duration:
      video.duration_string ||
      "Unknown",

    thumbnail:
      video.thumbnail ||
      (
        Array.isArray(video.thumbnails) &&
        video.thumbnails.length
          ? video.thumbnails[
              video.thumbnails.length - 1
            ].url
          : null
      ),
  };
}

// ==================================================
// CONNECT TO VOICE
// ==================================================

async function connectToVoice(
  interaction,
  data
) {
  const voiceChannel =
    interaction.member.voice.channel;

  if (!voiceChannel) {
    throw new Error("NOT_IN_VOICE");
  }

  // ----------------------------------------------
  // Already connected
  // ----------------------------------------------

  if (data.connection) {
    const currentChannelId =
      data.connection.joinConfig.channelId;

    if (
      currentChannelId !==
      voiceChannel.id
    ) {
      throw new Error(
        "DIFFERENT_VOICE"
      );
    }

    return data.connection;
  }

  // ----------------------------------------------
  // Join voice channel
  // ----------------------------------------------

  const connection =
    joinVoiceChannel({
      channelId:
        voiceChannel.id,

      guildId:
        interaction.guild.id,

      adapterCreator:
        interaction.guild
          .voiceAdapterCreator,

      selfDeaf: true,
      selfMute: false,
    });

  try {
    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      20000
    );
  } catch (error) {
    try {
      connection.destroy();
    } catch {}

    throw error;
  }

  data.connection = connection;

  connection.subscribe(
    data.player
  );

  // ----------------------------------------------
  // Connection disconnect
  // ----------------------------------------------

  connection.on(
    VoiceConnectionStatus.Disconnected,
    () => {
      console.log(
        `[Music] Voice disconnected: ${interaction.guild.id}`
      );
    }
  );

  return connection;
}

// ==================================================
// PLAY TRACK
// ==================================================

async function playTrack(
  guildId,
  track
) {
  const data =
    players.get(guildId);

  if (!data) {
    throw new Error(
      "PLAYER_NOT_FOUND"
    );
  }

  if (!data.connection) {
    throw new Error(
      "VOICE_NOT_CONNECTED"
    );
  }

  // ----------------------------------------------
  // Stop previous yt-dlp
  // ----------------------------------------------

  if (data.currentProcess) {
    try {
      data.currentProcess.kill(
        "SIGKILL"
      );
    } catch {}

    data.currentProcess = null;
  }

  data.current = track;
  data.playing = true;
  data.paused = false;
  data.stopping = false;

  console.log(
    `[Music] Starting: ${track.title}`
  );

  // ----------------------------------------------
  // START YT-DLP
  // ----------------------------------------------

  const ytdlp =
    spawn(
      "yt-dlp",
      [
        "--js-runtimes",
        "node",

        "--remote-components",
        "ejs:github",

        "--no-playlist",
        "--no-warnings",

        // Prefer Opus for Discord
        "-f",
        "bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio",

        "-o",
        "-",

        track.url,
      ],
      {
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      }
    );

  data.currentProcess =
    ytdlp;

  let ytdlpError = "";

  // ----------------------------------------------
  // STDERR
  // ----------------------------------------------

  ytdlp.stderr.on(
    "data",
    (chunk) => {
      const message =
        chunk.toString().trim();

      if (message) {
        ytdlpError +=
          message + "\n";

        console.log(
          `[yt-dlp] ${message}`
        );
      }
    }
  );

  // ----------------------------------------------
  // PROCESS ERROR
  // ----------------------------------------------

  ytdlp.on(
    "error",
    (error) => {
      console.error(
        "[Music] yt-dlp process error:",
        error
      );

      if (
        data.currentProcess ===
        ytdlp
      ) {
        data.currentProcess =
          null;
      }

      data.playing = false;
      data.paused = false;

      if (
        data.queue.length > 0 &&
        !data.stopping
      ) {
        playNext(guildId).catch(
          (err) => {
            console.error(
              "[Music] Next track error:",
              err
            );
          }
        );
      }
    }
  );

  // ----------------------------------------------
  // PROCESS CLOSE
  // ----------------------------------------------

  ytdlp.on(
    "close",
    (code) => {
      console.log(
        `[yt-dlp] Process exited with code ${code}`
      );

      if (
        code !== 0 &&
        ytdlpError
      ) {
        console.error(
          "[yt-dlp]",
          ytdlpError
        );
      }

      if (
        data.currentProcess ===
        ytdlp
      ) {
        data.currentProcess =
          null;
      }
    }
  );

  // ----------------------------------------------
  // AUDIO RESOURCE
  // ----------------------------------------------

  const resource =
    createAudioResource(
      ytdlp.stdout,
      {
        inputType:
          StreamType.WebmOpus,

        inlineVolume: true,
      }
    );

  if (resource.volume) {
    resource.volume.setVolume(1.0);
  }

  // ----------------------------------------------
  // PLAY
  // ----------------------------------------------

  data.player.play(
    resource
  );

  console.log(
    `[Music] Playing: ${track.title}`
  );

  return track;
}

// ==================================================
// PLAY NEXT
// ==================================================

async function playNext(
  guildId
) {
  const data =
    players.get(guildId);

  if (
    !data ||
    data.stopping
  ) {
    return false;
  }

  if (
    data.playing
  ) {
    return false;
  }

  if (
    data.queue.length === 0
  ) {
    data.current = null;
    data.playing = false;
    data.paused = false;

    return false;
  }

  const nextTrack =
    data.queue.shift();

  try {
    await playTrack(
      guildId,
      nextTrack
    );

    if (data.textChannel) {
      try {
        await data.textChannel.send(
          `🎵 Now playing: **${nextTrack.title}**`
        );
      } catch {}
    }

    return true;
  } catch (error) {
    console.error(
      "[Music] Failed to play next:",
      error
    );

    data.current = null;
    data.playing = false;
    data.paused = false;

    if (
      data.queue.length > 0
    ) {
      return playNext(
        guildId
      );
    }

    return false;
  }
}

// ==================================================
// /PLAY
// ==================================================

const playCommand = {
  data:
    new SlashCommandBuilder()
      .setName("play")
      .setDescription(
        "Play a song from YouTube"
      )
      .addStringOption(
        (option) =>
          option
            .setName("query")
            .setDescription(
              "Song name or YouTube URL"
            )
            .setRequired(true)
      ),

  async execute(
    interaction
  ) {
    await interaction.deferReply();

    const query =
      interaction.options.getString(
        "query",
        true
      );

    const guildId =
      interaction.guild.id;

    const voiceChannel =
      interaction.member.voice.channel;

    // ----------------------------------------------
    // Voice check
    // ----------------------------------------------

    if (!voiceChannel) {
      return interaction.editReply(
        "❌ Join a voice channel first."
      );
    }

    const data =
      getGuildPlayer(guildId);

    data.textChannel =
      interaction.channel;

    try {
      // --------------------------------------------
      // Connect voice
      // --------------------------------------------

      await connectToVoice(
        interaction,
        data
      );

      // --------------------------------------------
      // Resolve YouTube track
      // --------------------------------------------

      const track =
        await resolveTrack(
          query
        );

      console.log(
        `[Music] Selected: ${track.title}`
      );

      console.log(
        `[Music] URL: ${track.url}`
      );

      // --------------------------------------------
      // Already playing → queue
      // --------------------------------------------

      if (
        data.playing ||
        data.current
      ) {
        data.queue.push(
          track
        );

        const embed =
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(
              "🎵 Added to Queue"
            )
            .setDescription(
              `**${track.title}**`
            )
            .addFields(
              {
                name:
                  "Position",
                value:
                  `${data.queue.length}`,
                inline: true,
              },
              {
                name:
                  "Duration",
                value:
                  track.duration ||
                  "Unknown",
                inline: true,
              }
            )
            .setFooter({
              text:
                "VeloByte Music • YouTube",
            });

        if (
          track.thumbnail
        ) {
          embed.setThumbnail(
            track.thumbnail
          );
        }

        return interaction.editReply(
          {
            embeds: [embed],
          }
        );
      }

      // --------------------------------------------
      // Nothing playing
      // --------------------------------------------

      await playTrack(
        guildId,
        track
      );

      const embed =
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(
            "🎵 VeloByte Music"
          )
          .setDescription(
            `▶️ **${track.title}**`
          )
          .addFields(
            {
              name:
                "Requested by",
              value:
                `${interaction.user}`,
              inline: true,
            },
            {
              name:
                "Duration",
              value:
                track.duration ||
                "Unknown",
              inline: true,
            },
            {
              name:
                "Voice Channel",
              value:
                `${voiceChannel}`,
              inline: true,
            }
          )
          .setFooter({
            text:
              "VeloByte Music • YouTube",
          });

      if (
        track.thumbnail
      ) {
        embed.setThumbnail(
          track.thumbnail
        );
      }

      return interaction.editReply(
        {
          embeds: [embed],
        }
      );
    } catch (error) {
      console.error(
        "[Music /play Error]",
        error
      );

      if (
        error.message ===
        "NOT_IN_VOICE"
      ) {
        return interaction.editReply(
          "❌ Join a voice channel first."
        );
      }

      if (
        error.message ===
        "DIFFERENT_VOICE"
      ) {
        return interaction.editReply(
          "❌ I am already playing music in another voice channel."
        );
      }

      if (
        error.message ===
          "NO_RESULT" ||
        error.message ===
          "YTDLP_FAILED"
      ) {
        return interaction.editReply(
          "❌ No YouTube song found for that search."
        );
      }

      if (
        error.message ===
        "EMPTY_QUERY"
      ) {
        return interaction.editReply(
          "❌ Please enter a song name or YouTube URL."
        );
      }

      return interaction.editReply(
        "❌ Unable to play this track. Check the YouTube URL or try another song."
      );
    }
  },
};

// ==================================================
// /PAUSE
// ==================================================

const pauseCommand = {
  data:
    new SlashCommandBuilder()
      .setName("pause")
      .setDescription(
        "Pause the current song."
      ),

  async execute(
    interaction
  ) {
    const data =
      players.get(
        interaction.guild.id
      );

    if (
      !data ||
      !data.current
    ) {
      return interaction.reply(
        {
          content:
            "❌ Nothing is currently playing.",
          ephemeral: true,
        }
      );
    }

    if (data.paused) {
      return interaction.reply(
        {
          content:
            "⏸️ Music is already paused.",
          ephemeral: true,
        }
      );
    }

    data.player.pause();
    data.paused = true;

    return interaction.reply(
      "⏸️ Music paused."
    );
  },
};

// ==================================================
// /RESUME
// ==================================================

const resumeCommand = {
  data:
    new SlashCommandBuilder()
      .setName("resume")
      .setDescription(
        "Resume the current song."
      ),

  async execute(
    interaction
  ) {
    const data =
      players.get(
        interaction.guild.id
      );

    if (
      !data ||
      !data.current
    ) {
      return interaction.reply(
        {
          content:
            "❌ Nothing is currently playing.",
          ephemeral: true,
        }
      );
    }

    if (!data.paused) {
      return interaction.reply(
        {
          content:
            "▶️ Music is already playing.",
          ephemeral: true,
        }
      );
    }

    data.player.unpause();
    data.paused = false;

    return interaction.reply(
      "▶️ Music resumed."
    );
  },
};

// ==================================================
// /SKIP
// ==================================================

const skipCommand = {
  data:
    new SlashCommandBuilder()
      .setName("skip")
      .setDescription(
        "Skip the current song."
      ),

  async execute(
    interaction
  ) {
    const guildId =
      interaction.guild.id;

    const data =
      players.get(guildId);

    if (
      !data ||
      !data.current
    ) {
      return interaction.reply(
        {
          content:
            "❌ Nothing is currently playing.",
          ephemeral: true,
        }
      );
    }

    const skipped =
      data.current.title;

    console.log(
      `[Music] Skipping: ${skipped}`
    );

    // ----------------------------------------------
    // Stop current process
    // ----------------------------------------------

    if (
      data.currentProcess
    ) {
      try {
        data.currentProcess.kill(
          "SIGKILL"
        );
      } catch {}

      data.currentProcess =
        null;
    }

    // ----------------------------------------------
    // Reset current state
    // ----------------------------------------------

    data.current = null;
    data.playing = false;
    data.paused = false;

    // ----------------------------------------------
    // Stop audio
    // ----------------------------------------------

    try {
      data.player.stop(true);
    } catch {}

    // ----------------------------------------------
    // Play next
    // ----------------------------------------------

    if (
      data.queue.length > 0
    ) {
      const next =
        data.queue.shift();

      try {
        await playTrack(
          guildId,
          next
        );

        return interaction.reply(
          `⏭️ Skipped **${skipped}**\n🎵 Now playing **${next.title}**`
        );
      } catch (error) {
        console.error(
          "[Music Skip Error]",
          error
        );

        return interaction.reply(
          `⏭️ Skipped **${skipped}**\n❌ Could not play the next song.`
        );
      }
    }

    return interaction.reply(
      `⏭️ Skipped **${skipped}**\n📭 Queue is empty.`
    );
  },
};

// ==================================================
// /QUEUE
// ==================================================

const queueCommand = {
  data:
    new SlashCommandBuilder()
      .setName("queue")
      .setDescription(
        "Show the music queue."
      ),

  async execute(
    interaction
  ) {
    const data =
      players.get(
        interaction.guild.id
      );

    if (!data) {
      return interaction.reply(
        "📭 Music queue is empty."
      );
    }

    const lines = [];

    // ----------------------------------------------
    // Current song
    // ----------------------------------------------

    if (data.current) {
      lines.push(
        `🎵 **Now Playing:** ${data.current.title}`
      );
    } else {
      lines.push(
        "🎵 **Now Playing:** Nothing"
      );
    }

    // ----------------------------------------------
    // Queue
    // ----------------------------------------------

    if (
      data.queue.length > 0
    ) {
      lines.push("");
      lines.push(
        "📋 **Up Next:**"
      );

      data.queue
        .slice(0, 10)
        .forEach(
          (track, index) => {
            lines.push(
              `\`${index + 1}.\` ${track.title}`
            );
          }
        );

      if (
        data.queue.length > 10
      ) {
        lines.push(
          `\n...and ${
            data.queue.length - 10
          } more`
        );
      }
    } else {
      lines.push("");
      lines.push(
        "📭 Queue is empty."
      );
    }

    return interaction.reply(
      lines.join("\n")
    );
  },
};

// ==================================================
// /STOP
// ==================================================

const stopCommand = {
  data:
    new SlashCommandBuilder()
      .setName("stop")
      .setDescription(
        "Stop music and leave the voice channel."
      ),

  async execute(
    interaction
  ) {
    const guildId =
      interaction.guild.id;

    const data =
      players.get(guildId);

    if (!data) {
      return interaction.reply(
        {
          content:
            "❌ Nothing is playing.",
          ephemeral: true,
        }
      );
    }

    cleanupGuild(
      guildId
    );

    return interaction.reply(
      "⏹️ Music stopped and I left the voice channel."
    );
  },
};

// ==================================================
// EXPORT ALL MUSIC COMMANDS
// ==================================================

module.exports = [
  playCommand,
  pauseCommand,
  resumeCommand,
  skipCommand,
  queueCommand,
  stopCommand,
];
