# Operations

Running, updating and fixing the stack on the home server. Placeholders: `<server>` is the server's SSH host, `<domain>` is `DOMAIN` from `.env`. Commands run in the project folder on the server (`~/.services/discord-stream-recorder`, next to the other stacks), where `.env` sets `COMPOSE_FILE=compose.yaml:compose.server.yaml`, so plain `docker compose` picks up the Traefik overlay.

## At a glance

| What               | Where                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Archive            | `https://archive.<domain>` (Traefik, DNS-only Cloudflare CNAME); `/healthz` for a check                            |
| Recorder's Discord | noVNC over SSH only: `ssh -L 6080:localhost:6080 <server>`, then `http://localhost:6080/vnc.html` (`VNC_PASSWORD`) |
| App state          | `APP_DATA_DIR`: `recorder/profile-firefox` (the Discord login), `archive/archive.db`, `archive/images/`            |
| Recordings         | `RECORDINGS_HOST_DIR`: one folder per session with `session.json`, `raw/`, `leveled/`                              |
| Logs               | `docker compose logs -f recorder` / `archive` (JSON; pipe through `pnpm dlx pino-pretty`)                          |

noVNC is bound to `127.0.0.1` on the server on purpose: Docker-published ports bypass ufw, and noVNC is full control of the recorder account. Never publish it on `0.0.0.0` or through Traefik.

## Deploy and update

```sh
ssh <server>
cd ~/.services/discord-stream-recorder
git pull                            # read-only deploy key: Host github-dsr in ~/.ssh/config
docker compose up -d --build        # rebuilds both images, recreates changed containers
docker compose ps                   # archive should be "healthy"
```

Recreating `recorder` during an event ends the current set (marked partial) and leaves voice; it has 30 s to finish (`stop_grace_period`). Avoid it mid-event. `archive` can be recreated any time; it migrates its database on start.

## Common problems

### The recorder account is logged out

**Symptoms:** `/record start` replies that the recorder is logged out, or the recorder log has `the recorder account is logged out; log in over noVNC`.

1. Open the tunnel and noVNC (see "At a glance"). You see the Discord web client in Firefox.
2. Log in as the recorder account by hand, including any captcha or email check. Login is never automated (self-bot ToS risk).
3. In User Settings → Notifications, turn on **Disable All Notification Sounds** again: Discord keeps it per browser profile, and the sounds would end up in recordings.
4. Close the SSH tunnel. The login lives in `APP_DATA_DIR/recorder/profile-firefox` and survives restarts. Nothing needs restarting.

That profile folder is equivalent to the account's password: don't copy it anywhere but over SSH, and never commit it.

### `/record` doesn't respond, or the recorder seems stuck

1. `docker compose logs --tail 200 recorder` for the last error.
2. Look at the browser over noVNC: a Discord dialog, an update banner or a "browser not supported" page can block it.
3. `docker compose restart recorder`. The current set, if any, is saved as partial; start again with `/record start`.

If the bot is offline in Discord, check `DISCORD_BOT_TOKEN` in `.env` and that the container is running (`docker compose ps`).

### A set is stuck "processing" or "failed"

The archive's Admin → Overview lists these with the failure reason. Sets left `processing` usually mean the recorder stopped mid-encode. Re-run leveling for a finished session:

```sh
docker compose exec recorder node --import tsx src/reprocess.ts /recordings/<session folder>
# add --all to re-level every set, e.g. after changing TARGET_LUFS
```

Don't run it on the session being recorded. It needs the raw capture, which is deleted `RAW_RETENTION_HOURS` (48) after a set is leveled; failed and unprocessed sets always keep theirs.

### Recordings are silent, mono, or have voices or pings in them

- **Silent:** the stream wasn't opened or its volume is 0. Watch over noVNC while recording; `STREAM_VOLUME` sets the stream's volume (85).
- **Mono:** `BROWSER_CHANNEL` must be `firefox`; Chromium plays Go Live audio in mono (research.md, "Audio quality").
- **Voices:** the recorder joins deafened; if voices leak, check over noVNC that it's still deafened.
- **Notification pings:** turn on **Disable All Notification Sounds** again (see the logout section).

### The archive isn't reachable

1. `docker compose ps`: is `archive` running and healthy? `docker compose logs --tail 100 archive`.
2. From the server: `docker compose exec archive node -e "fetch('http://localhost:3000/healthz').then(r=>console.log(r.status))"`.
3. Traefik: the container must be on `media_network` with the labels from `compose.server.yaml` (`docker inspect` the container; print label and network names only, never env values).
4. DNS: `archive` must be a CNAME to `media.<domain>`, **DNS only**. On the LAN, the local DNS or hosts override must point `archive.<domain>` at the server.

### New sets don't show up in the archive

The archive syncs on file changes and every `ARCHIVE_SYNC_INTERVAL_SECONDS`. `docker compose restart archive` forces a full sync. Folders with an invalid `session.json` are skipped with a warning in the archive log.

### Disk is filling up

Admin → Overview shows storage by kind. Raw captures (about 1.3 GB/h) go 48 h after leveling; the recorder logs `retention: removed files` when its hourly sweep deletes them. Failed sets keep their raw capture until fixed or deleted from the archive's admin pages.

### Who deleted what

Admin → Activity lists every edit and delete. Permanent deletes are also in the archive log: `docker compose logs archive | grep -E 'set deleted|session deleted|delete refused'` (with the set or session, its folder, and whether it was forced).

### The archive database is lost or corrupted

Stop the archive, move `archive.db*` aside and start it: it rebuilds the catalog from every `session.json`. Edits (titles, tags, archive state, order, images, plays) are lost unless restored from a backup.

## Backups

Back up both `APP_DATA_DIR` (the Discord login and `archive.db` with every edit) and `RECORDINGS_HOST_DIR` (the media and `session.json`). For a consistent `archive.db` copy, stop the archive first or use `sqlite3 archive.db ".backup copy.db"`.
