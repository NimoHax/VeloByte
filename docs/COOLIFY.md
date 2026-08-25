# VeloByte Core — Coolify Deployment

## Environment variables

Use `.env.example` as the checklist.

Required:
- DISCORD_TOKEN
- DISCORD_CLIENT_ID
- DISCORD_GUILD_ID
- DATABASE_URL

For the Compose deployment:
`DATABASE_URL=postgresql://velobyte:YOUR_PASSWORD@postgres:5432/velobyte`

Set the same password in:
`POSTGRES_PASSWORD=YOUR_PASSWORD`

Then configure your Discord channel/role IDs.

## Deployment

1. GitHub -> push project.
2. Coolify -> New Resource.
3. Select Docker Compose.
4. Select GitHub repository.
5. Deploy.
6. Verify bot logs.
7. Run command `npm run register` once.
8. Restart/redeploy the bot.

## Persistent database

Do not remove the `velobyte_pgdata` volume.

## No public bot port

The bot does not expose a web server, so no domain is required for the bot container.

If a future dashboard is added, expose the dashboard as a separate web service and protect it with authentication.
