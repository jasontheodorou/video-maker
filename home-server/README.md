# The video maker on your home server

This folder runs the video maker on a Linux machine that stays on, and gives colleagues a private HTTPS link to it through Tailscale Funnel. They open the link, type the password, and make videos. They do not need to install anything.

## What you need

- A 64-bit Linux machine that is always on, with at least 4 GB of memory (8 GB is better) and 20 GB of free disk. Ubuntu 22.04 or 24.04, Debian 12 or similar. The installer checks these and warns you.
- A free Tailscale account (the script helps you sign in).
- An Anthropic API key, with a monthly spend limit set in the Anthropic Console. The app uses it to read briefs.
- A password for the site. Four random words works well.

## Set it up (about 15 minutes)

On the server, run:

```
curl -fsSL https://raw.githubusercontent.com/jasontheodorou/video-maker/main/install.sh | bash
```

It puts everything in `~/video-maker`, then:

- installs Docker if it is missing
- asks for the site password and the API key
- downloads the app (about 2 GB) and starts it
- installs Tailscale and asks you to sign in by opening a link
- turns on Funnel. The first time, Tailscale may show a link to allow Funnel and HTTPS for your account. Open it, approve, and the installer carries on.

At the end it prints the link to send colleagues. Send them the password separately.

The app starts by itself whenever the machine restarts, and restarts itself if it ever stops.

## Day to day

Run these from the `~/video-maker` folder:

| To do this | Type |
|---|---|
| See the link again | `./video-maker link` |
| Check it is running | `./video-maker status` |
| See what it is doing | `./video-maker logs` (Ctrl+C to leave) |
| Restart it | `./video-maker restart` |
| Change the password | `./video-maker password` |
| Change the API key | `./video-maker apikey` |
| Back up videos and brands | `./video-maker backup` |
| Check every tool inside the app | `./video-maker doctor` |
| See how much disk videos use | `./video-maker space` |

## Updating to a new version

```
cd ~/video-maker
./video-maker update
```

It downloads the newest app and helper script. Your password, videos and brands are kept.

## Good to know

- **One video at a time.** If several people ask at once, their videos wait in a queue and the page shows their place.
- **How long a video takes** depends on the machine. On a modern mini PC, expect a few minutes for a short video and 10 to 20 for a long one.
- **Everything you keep is in `data/`.** Back it up now and then with `./video-maker backup` and copy the file somewhere else.
- **The link is on the internet, but not listed anywhere.** The password protects it, and after 10 wrong tries from one address, that address is refused for 15 minutes.
- **To take it offline** without stopping the app, run `sudo tailscale funnel reset`. Run `./video-maker install` again to bring the link back.
- **Older or budget processors work too.** On chips without AVX2 (such as the Celeron J4125 or N5105), captions use a slower build, so videos take a little longer.
- **Videos add up.** Each one keeps its files in `data/`. Check now and then with `./video-maker space`, and delete old videos you no longer need.
- **Arm machines** such as a Raspberry Pi 5 download an Arm version. Older boards such as the Raspberry Pi 4 build the app themselves, which takes 30 to 60 minutes the first time.
