// src/commands/music.js

const {
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  entersState
} = require("@discordjs/voice");

const { spawn } = require("child_process");

const players = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song from YouTube")
    .addStringOption(option =>
      option
        .setName("query")
        .setDescription("YouTube song name or YouTube URL")
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const query = interaction.options.getString("query")?.trim();
    const guildId = interaction.guild.id;
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
      return interaction.editReply(
        "❌ Join a voice channel first."
      );
    }

    if (!query) {
      return interaction.editReply(
        "❌ Please enter a song name or YouTube URL."
      );
    }

    let connection = null;
    let ytdlp = null;

    try {
      /*
       * ---------------------------------------------
       * SEARCH / URL
       * ---------------------------------------------
       */

      let searchQuery = query;

      // If user enters a song name, search YouTube
      if (!/^https?:\/\//i.test(searchQuery)) {
        searchQuery = `ytsearch1:${searchQuery}`;
      }

      /*
       * ---------------------------------------------
       * GET YOUTUBE INFORMATION
       * ---------------------------------------------
       */

      const info = await getYoutubeInfo(searchQuery);

      if (!info) {
        return interaction.editReply(
          "❌ Unable to find this song on YouTube."
        );
      }

      /*
       * ytsearch can sometimes return a playlist/search
       * wrapper. Get the first actual video.
       */

      let video = info;

      if (
        info._type === "playlist" &&
        Array.isArray(info.entries)
      ) {
        video = info.entries.find(entry => entry);

        if (!video) {
          return interaction.editReply(
            "❌ No playable YouTube video found."
          );
        }
      }

      const videoUrl =
        video.webpage_url ||
        video.original_url ||
        video.url;

      if (!videoUrl) {
        return interaction.editReply(
          "❌ Unable to get the YouTube video URL."
        );
      }

      const title =
        video.title ||
        "Unknown Song";

      const thumbnail =
        video.thumbnail || null;

      /*
       * ---------------------------------------------
       * VOICE CONNECTION
       * ---------------------------------------------
       */

      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator:
          voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: true
      });

      await entersState(
        connection,
        VoiceConnectionStatus.Ready,
        15_000
      );

      /*
       * ---------------------------------------------
       * PLAYER
       * ---------------------------------------------
       */

      let playerData = players.get(guildId);

      if (!playerData) {
        const player = createAudioPlayer({
          behaviors: {
            noSubscriber:
              NoSubscriberBehavior.Play
          }
        });

        playerData = {
          player,
          connection,
          ytdlp: null
        };

        players.set(guildId, playerData);

        connection.subscribe(player);

        player.on(
          "error",
          error => {
            console.error(
              "[Music] Audio Player Error:",
              error
            );

            cleanupPlayer(guildId);
          }
        );
      } else {
        /*
         * Stop previous yt-dlp process
         */
        if (playerData.ytdlp) {
          try {
            playerData.ytdlp.kill("SIGKILL");
          } catch {}
        }

        try {
          playerData.player.stop();
        } catch {}

        if (
          playerData.connection &&
          playerData.connection !== connection
        ) {
          try {
            playerData.connection.destroy();
          } catch {}
        }

        playerData.connection = connection;

        connection.subscribe(
          playerData.player
        );
      }

      /*
       * ---------------------------------------------
       * START YT-DLP
       * ---------------------------------------------
       *
       * Node 24 is already inside your Docker image.
       *
       * --js-runtimes node
       * enables Node for YouTube JS challenges.
       *
       * --remote-components ejs:github
       * allows yt-dlp to fetch EJS challenge
       * solver components when required.
       */

      ytdlp = spawn(
        "yt-dlp",
        [
          "--js-runtimes",
          "node",
          "--remote-components",
          "ejs:github",

          "--no-playlist",

          "-f",
          "bestaudio/best",

          "-o",
          "-",

          "--quiet",
          "--no-warnings",

          videoUrl
        ],
        {
          stdio: [
            "ignore",
            "pipe",
            "pipe"
          ]
        }
      );

      playerData.ytdlp = ytdlp;

      let ytdlpError = "";

      ytdlp.stderr.on(
        "data",
        data => {
          const message =
            data.toString();

          ytdlpError += message;

          console.log(
            `[yt-dlp] ${message.trim()}`
          );
        }
      );

      ytdlp.on(
        "error",
        error => {
          console.error(
            "[Music] yt-dlp process error:",
            error
          );
        }
      );

      /*
       * ---------------------------------------------
       * AUDIO RESOURCE
       * ---------------------------------------------
       */

      const resource =
        createAudioResource(
          ytdlp.stdout,
          {
            inputType:
              StreamType.WebmOpus
          }
        );

      /*
       * ---------------------------------------------
       * PLAY
       * ---------------------------------------------
       */

      playerData.player.play(
        resource
      );

      /*
       * ---------------------------------------------
       * PLAYING EVENT
       * ---------------------------------------------
       */

      const playingHandler = () => {
        console.log(
          `▶️ Playing: ${title}`
        );
      };

      playerData.player.once(
        AudioPlayerStatus.Playing,
        playingHandler
      );

      /*
       * ---------------------------------------------
       * IDLE EVENT
       * ---------------------------------------------
       */

      const idleHandler = () => {
        try {
          if (ytdlp) {
            ytdlp.kill("SIGKILL");
          }
        } catch {}

        cleanupPlayer(guildId);
      };

      playerData.player.once(
        AudioPlayerStatus.Idle,
        idleHandler
      );

      /*
       * ---------------------------------------------
       * YT-DLP EXIT
       * ---------------------------------------------
       */

      ytdlp.on(
        "close",
        code => {
          console.log(
            `[yt-dlp] Process exited with code ${code}`
          );

          if (
            code !== 0 &&
            ytdlpError
          ) {
            console.error(
              "[yt-dlp] Error:",
              ytdlpError
            );
          }
        }
      );

      /*
       * ---------------------------------------------
       * EMBED
       * ---------------------------------------------
       */

      const embed =
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(
            "🎵 VeloByte Music"
          )
          .setDescription(
            `▶️ **${title}**`
          )
          .addFields(
            {
              name: "Requested by",
              value:
                `${interaction.user}`,
              inline: true
            },
            {
              name: "Voice Channel",
              value:
                `${voiceChannel}`,
              inline: true
            }
          )
          .setFooter({
            text:
              "VeloByte Music • YouTube"
          });

      if (thumbnail) {
        embed.setThumbnail(
          thumbnail
        );
      }

      return interaction.editReply({
        embeds: [embed]
      });

    } catch (error) {
      console.error(
        "[Music] Music Error:",
        error
      );

      /*
       * Cleanup
       */

      if (ytdlp) {
        try {
          ytdlp.kill("SIGKILL");
        } catch {}
      }

      if (connection) {
        try {
          connection.destroy();
        } catch {}
      }

      players.delete(guildId);

      /*
       * User-friendly error
       */

      return interaction.editReply(
        "❌ Unable to play this track. Check the YouTube URL or try another song."
      );
    }
  }
};


/*
 * ==================================================
 * GET YOUTUBE INFORMATION
 * ==================================================
 */

function getYoutubeInfo(query) {
  return new Promise(
    (resolve, reject) => {

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

        query
      ];

      const process =
        spawn(
          "yt-dlp",
          args,
          {
            stdio: [
              "ignore",
              "pipe",
              "pipe"
            ]
          }
        );

      let output = "";
      let errorOutput = "";

      process.stdout.on(
        "data",
        data => {
          output +=
            data.toString();
        }
      );

      process.stderr.on(
        "data",
        data => {
          errorOutput +=
            data.toString();
        }
      );

      process.on(
        "close",
        code => {

          if (code !== 0) {
            console.error(
              "[yt-dlp info]",
              errorOutput
            );

            return reject(
              new Error(
                "yt-dlp failed"
              )
            );
          }

          try {
            const info =
              JSON.parse(output);

            resolve(info);

          } catch (error) {
            console.error(
              "JSON parse error:",
              error
            );

            console.error(
              "yt-dlp output:",
              output
            );

            reject(error);
          }
        }
      );

      process.on(
        "error",
        error => {
          reject(error);
        }
      );
    }
  );
}


/*
 * ==================================================
 * CLEANUP PLAYER
 * ==================================================
 */

function cleanupPlayer(guildId) {
  const data =
    players.get(guildId);

  if (!data) {
    return;
  }

  try {
    if (data.ytdlp) {
      data.ytdlp.kill(
        "SIGKILL"
      );
    }
  } catch {}

  try {
    if (data.connection) {
      data.connection.destroy();
    }
  } catch {}

  players.delete(guildId);
}      await entersState(
        connection,
        VoiceConnectionStatus.Ready,
        15_000
      );

      /*
       * ---------------------------------------------
       * PLAYER
       * ---------------------------------------------
       */

      let playerData = players.get(guildId);

      if (!playerData) {
        const player = createAudioPlayer({
          behaviors: {
            noSubscriber:
              NoSubscriberBehavior.Play
          }
        });

        playerData = {
          player,
          connection,
          ytdlp: null
        };

        players.set(guildId, playerData);

        connection.subscribe(player);

        player.on(
          "error",
          error => {
            console.error(
              "[Music] Audio Player Error:",
              error
            );

            cleanupPlayer(guildId);
          }
        );
      } else {
        /*
         * Stop previous yt-dlp process
         */
        if (playerData.ytdlp) {
          try {
            playerData.ytdlp.kill("SIGKILL");
          } catch {}
        }

        try {
          playerData.player.stop();
        } catch {}

        if (
          playerData.connection &&
          playerData.connection !== connection
        ) {
          try {
            playerData.connection.destroy();
          } catch {}
        }

        playerData.connection = connection;

        connection.subscribe(
          playerData.player
        );
      }

      /*
       * ---------------------------------------------
       * START YT-DLP
       * ---------------------------------------------
       *
       * Node 24 is already inside your Docker image.
       *
       * --js-runtimes node
       * enables Node for YouTube JS challenges.
       *
       * --remote-components ejs:github
       * allows yt-dlp to fetch EJS challenge
       * solver components when required.
       */

      ytdlp = spawn(
        "yt-dlp",
        [
          "--js-runtimes",
          "node",
          "--remote-components",
          "ejs:github",

          "--no-playlist",

          "-f",
          "bestaudio/best",

          "-o",
          "-",

          "--quiet",
          "--no-warnings",

          videoUrl
        ],
        {
          stdio: [
            "ignore",
            "pipe",
            "pipe"
          ]
        }
      );

      playerData.ytdlp = ytdlp;

      let ytdlpError = "";

      ytdlp.stderr.on(
        "data",
        data => {
          const message =
            data.toString();

          ytdlpError += message;

          console.log(
            `[yt-dlp] ${message.trim()}`
          );
        }
      );

      ytdlp.on(
        "error",
        error => {
          console.error(
            "[Music] yt-dlp process error:",
            error
          );
        }
      );

      /*
       * ---------------------------------------------
       * AUDIO RESOURCE
       * ---------------------------------------------
       */

      const resource =
        createAudioResource(
          ytdlp.stdout,
          {
            inputType:
              StreamType.WebmOpus
          }
        );

      /*
       * ---------------------------------------------
       * PLAY
       * ---------------------------------------------
       */

      playerData.player.play(
        resource
      );

      /*
       * ---------------------------------------------
       * PLAYING EVENT
       * ---------------------------------------------
       */

      const playingHandler = () => {
        console.log(
          `▶️ Playing: ${title}`
        );
      };

      playerData.player.once(
        AudioPlayerStatus.Playing,
        playingHandler
      );

      /*
       * ---------------------------------------------
       * IDLE EVENT
       * ---------------------------------------------
       */

      const idleHandler = () => {
        try {
          if (ytdlp) {
            ytdlp.kill("SIGKILL");
          }
        } catch {}

        cleanupPlayer(guildId);
      };

      playerData.player.once(
        AudioPlayerStatus.Idle,
        idleHandler
      );

      /*
       * ---------------------------------------------
       * YT-DLP EXIT
       * ---------------------------------------------
       */

      ytdlp.on(
        "close",
        code => {
          console.log(
            `[yt-dlp] Process exited with code ${code}`
          );

          if (
            code !== 0 &&
            ytdlpError
          ) {
            console.error(
              "[yt-dlp] Error:",
              ytdlpError
            );
          }
        }
      );

      /*
       * ---------------------------------------------
       * EMBED
       * ---------------------------------------------
       */

      const embed =
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(
            "🎵 VeloByte Music"
          )
          .setDescription(
            `▶️ **${title}**`
          )
          .addFields(
            {
              name: "Requested by",
              value:
                `${interaction.user}`,
              inline: true
            },
            {
              name: "Voice Channel",
              value:
                `${voiceChannel}`,
              inline: true
            }
          )
          .setFooter({
            text:
              "VeloByte Music • YouTube"
          });

      if (thumbnail) {
        embed.setThumbnail(
          thumbnail
        );
      }

      return interaction.editReply({
        embeds: [embed]
      });

    } catch (error) {
      console.error(
        "[Music] Music Error:",
        error
      );

      /*
       * Cleanup
       */

      if (ytdlp) {
        try {
          ytdlp.kill("SIGKILL");
        } catch {}
      }

      if (connection) {
        try {
          connection.destroy();
        } catch {}
      }

      players.delete(guildId);

      /*
       * User-friendly error
       */

      return interaction.editReply(
        "❌ Unable to play this track. Check the YouTube URL or try another song."
      );
    }
  }
};


/*
 * ==================================================
 * GET YOUTUBE INFORMATION
 * ==================================================
 */

function getYoutubeInfo(query) {
  return new Promise(
    (resolve, reject) => {

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

        query
      ];

      const process =
        spawn(
          "yt-dlp",
          args,
          {
            stdio: [
              "ignore",
              "pipe",
              "pipe"
            ]
          }
        );

      let output = "";
      let errorOutput = "";

      process.stdout.on(
        "data",
        data => {
          output +=
            data.toString();
        }
      );

      process.stderr.on(
        "data",
        data => {
          errorOutput +=
            data.toString();
        }
      );

      process.on(
        "close",
        code => {

          if (code !== 0) {
            console.error(
              "[yt-dlp info]",
              errorOutput
            );

            return reject(
              new Error(
                "yt-dlp failed"
              )
            );
          }

          try {
            const info =
              JSON.parse(output);

            resolve(info);

          } catch (error) {
            console.error(
              "JSON parse error:",
              error
            );

            console.error(
              "yt-dlp output:",
              output
            );

            reject(error);
          }
        }
      );

      process.on(
        "error",
        error => {
          reject(error);
        }
      );
    }
  );
}


/*
 * ==================================================
 * CLEANUP PLAYER
 * ==================================================
 */

function cleanupPlayer(guildId) {
  const data =
    players.get(guildId);

  if (!data) {
    return;
  }

  try {
    if (data.ytdlp) {
      data.ytdlp.kill(
        "SIGKILL"
      );
    }
  } catch {}

  try {
    if (data.connection) {
      data.connection.destroy();
    }
  } catch {}

  players.delete(guildId);
}
function cleanupGuild(guildId) {
  const data = players.get(guildId);

  if (!data) return;

  data.stopping = true;

  if (data.currentProcess) {
    try {
      data.currentProcess.kill("SIGKILL");
    } catch {}

    data.currentProcess = null;
  }

  try {
    data.player.stop(true);
  } catch {}

  try {
    data.connection?.destroy();
  } catch {}

  data.queue = [];
  data.current = null;
  data.playing = false;
  data.paused = false;

  players.delete(guildId);
}

/* =========================================================
   YOUTUBE INFO
========================================================= */

function getYoutubeInfo(query) {
  return new Promise((resolve, reject) => {
    const args = [
      "--dump-single-json",
      "--no-playlist",
      "--skip-download",
      "--no-warnings",
      query,
    ];

    const process = spawn("yt-dlp", args);

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
        console.error("[yt-dlp info error]", errorOutput);
        return reject(new Error("yt-dlp failed"));
      }

      try {
        const info = JSON.parse(output);
        resolve(info);
      } catch (error) {
        console.error("[yt-dlp JSON error]", error);
        reject(error);
      }
    });
  });
}

/* =========================================================
   SEARCH / URL RESOLVER
========================================================= */

async function resolveTrack(query) {
  const cleanQuery = query.trim();

  if (!cleanQuery) {
    throw new Error("EMPTY_QUERY");
  }

  let searchQuery = cleanQuery;

  // Direct YouTube URL
  if (
    /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(cleanQuery)
  ) {
    searchQuery = cleanQuery;
  } else {
    // YouTube search
    searchQuery = `ytsearch1:${cleanQuery}`;
  }

  const info = await getYoutubeInfo(searchQuery);

  if (!info) {
    throw new Error("NO_RESULT");
  }

  // ytsearch returns entries[]
  let video = info;

  if (Array.isArray(info.entries)) {
    video = info.entries[0];
  }

  if (!video || !video.webpage_url) {
    throw new Error("NO_RESULT");
  }

  return {
    title: video.title || "Unknown Song",
    url: video.webpage_url,
    duration: video.duration_string || "Unknown",
    thumbnail:
      video.thumbnail ||
      (Array.isArray(video.thumbnails) && video.thumbnails.length
        ? video.thumbnails[video.thumbnails.length - 1].url
        : null),
  };
}

/* =========================================================
   VOICE CONNECTION
========================================================= */

async function connectToVoice(interaction, data) {
  const voiceChannel = interaction.member.voice.channel;

  if (!voiceChannel) {
    throw new Error("NOT_IN_VOICE");
  }

  if (data.connection) {
    const currentChannelId = data.connection.joinConfig.channelId;

    if (currentChannelId !== voiceChannel.id) {
      throw new Error("DIFFERENT_VOICE");
    }

    return data.connection;
  }

  data.connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guild.id,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  await entersState(
    data.connection,
    VoiceConnectionStatus.Ready,
    20000
  );

  data.connection.subscribe(data.player);

  return data.connection;
}

/* =========================================================
   START TRACK
========================================================= */

async function playTrack(guildId, track) {
  const data = players.get(guildId);

  if (!data) {
    throw new Error("PLAYER_NOT_FOUND");
  }

  if (!data.connection) {
    throw new Error("VOICE_NOT_CONNECTED");
  }

  // Kill previous yt-dlp process if any
  if (data.currentProcess) {
    try {
      data.currentProcess.kill("SIGKILL");
    } catch {}

    data.currentProcess = null;
  }

  data.current = track;
  data.playing = true;
  data.paused = false;
  data.stopping = false;

  /*
   * yt-dlp:
   * - Download best audio
   * - Output directly to stdout
   * - No playlist
   *
   * We use WebM/Opus when available because Discord voice
   * can consume it directly.
   */

  const ytdlp = spawn(
    "yt-dlp",
    [
      "--no-playlist",
      "--no-warnings",
      "--ignore-errors",
      "-f",
      "bestaudio[acodec=opus]/bestaudio",
      "-o",
      "-",
      track.url,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  data.currentProcess = ytdlp;

  ytdlp.stderr.on("data", (chunk) => {
    const message = chunk.toString().trim();

    if (message) {
      console.log(`[yt-dlp] ${message}`);
    }
  });

  ytdlp.on("error", (error) => {
    console.error("[Music] yt-dlp process error:", error);

    data.playing = false;
    data.paused = false;

    if (data.currentProcess === ytdlp) {
      data.currentProcess = null;
    }

    if (data.queue.length > 0 && !data.stopping) {
      playNext(guildId).catch((err) => {
        console.error("[Music] Failed to play next:", err);
      });
    }
  });

  ytdlp.on("close", (code) => {
    console.log(`[yt-dlp] process exited with code ${code}`);

    if (data.currentProcess === ytdlp) {
      data.currentProcess = null;
    }
  });

  /*
   * WebM Opus is preferred.
   * If YouTube gives another codec, FFmpeg/yt-dlp should
   * normally handle the selected audio format.
   */
  const resource = createAudioResource(ytdlp.stdout, {
    inputType: StreamType.WebmOpus,
    inlineVolume: true,
  });

  if (resource.volume) {
    resource.volume.setVolume(1.0);
  }

  data.player.play(resource);

  return track;
}

/* =========================================================
   PLAY NEXT
========================================================= */

async function playNext(guildId) {
  const data = players.get(guildId);

  if (!data || data.stopping) {
    return false;
  }

  if (!data.queue.length) {
    data.current = null;
    data.playing = false;
    data.paused = false;
    return false;
  }

  const nextTrack = data.queue.shift();

  try {
    await playTrack(guildId, nextTrack);

    if (data.textChannel) {
      try {
        await data.textChannel.send(
          `🎵 Now playing: **${nextTrack.title}**`
        );
      } catch {}
    }

    return true;
  } catch (error) {
    console.error("[Music] Next track failed:", error);

    data.current = null;
    data.playing = false;

    if (data.queue.length > 0) {
      return playNext(guildId);
    }

    return false;
  }
}

/* =========================================================
   COMMANDS
========================================================= */

const playCommand = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song from YouTube")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Song name or YouTube URL")
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const query = interaction.options.getString("query", true);
    const guildId = interaction.guild.id;

    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
      return interaction.editReply(
        "❌ Join a voice channel first."
      );
    }

    const data = getGuildPlayer(guildId);

    data.textChannel = interaction.channel;

    try {
      await connectToVoice(interaction, data);

      const track = await resolveTrack(query);

      // Already playing → queue
      if (data.playing || data.current) {
        data.queue.push(track);

        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("🎵 Added to Queue")
          .setDescription(`**${track.title}**`)
          .addFields({
            name: "Position",
            value: `${data.queue.length}`,
            inline: true,
          })
          .setFooter({
            text: "VeloByte Music • YouTube",
          });

        return interaction.editReply({
          embeds: [embed],
        });
      }

      // Nothing playing → start immediately
      await playTrack(guildId, track);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🎵 VeloByte Music")
        .setDescription(`▶️ **${track.title}**`)
        .addFields(
          {
            name: "Requested by",
            value: `${interaction.user}`,
            inline: true,
          },
          {
            name: "Duration",
            value: track.duration || "Unknown",
            inline: true,
          }
        )
        .setFooter({
          text: "VeloByte Music • YouTube",
        });

      if (track.thumbnail) {
        embed.setThumbnail(track.thumbnail);
      }

      return interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      console.error("[Music /play Error]", error);

      if (error.message === "NOT_IN_VOICE") {
        return interaction.editReply(
          "❌ Join a voice channel first."
        );
      }

      if (error.message === "DIFFERENT_VOICE") {
        return interaction.editReply(
          "❌ I am already playing music in another voice channel."
        );
      }

      if (error.message === "NO_RESULT") {
        return interaction.editReply(
          "❌ No YouTube song found for that search."
        );
      }

      if (error.message === "EMPTY_QUERY") {
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

/* =========================================================
   PAUSE
========================================================= */

const pauseCommand = {
  data: new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause the current song."),

  async execute(interaction) {
    const data = players.get(interaction.guild.id);

    if (!data || !data.current) {
      return interaction.reply({
        content: "❌ Nothing is currently playing.",
        ephemeral: true,
      });
    }

    if (data.paused) {
      return interaction.reply({
        content: "⏸️ Music is already paused.",
        ephemeral: true,
      });
    }

    data.player.pause();
    data.paused = true;

    return interaction.reply("⏸️ Music paused.");
  },
};

/* =========================================================
   RESUME
========================================================= */

const resumeCommand = {
  data: new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume the current song."),

  async execute(interaction) {
    const data = players.get(interaction.guild.id);

    if (!data || !data.current) {
      return interaction.reply({
        content: "❌ Nothing is currently playing.",
        ephemeral: true,
      });
    }

    if (!data.paused) {
      return interaction.reply({
        content: "▶️ Music is already playing.",
        ephemeral: true,
      });
    }

    data.player.unpause();
    data.paused = false;

    return interaction.reply("▶️ Music resumed.");
  },
};

/* =========================================================
   SKIP
========================================================= */

const skipCommand = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current song."),

  async execute(interaction) {
    const data = players.get(interaction.guild.id);

    if (!data || !data.current) {
      return interaction.reply({
        content: "❌ Nothing is currently playing.",
        ephemeral: true,
      });
    }

    const skipped = data.current.title;

    // Prevent Idle handler from doing duplicate cleanup
    data.playing = false;
    data.paused = false;

    if (data.currentProcess) {
      try {
        data.currentProcess.kill("SIGKILL");
      } catch {}

      data.currentProcess = null;
    }

    data.player.stop(true);

    if (data.queue.length > 0) {
      const next = data.queue.shift();

      try {
        await playTrack(interaction.guild.id, next);

        return interaction.reply(
          `⏭️ Skipped **${skipped}**\n🎵 Now playing **${next.title}**`
        );
      } catch (error) {
        console.error("[Music Skip Error]", error);

        return interaction.reply(
          `⏭️ Skipped **${skipped}**\n❌ Could not play the next song.`
        );
      }
    }

    data.current = null;

    return interaction.reply(
      `⏭️ Skipped **${skipped}**\n📭 Queue is empty.`
    );
  },
};

/* =========================================================
   QUEUE
========================================================= */

const queueCommand = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the music queue."),

  async execute(interaction) {
    const data = players.get(interaction.guild.id);

    if (!data) {
      return interaction.reply("📭 Music queue is empty.");
    }

    const lines = [];

    if (data.current) {
      lines.push(
        `🎵 **Now Playing:** ${data.current.title}`
      );
    } else {
      lines.push("🎵 **Now Playing:** Nothing");
    }

    if (data.queue.length > 0) {
      lines.push("");
      lines.push("📋 **Up Next:**");

      data.queue.slice(0, 10).forEach((track, index) => {
        lines.push(
          `\`${index + 1}.\` ${track.title}`
        );
      });

      if (data.queue.length > 10) {
        lines.push(
          `\n...and ${data.queue.length - 10} more`
        );
      }
    } else {
      lines.push("");
      lines.push("📭 Queue is empty.");
    }

    return interaction.reply(lines.join("\n"));
  },
};

/* =========================================================
   STOP
========================================================= */

const stopCommand = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop music and leave the voice channel."),

  async execute(interaction) {
    const data = players.get(interaction.guild.id);

    if (!data) {
      return interaction.reply({
        content: "❌ Nothing is playing.",
        ephemeral: true,
      });
    }

    cleanupGuild(interaction.guild.id);

    return interaction.reply(
      "⏹️ Music stopped and I left the voice channel."
    );
  },
};

/* =========================================================
   EXPORT ALL MUSIC COMMANDS
========================================================= */

module.exports = [
  playCommand,
  pauseCommand,
  resumeCommand,
  skipCommand,
  queueCommand,
  stopCommand,
];
