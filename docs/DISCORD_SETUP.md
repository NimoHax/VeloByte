# Discord setup

## Developer Portal

Create:
VeloByte Core

Copy:
- Application ID
- Bot Token

Enable:
- Server Members Intent
- Message Content Intent

## Bot role

Create:
🤖 VeloByte Core

Put it above:
- Member
- Verified Member
- Beta Tester
- Bug Hunter
- other roles the bot needs to assign/manage

Do not put it above the owner/protected authority.

## IDs

Enable Developer Mode in Discord.

Copy IDs for:
- server
- welcome
- rules
- ticket category
- ticket review
- bug reports
- fixed bugs
- suggestions
- events
- mod logs
- member role
- verified role
- beta tester
- bug hunter
- founder

Put them into `.env`.

## First commands

After deployment and command registration:

`/help`
`/setup-ticket`
`/security`

Then test:
- join with an alternate test account
- ticket
- bug report
- suggestion
- moderation
- voice/music
