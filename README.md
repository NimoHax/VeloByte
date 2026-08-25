# VeloByte Core

A production-oriented Discord bot starter for VeloByte: moderation, welcome, tickets, bug/beta workflow, community XP, suggestions, security status and voice music.

## 1. Discord Developer Portal

Create an application and bot.

You need:
- Application ID -> `DISCORD_CLIENT_ID`
- Bot token -> `DISCORD_TOKEN`
- Your VeloByte server ID -> `DISCORD_GUILD_ID`

Enable these privileged intents under Bot:
- Server Members Intent
- Message Content Intent

Install the bot into the server with scopes:
- `bot`
- `applications.commands`

Recommended bot permissions:
- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Messages
- Manage Channels
- Manage Roles
- Moderate Members
- Kick Members
- Ban Members
- Connect
- Speak
- Move Members

Do NOT put the bot's token in GitHub.

## 2. Discord role hierarchy

Create a role named `🤖 VeloByte Core` and put it above the roles the bot must manage, but keep it below the server owner/protected owner-level role.

Example:
Server Owner
VeloByte Core
Founder
VeloByte
CEO
Management
Administrator
Moderator
Developer
Designer
Beta Tester
Bug Hunter
Verified Member
Member
@everyone

The bot cannot manage the server owner or roles above its highest role. This is a Discord security rule.

## 3. Create channels/categories

Your existing VeloByte structure can be used. Set these IDs in `.env`:
- Welcome channel
- Ticket category
- Ticket review
- Bug reports
- Fixed bugs
- Suggestions
- Events
- Mod logs

Copy each Discord channel/category ID using Developer Mode.

## 4. Local setup

Requirements:
- Node.js 24+
- PostgreSQL 17+
- FFmpeg for music

Commands:

```bash
npm install
cp .env.example .env
# edit .env
npm run register
npm start
```

## 5. Docker / Coolify

This repository already contains:
- Dockerfile
- docker-compose.yml
- PostgreSQL service
- persistent PostgreSQL volume
- healthcheck

### Coolify steps

1. Push this repository to GitHub.
2. In Coolify: New Resource -> Docker Compose.
3. Connect GitHub and select this repository.
4. Make sure the Compose file is detected.
5. Add environment variables from `.env.example`.
6. Set a strong `POSTGRES_PASSWORD`.
7. Deploy.
8. Open deployment logs and confirm:
   `VeloByte Core online as ...`
   `Connected to PostgreSQL`

### Important

The bot itself does not need a public HTTP port. It connects outbound to Discord Gateway.

## 6. Register slash commands in Coolify

The included `npm run register` command registers commands to one specific guild. Run it once after setting:
- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`

If you need to run it inside Coolify, use the application's terminal/command execution feature, or temporarily change the start command to `npm run register`, deploy once, then restore `node src/index.js`.

## 7. Ticket panel

After deployment:
1. Go to `#create-ticket`.
2. Run `/setup-ticket`.
3. Users will get buttons for General, Technical, Bug and Business support.

## 8. Welcome

Set `WELCOME_CHANNEL_ID` and `MEMBER_ROLE_ID`.
New members automatically receive the Member role and a welcome embed.

## 9. Moderation

Commands:
- `/warn`
- `/timeout`
- `/kick`
- `/ban`
- `/clear`

Automatic protections:
- Discord invite blocking (configurable)
- basic message flood detection
- automatic timeout for flooding
- moderation logs

For production, also configure Discord AutoMod in Server Settings as a second safety layer.

## 10. Bug reporting

Use:
`/bug product:<name> description:<details> platform:<platform> version:<version> severity:<severity>`

Use `/bug-status` with a staff permission to move:
open -> investigating -> development -> testing -> fixed

## 11. Community

- `/profile`
- `/leaderboard`
- `/suggest`

XP is granted to normal messages with a cooldown to reduce farming.

## 12. Music

Commands:
- `/play`
- `/pause`
- `/resume`
- `/skip`
- `/queue`
- `/stop`

The music implementation uses Discord voice plus `play-dl`. Use audio sources you are authorized to access and follow the source platform's terms.

## 13. Production hardening

Before inviting a large public audience:
- Configure Discord AutoMod.
- Keep Founder/Owner protected from bot actions.
- Give the bot only required permissions.
- Enable 2FA for staff accounts.
- Keep PostgreSQL persistent storage.
- Back up PostgreSQL regularly.
- Never commit `.env`.
- Monitor Coolify logs.
- Add a second emergency admin account/owner according to your organization's policy.
