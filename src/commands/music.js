const { SlashCommandBuilder } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require("@discordjs/voice");
const play = require("play-dl");

const players = new Map();

function getPlayer(guildId) {
  let p=players.get(guildId);
  if(!p) {
    p={player:createAudioPlayer(),connection:null,queue:[],current:null};
    p.player.on("error",e=>console.error("Music error",e));
    players.set(guildId,p);
  }
  return p;
}

module.exports = [
  { data:new SlashCommandBuilder().setName("play").setDescription("Play a music URL or search term.")
      .addStringOption(o=>o.setName("query").setDescription("URL or search").setRequired(true)),
    async execute(i) {
      const vc=i.member.voice.channel;
      if(!vc) return i.reply({content:"❌ Join a voice channel first.",ephemeral:true});
      const query=i.options.getString("query");
      const p=getPlayer(i.guild.id);
      try {
        if(!p.connection) {
          p.connection=joinVoiceChannel({channelId:vc.id,guildId:i.guild.id,adapterCreator:i.guild.voiceAdapterCreator});
          await entersState(p.connection,VoiceConnectionStatus.Ready,15_000);
          p.connection.subscribe(p.player);
        }
        let url=query;
        if(!/^https?:\/\//i.test(query)) {
          const res=await play.search(query,{limit:1});
          if(!res.length) return i.reply({content:"❌ No result found.",ephemeral:true});
          url=res[0].url;
        }
        const stream=await play.stream(url,{discordPlayerCompatibility:true});
        const resource=createAudioResource(stream.stream,{inputType:stream.type});
        p.current=query;
        p.player.play(resource);
        await i.reply(`🎵 Playing **${query}** in ${vc}.`);
      } catch(e) {
        console.error(e);
        await i.reply({content:"❌ Music playback failed. Try a direct audio URL or another search.",ephemeral:true});
      }
    }
  },
  { data:new SlashCommandBuilder().setName("pause").setDescription("Pause music."),
    async execute(i){const p=players.get(i.guild.id); if(!p) return i.reply({content:"Nothing is playing.",ephemeral:true}); p.player.pause(); await i.reply("⏸️ Paused.");}
  },
  { data:new SlashCommandBuilder().setName("resume").setDescription("Resume music."),
    async execute(i){const p=players.get(i.guild.id); if(!p) return i.reply({content:"Nothing is playing.",ephemeral:true}); p.player.unpause(); await i.reply("▶️ Resumed.");}
  },
  { data:new SlashCommandBuilder().setName("stop").setDescription("Stop music and leave voice."),
    async execute(i){const p=players.get(i.guild.id); if(!p) return i.reply({content:"Nothing is playing.",ephemeral:true}); p.player.stop(); p.connection?.destroy(); players.delete(i.guild.id); await i.reply("⏹️ Stopped and disconnected.");}
  },
  { data:new SlashCommandBuilder().setName("skip").setDescription("Skip current track."),
    async execute(i){const p=players.get(i.guild.id); if(!p) return i.reply({content:"Nothing is playing.",ephemeral:true}); p.player.stop(); await i.reply("⏭️ Skipped.");}
  },
  { data:new SlashCommandBuilder().setName("queue").setDescription("Show current music queue."),
    async execute(i){const p=players.get(i.guild.id); await i.reply(p?.current?`🎵 Now playing: **${p.current}**`:"🎵 Nothing is playing.");}
  }
];
