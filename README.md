# File Master

Universal file converter + media downloader + song finder with a glassmorphism UI.
Runs entirely on your machine.

## Install (macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/frankiedei/file-master/main/install.sh | bash
```

This clones the app to `~/.file-master`, installs npm dependencies, installs any
missing tools via Homebrew (ffmpeg, pandoc, yt-dlp), and puts a `file-master`
command on your PATH.

## Run / stop it

```bash
file-master           # start the server + open the app in your browser
file-master stop      # shut the server down
file-master status    # check whether it's running
file-master restart   # stop + start
file-master logs      # tail the server log
file-master update    # pull the latest version
```

You can also shut the server down from the app itself — the power button in the
top-right corner — or, when running via `npm start`, just Ctrl+C.

## Requirements

- **Node 18+** — server (`sharp` handles WebP/AVIF images)
- **ffmpeg** — audio, video, and most image conversions
- **pandoc** — text/document conversions
- **yt-dlp** — song and media downloads

The installer handles ffmpeg/pandoc/yt-dlp via Homebrew if they're missing.

## Features

### Converter tab
- Drag & drop files (or click to browse), or paste a direct link to a file
- Audio: mp3, m4a, wav, flac, aac, ogg, opus, aiff, wma
- Video: mp4, webm, mov, mkv, avi, gif — plus audio extraction (video → mp3 etc.)
- Image: jpg, png, webp, gif, bmp, tiff, avif (HEIC input supported via macOS sips)
- Text: md, html, docx, txt, rtf, odt, epub, tex, json, rst
- Batch convert, then **drag rows to reorder** and **Download ZIP** — entries are
  numbered (`1. name.ext`, `2. name.ext`, …) so the ZIP preserves your order

### Downloader tab
- Paste **YouTube, Instagram, and TikTok** links — one per line — and download
  them all as **MP3** (audio) or **MP4** (video)
- Links can be mixed with other text; anything that looks like a URL is picked up
- MP3 keeps the highest available audio quality and embeds the thumbnail as cover
  art plus the source metadata
- MP4 prefers H.264/AAC so files open in QuickTime, Photos, and iMovie (YouTube's
  best streams are AV1/Opus, which most Apple software won't play), capped at 1080p
- **Expand playlists** (off by default) follows a playlist or channel link instead
  of downloading only the one video, up to 50 items
- Every finished download is listed per row, with a single **Download ZIP** for
  the whole batch
- Instagram and TikTok gate a lot of content behind a login or block datacenter
  IPs — those links fail with the reason shown on the row

### Song Finder tab
- Separate artist + song fields (searching both together is unreliable, so the
  server queries Deezer and iTunes in parallel and ranks exact matches first —
  no API keys needed)
- Cover-art result cards, each with **MP3 / M4A / WAV** buttons — the file type is
  chosen *after* searching, so wanting a different format doesn't mean searching again
- Audio is fetched via yt-dlp with the cover art, title, artist, and album tags
  embedded (WAV can't hold cover art)
- The YouTube match is scored, not just "first result": candidates from two
  query variants are ranked by duration match against the Deezer/iTunes track
  length, artist/title presence, and official "- Topic" audio channels, while
  covers/live versions/remixes/how-to/definition videos are penalized or
  excluded. If nothing scores confidently, the download is refused instead of
  guessing wrong
- **Link override**: paste a YouTube link in the field under the search bar to
  use that exact video for your next download (tags still come from the result
  card you click); in bulk, append `| <YouTube link>` to a line
- **Bulk download**: expand the "Bulk download" panel, paste one song per line
  (`Artist - Title`), and it searches, auto-picks the best match, downloads each,
  and offers a single ZIP at the end

## Notes

- Converted files live in a temp dir (`$TMPDIR/file-master`) and are cleared on reboot
- Max upload size 2 GB; song downloads capped at 100 MB, Downloader-tab MP3 at
  300 MB and MP4 at 1.5 GB
