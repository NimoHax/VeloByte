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
const fs = require("fs");

// ==================================================
// MUSIC PLAYERS
// ==================================================

const players = new Map();

// ==================================================
// YOUTUBE COOKIES
// ==================================================

const COOKIE_PATH =
  "/tmp/velobyte-youtube-cookies.txt";

function getCookiePath() {
  const cookies =
    process.env.YOUTUBE_COOKIES_B64?.trim();

  if (!cookies) {
    return null;
  }

  try {
    const decoded =
      Buffer.from(
        cookies,
        "base64"
      ).toString("utf8");

    if (
      !decoded.includes(
        "# Netscape HTTP Cookie File"
      ) &&
      !decoded.includes(
        "# HTTP Cookie File"
      )
    ) {
      console.warn(
        "[Music] YOUTUBE_COOKIES_B64 does not look like a Netscape cookies.txt file."
      );

      return null;
    }

    fs.writeFileSync(
      COOKIE_PATH,
      decoded,
      {
        mode: 0o600,
      }
    );

    return COOKIE_PATH;
  } catch (error) {
    console.error(
      "[Music] Failed to create cookies file:",
      error.message
    );

    return null;
  }
}

// ==================================================
// YT-DLP BASE ARGUMENTS
// ==================================================

function baseYoutubeArgs() {
  const args = [
    "--js-runtimes",
    "node",

    "--remote-components",
    "ejs:github",

    "--no-warnings",
    "--no-playlist",

    "--extractor-args",
    "youtube:player_client=web_safari",
  ];

  const cookiePath =
    getCookiePath();

  if (cookiePath) {
    args.push(
      "--cookies",
      cookiePath
    );
  }

  return args;
}

// ==================================================
// GET / CREATE GUILD PLAYER
// ==================================================

function getGuildPlayer(guildId) {
  let data =
    players.get(guildId);

  if (data) {
    return data;
  }

  const player =
    createAudioPlayer({
      behaviors: {
        noSubscriber:
          NoSubscriberBehavior.Play,
      },
    });

  data = {
    player,

    connection: null,

    queue: [],

    current: null,

    ytdlpProcess: null,

    ffmpegProcess: null,

    playing: false,

    paused: false,

    stopping: false,

    textChannel: null,
  };

  players.set(
    guildId,
    data
  );

  // ==================================================
  // PLAYER ERROR
  // ==================================================

  player.on(
    "error",
    (error) => {
      console.error(
        "[Music] Audio Player Error:",
        error
      );

      const currentData =
        players.get(guildId);

      if (!currentData) {
        return;
      }

      killProcesses(
        currentData
      );

      currentData.playing =
        false;

      currentData.paused =
        false;

      if (
        currentData.queue.length >
          0 &&
        !currentData.stopping
      ) {
        playNext(
          guildId
        ).catch(
          (err) => {
            console.error(
              "[Music] Failed to play next:",
              err
            );
          }
        );
      }
    }
  );

  // ==================================================
  // SONG FINISHED
  // ==================================================

  player.on(
    AudioPlayerStatus.Idle,
    async () => {
      const currentData =
        players.get(guildId);

      if (!currentData) {
        return;
      }

      if (
        currentData.stopping
      ) {
        return;
      }

      console.log(
        `[Music] Finished: ${
          currentData.current?.title ||
          "Unknown"
        }`
      );

      killProcesses(
        currentData
      );

      currentData.current =
        null;

      currentData.playing =
        false;

      currentData.paused =
        false;

      if (
        currentData.queue.length >
        0
      ) {
        await playNext(
          guildId
        );
      }
    }
  );

  return data;
}

// ==================================================
// PROCESS CLEANUP
// ==================================================

function killProcess(
  process
) {
  if (!process) {
    return;
  }

  try {
    process.kill(
      "SIGKILL"
    );
  } catch {}
}

function killProcesses(
  data
) {
  killProcess(
    data.ytdlpProcess
  );

  killProcess(
    data.ffmpegProcess
  );

  data.ytdlpProcess =
    null;

  data.ffmpegProcess =
    null;
}

// ==================================================
// CLEANUP GUILD
// ==================================================

function cleanupGuild(
  guildId
) {
  const data =
    players.get(guildId);

  if (!data) {
    return;
  }

  data.stopping =
    true;

  killProcesses(
    data
  );

  try {
    data.player.stop(
      true
    );
  } catch {}

  try {
    if (
      data.connection
    ) {
      data.connection.destroy();
    }
  } catch {}

  data.queue = [];

  data.current =
    null;

  data.playing =
    false;

  data.paused =
    false;

  players.delete(
    guildId
  );

  console.log(
    `[Music] Cleaned up guild: ${guildId}`
  );
}

// ==================================================
// RUN YT-DLP JSON
// ==================================================

function runYtDlpJson(
  query
) {
  return new Promise(
    (resolve, reject) => {
      const args = [
        ...baseYoutubeArgs(),

        "--dump-single-json",

        "--skip-download",

        "--quiet",

        query,
      ];

      console.log(
        `[Music] Searching YouTube: ${query}`
      );

      const child =
        spawn(
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

      let stdout = "";

      let stderr = "";

      child.stdout.on(
        "data",
        (chunk) => {
          stdout +=
            chunk.toString();
        }
      );

      child.stderr.on(
        "data",
        (chunk) => {
          stderr +=
            chunk.toString();
        }
      );

      child.on(
        "error",
        (error) => {
          console.error(
            "[Music] yt-dlp spawn error:",
            error.message
          );

          reject(
            new Error(
              "YTDLP_SEARCH_FAILED"
            )
          );
        }
      );

      child.on(
        "close",
        (code) => {
          if (
            code !== 0
          ) {
            console.error(
              "[Music] yt-dlp search error:",
              stderr.trim()
            );

            return reject(
              new Error(
                "YTDLP_SEARCH_FAILED"
              )
            );
          }

          if (
            !stdout.trim()
          ) {
            return reject(
              new Error(
                "NO_RESULT"
              )
            );
          }

          try {
            const json =
              JSON.parse(
                stdout
              );

            resolve(
              json
            );
          } catch (error) {
            console.error(
              "[Music] Invalid yt-dlp JSON:",
              error.message
            );

            reject(
              new Error(
                "YTDLP_SEARCH_FAILED"
              )
            );
          }
        }
      );
    }
  );
}

// ==================================================
// RESOLVE SONG
// ==================================================

async function resolveTrack(
  query
) {
  const cleanQuery =
    query.trim();

  if (!cleanQuery) {
    throw new Error(
      "EMPTY_QUERY"
    );
  }

  const isYoutubeUrl =
    /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(
      cleanQuery
    );

  const searchQuery =
    isYoutubeUrl
      ? cleanQuery
      : `ytsearch1:${cleanQuery}`;

  const info =
    await runYtDlpJson(
      searchQuery
    );

  if (!info) {
    throw new Error(
      "NO_RESULT"
    );
  }

  let video =
    info;

  if (
    Array.isArray(
      info.entries
    )
  ) {
    video =
      info.entries.find(
        (entry) =>
          entry &&
          entry.webpage_url
      );
  }

  if (
    !video ||
    !video.webpage_url
  ) {
    throw new Error(
      "NO_RESULT"
    );
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
        Array.isArray(
          video.thumbnails
        ) &&
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
    throw new Error(
      "NOT_IN_VOICE"
    );
  }

  // Already connected
  if (
    data.connection
  ) {
    const currentChannelId =
      data.connection
        .joinConfig
        .channelId;

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

  data.connection =
    connection;

  connection.subscribe(
    data.player
  );

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

function playTrack(
  guildId,
  track
) {
  return new Promise(
    (resolve, reject) => {
      const data =
        players.get(
          guildId
        );

      if (!data) {
        return reject(
          new Error(
            "PLAYER_NOT_FOUND"
          )
        );
      }

      if (
        !data.connection
      ) {
        return reject(
          new Error(
            "VOICE_NOT_CONNECTED"
          )
        );
      }

      killProcesses(
        data
      );

      data.current =
        track;

      data.playing =
        true;

      data.paused =
        false;

      data.stopping =
        false;

      console.log(
        `[Music] Starting: ${track.title}`
      );

      // ==================================================
      // YT-DLP
      //
      // Prefer original YouTube Opus audio.
      // No forced 128k conversion.
      // ==================================================

      const ytArgs = [
        ...baseYoutubeArgs(),

        "-f",

        "bestaudio/best",
        "--extractor-args",
        "youtube:player_client=web_safari",
        "--no-part",

        "-o",
        "-",

        "--quiet",

        track.url,
      ];

      const ytdlp =
        spawn(
          "yt-dlp",
          ytArgs,
          {
            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          }
        );

      data.ytdlpProcess =
        ytdlp;

      // ==================================================
      // FFMPEG
      //
      // IMPORTANT:
      // -c:a copy
      //
      // This does NOT re-encode audio.
      // It only converts the container to OGG/Opus.
      // ==================================================

      const ffmpeg =
         spawn(
           "ffmpeg",
           [
             "-hide_banner",

             "-loglevel",
             "error",

             "-i",
             "pipe:0",

             "-vn",

             "-c:a",
             "libopus",

             "-b:a",
             "192k",
 
             "-vbr",
             "on",

             "-compression_level",
             "10",

             "-application",
             "audio",
 
             "-ar",
             "48000",

             "-ac",
             "2",

             "-f",
             "ogg",

             "pipe:1",
           ],
          {
            stdio: [
              "pipe",
              "pipe",
              "pipe",
            ],
          }
        );

      data.ffmpegProcess =
        ffmpeg;

      // ==================================================
      // PIPE
      // ==================================================

      ytdlp.stdout.pipe(
        ffmpeg.stdin
      );

      let ytdlpError =
        "";

      let ffmpegError =
        "";

      let settled =
        false;

      const fail =
        (message) => {
          if (
            settled
          ) {
            return;
          }

          settled =
            true;

          killProcesses(
            data
          );

          data.playing =
            false;

          data.paused =
            false;

          reject(
            new Error(
              message
            )
          );
        };

      // ==================================================
      // YT-DLP STDERR
      // ==================================================

      ytdlp.stderr.on(
        "data",
        (chunk) => {
          ytdlpError +=
            chunk.toString();
        }
      );

      // ==================================================
      // FFMPEG STDERR
      // ==================================================

      ffmpeg.stderr.on(
        "data",
        (chunk) => {
          ffmpegError +=
            chunk.toString();
        }
      );

      // ==================================================
      // YT-DLP ERROR
      // ==================================================

      ytdlp.on(
        "error",
        (error) => {
          console.error(
            "[Music] yt-dlp process error:",
            error.message
          );

          fail(
            "YTDLP_PLAY_FAILED"
          );
        }
      );

      // ==================================================
      // FFMPEG ERROR
      // ==================================================

      ffmpeg.on(
        "error",
        (error) => {
          console.error(
            "[Music] FFmpeg process error:",
            error.message
          );

          fail(
            "FFMPEG_FAILED"
          );
        }
      );

      // ==================================================
      // YT-DLP CLOSE
      // ==================================================

      ytdlp.on(
        "close",
        (code) => {
          if (
            code !== 0 &&
            !data.stopping
          ) {
            console.error(
              "[Music] yt-dlp playback failed:",
              ytdlpError.trim()
            );

            try {
              ffmpeg.stdin.end();
            } catch {}

            if (
              !settled
            ) {
              fail(
                "YTDLP_PLAY_FAILED"
              );
            }
          }
        }
      );

      // ==================================================
      // FFMPEG CLOSE
      // ==================================================

      ffmpeg.on(
        "close",
        (code) => {
          if (
            data.ffmpegProcess ===
            ffmpeg
          ) {
            data.ffmpegProcess =
              null;
          }

          if (
            data.ytdlpProcess ===
            ytdlp
          ) {
            data.ytdlpProcess =
              null;
          }

          if (
            code !== 0 &&
            !data.stopping
          ) {
            console.error(
              "[Music] FFmpeg failed:",
              ffmpegError.trim()
            );

            if (
              !settled
            ) {
              fail(
                "FFMPEG_FAILED"
              );
            }
          }
        }
      );

      // ==================================================
      // AUDIO RESOURCE
      // ==================================================

      const resource =
        createAudioResource(
          ffmpeg.stdout,
          {
            inputType:
              StreamType.OggOpus,

            inlineVolume:
              true,
          }
        );

      // ==================================================
      // VOLUME
      // ==================================================

      const volume =
        Number(
          process.env.DEFAULT_VOLUME ||
            100
        ) / 100;

      if (
        resource.volume
      ) {
        resource.volume.setVolume(
          Math.max(
            0,
            Math.min(
              2,
              volume
            )
          )
        );
      }

      // ==================================================
      // PLAY
      // ==================================================

      data.player.play(
        resource
      );

      console.log(
        `[Music] Playing HIGH QUALITY Opus: ${track.title}`
      );

      // We only need to confirm that the process
      // started. AudioPlayer will handle playback.
      setImmediate(
        () => {
          if (
            !settled
          ) {
            settled =
              true;

            resolve(
              track
            );
          }
        }
      );
    }
  );
}

// ==================================================
// PLAY NEXT
// ==================================================

async function playNext(
  guildId
) {
  const data =
    players.get(
      guildId
    );

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
    data.queue.length ===
    0
  ) {
    data.current =
      null;

    data.playing =
      false;

    data.paused =
      false;

    return false;
  }

  const nextTrack =
    data.queue.shift();

  try {
    await playTrack(
      guildId,
      nextTrack
    );

    if (
      data.textChannel
    ) {
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
      error.message
    );

    data.current =
      null;

    data.playing =
      false;

    data.paused =
      false;

    if (
      data.queue.length >
      0
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
        "Play music from YouTube"
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

    if (!voiceChannel) {
      return interaction.editReply(
        "❌ Join a voice channel first."
      );
    }

    const data =
      getGuildPlayer(
        guildId
      );

    data.textChannel =
      interaction.channel;

    try {
      // ==================================================
      // CONNECT
      // ==================================================

      await connectToVoice(
        interaction,
        data
      );

      // ==================================================
      // SEARCH
      // ==================================================

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

      // ==================================================
      // QUEUE
      // ==================================================

      if (
        data.playing ||
        data.current
      ) {
        data.queue.push(
          track
        );

        const embed =
          new EmbedBuilder()
            .setColor(
              0x5865f2
            )
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
            embeds: [
              embed,
            ],
          }
        );
      }

      // ==================================================
      // START MUSIC
      // ==================================================

      await playTrack(
        guildId,
        track
      );

      const embed =
        new EmbedBuilder()
          .setColor(
            0x5865f2
          )
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
              "VeloByte Music • High Quality Opus",
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
          embeds: [
            embed,
          ],
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
        "NO_RESULT"
      ) {
        return interaction.editReply(
          "❌ No YouTube song found for that search."
        );
      }

      if (
        error.message ===
        "YTDLP_SEARCH_FAILED"
      ) {
        return interaction.editReply(
          "❌ YouTube search failed. Check your cookies and Docker logs."
        );
      }

      if (
        error.message ===
        "YTDLP_PLAY_FAILED"
      ) {
        return interaction.editReply(
          "❌ YouTube blocked the audio stream. Refresh your cookies and redeploy."
        );
      }

      if (
        error.message ===
        "FFMPEG_FAILED"
      ) {
        return interaction.editReply(
          "❌ Audio processing failed. Check FFmpeg in Docker."
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
        "❌ Unable to play this track. Check the bot logs."
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
      !data?.current
    ) {
      return interaction.reply(
        {
          content:
            "❌ Nothing is currently playing.",

          ephemeral: true,
        }
      );
    }

    if (
      data.paused
    ) {
      return interaction.reply(
        {
          content:
            "⏸️ Music is already paused.",

          ephemeral: true,
        }
      );
    }

    data.player.pause();

    data.paused =
      true;

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
      !data?.current
    ) {
      return interaction.reply(
        {
          content:
            "❌ Nothing is currently playing.",

          ephemeral: true,
        }
      );
    }

    if (
      !data.paused
    ) {
      return interaction.reply(
        {
          content:
            "▶️ Music is already playing.",

          ephemeral: true,
        }
      );
    }

    data.player.unpause();

    data.paused =
      false;

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
      players.get(
        guildId
      );

    if (
      !data?.current
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

    killProcesses(
      data
    );

    data.current =
      null;

    data.playing =
      false;

    data.paused =
      false;

    try {
      data.player.stop(
        true
      );
    } catch {}

    if (
      data.queue.length >
      0
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

        data.current =
          null;

        data.playing =
          false;

        if (
          data.queue.length >
          0
        ) {
          playNext(
            guildId
          ).catch(
            () => {}
          );
        }

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

    if (
      data.current
    ) {
      lines.push(
        `🎵 **Now Playing:** ${data.current.title}`
      );
    } else {
      lines.push(
        "🎵 **Now Playing:** Nothing"
      );
    }

    if (
      data.queue.length >
      0
    ) {
      lines.push(
        "",
        "📋 **Up Next:**"
      );

      data.queue
        .slice(
          0,
          10
        )
        .forEach(
          (
            track,
            index
          ) => {
            lines.push(
              `\`${index + 1}.\` ${track.title}`
            );
          }
        );

      if (
        data.queue.length >
        10
      ) {
        lines.push(
          "",
          `...and ${
            data.queue.length -
            10
          } more`
        );
      }
    } else {
      lines.push(
        "",
        "📭 Queue is empty."
      );
    }

    return interaction.reply(
      lines.join(
        "\n"
      )
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

    if (
      !players.has(
        guildId
      )
    ) {
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
// EXPORT COMMANDS
// ==================================================

module.exports = [
  playCommand,
  pauseCommand,
  resumeCommand,
  skipCommand,
  queueCommand,
  stopCommand,
];
