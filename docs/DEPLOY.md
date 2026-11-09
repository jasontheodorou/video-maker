# Put the video maker online with Oracle Cloud Always Free

This guide puts the video maker on a free Oracle Cloud server, so you and your colleagues can use it in a browser from anywhere. The site asks for a password before it shows anything.

The server costs nothing while it stays within Oracle's Always Free allowance. The only running cost is the Anthropic API, which reads each brief. That is usually a few pence a video.

It takes about an hour the first time. Most of that is waiting for Oracle and for the first build.

## What you need

- An Oracle Cloud account. Signing up is free. Oracle asks for a bank card to check who you are, but does not charge for Always Free resources.
- The code, either in a private GitHub repository or copied straight from your Mac.
- An Anthropic API key, with a monthly spend limit set in the Anthropic Console.
- A password for the site. Four or more random words works well.
- A web address, if you want one. You can start with the server's IP address and add a free web address later.

## How it fits together

The server runs two containers with Docker:

- **app**: the video maker itself, with Chrome, FFmpeg, the Kokoro voice and whisper captions built in
- **caddy**: sits in front of the app and serves the site over HTTPS, with free certificates that renew themselves

Everything the app makes or keeps (videos, brands, uploads and caches) is stored in one folder on the server, `data/`. Back up that folder and you have backed up everything.

## 1. Create your Oracle Cloud account

1. Go to [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) and choose **Start for free**.
2. When it asks for your **home region**, choose **UK South (London)**. Its identifier is `uk-london-1`.

Choose the home region carefully. You cannot change it later, and Always Free servers and storage can only be made in your home region.

Oracle may ask you to upgrade to **Pay As You Go**. You do not have to. If you do, Always Free resources stay free, but anything you make beyond the allowance is charged. Oracle says upgrading can make it easier to get an Ampere server when free capacity is short. If you upgrade, set a budget alert in **Billing and Cost Management** so nothing is charged without you knowing.

## 2. Create the server

1. In the Oracle Cloud console, open the menu and go to **Compute**, then **Instances**, then **Create instance**.
2. Give it a name, for example `video-maker`.
3. Under **Image and shape**, choose **Change image** and pick **Canonical Ubuntu 24.04**.
4. Choose **Change shape**, then **Ampere**, then **VM.Standard.A1.Flex**.
5. Set the OCPUs and memory to the most your Always Free allowance shows. When this guide was written, Oracle's page gave every account 2 OCPUs and 12 GB of memory free. Older guides say 4 OCPUs and 24 GB: use whatever the console offers as free.
6. Under **Networking**, create a new virtual cloud network with a public subnet, and tick **Assign a public IPv4 address**.
7. Under **Add SSH keys**, choose **Generate a key pair for me** and download both keys. Keep the private key safe: it is the only way in.
8. Under **Boot volume**, set the size to 100 GB. Always Free includes 200 GB of storage in total.
9. Choose **Create**.

If you see **Out of host capacity**, Oracle has no free Ampere servers in that part of the region right now. Choose a different **availability domain** on the same page and try again, or try again in a few hours. It can take several tries.

When the server is running, copy its **public IP address** from the instance page. This guide calls it `YOUR_IP`.

## 3. Open the ports for the website

The site needs ports 80 (HTTP) and 443 (HTTPS) open in two places: Oracle's network and the server's own firewall.

### In Oracle's network

1. On the instance page, select the **subnet** link, then the **security list** (usually called Default Security List).
2. Choose **Add ingress rules** and add a rule with:
   - Source CIDR: `0.0.0.0/0`
   - IP protocol: TCP
   - Destination port range: `80`
3. Add a second rule the same way for port `443`.

### On the server

Connect from your Mac's Terminal (change the key file name to yours):

```
chmod 600 ~/Downloads/ssh-key-video-maker.key
ssh -i ~/Downloads/ssh-key-video-maker.key ubuntu@YOUR_IP
```

Oracle's Ubuntu images block most ports with their own firewall rules. Open 80 and 443 and save the rules so they survive a restart:

```
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 4. Install Docker

Still connected to the server:

```
sudo apt-get update && sudo apt-get upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit
```

Connect again with the same `ssh` command, then check Docker works:

```
docker compose version
```

## 5. Copy the code to the server

Use one of these.

### From a private GitHub repository

On the server, sign in to GitHub with a [deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys) or a personal access token, then:

```
git clone git@github.com:YOUR_ACCOUNT/video-assembly.git
cd video-assembly
```

### Straight from your Mac

On your Mac, in the project folder:

```
rsync -av -e "ssh -i ~/Downloads/ssh-key-video-maker.key" \
  --exclude node_modules --exclude jobs --exclude .cache --exclude demo-output \
  --exclude ui/dist --exclude .vellum --exclude .env \
  ./ ubuntu@YOUR_IP:video-assembly/
```

Then on the server, `cd video-assembly`.

Only the sample brand (Northvale Council) is built into the app. To bring your own brands, copy their folders into `data/brands/` on the server after step 7, or create them on the Brands page.

## 6. Fill in the settings

On the server, in the `video-assembly` folder:

```
cp .env.example .env
nano .env
chmod 600 .env
```

Fill in:

- `APP_PASSWORD`: the password for the site
- `ANTHROPIC_API_KEY`: your Anthropic API key
- `SITE_ADDRESS`: leave it as `:80` for now. Step 8 changes it when you have a web address

Save with Ctrl+O, then Enter, then Ctrl+X.

`.env` holds your secrets. It is listed in `.gitignore`, so git never commits it. Do not copy it anywhere else.

## 7. Start it

```
mkdir -p data
docker compose up -d --build
```

The first build downloads Chrome, the voice model and the caption model and builds the pages. It took about 5 minutes on an Apple silicon Mac. On a 2 OCPU server, expect about 20 to 30 minutes (an estimate). Later builds reuse most of this and take a few minutes.

Check both containers are running and the app is healthy:

```
docker compose ps
docker compose exec app npm run doctor
```

Every line of the doctor check should say OK. Then open `http://YOUR_IP` in your browser. You should see the sign-in page.

Make one short video to check everything works before you share the address.

## 8. Get a web address and HTTPS

Until you have a web address, the site works over plain HTTP at `http://YOUR_IP`. Plain HTTP sends the password unencrypted, so use it only to check the server works. Then set up a web address so Caddy can turn on HTTPS.

### A free web address

[Duck DNS](https://www.duckdns.org) gives you a free address such as `northvale-videos.duckdns.org`:

1. Sign in to Duck DNS and add a subdomain.
2. Set its IP address to `YOUR_IP`.

### Your own domain

If you have a domain, add an **A record**, for example `videos.example.com`, pointing at `YOUR_IP`.

### Turn on HTTPS

On the server, set `SITE_ADDRESS` in `.env` to your web address, for example:

```
SITE_ADDRESS=northvale-videos.duckdns.org
```

Then:

```
docker compose up -d
```

Caddy gets a free certificate from Let's Encrypt within a minute and renews it by itself. Open `https://` and your web address. If the certificate does not arrive, check the web address points at `YOUR_IP` and that port 80 is open (step 3), then look at `docker compose logs caddy`.

### Another way: Cloudflare Tunnel

If you would rather not open any ports, [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) connects the server to Cloudflare from the inside. It is free, but it needs a domain that uses Cloudflare. In short: create a tunnel in the Cloudflare dashboard, add a `cloudflared` container to `docker-compose.yml` with the tunnel token, and point the tunnel's public hostname at `http://app:8080`. You then do not need the Caddy container or the open ports. The app's own password still protects the site.

## Using the site

- Sign in at your web address with the password from `.env`.
- To sign out, go to `/logout`.
- The sign-in lasts 14 days. Changing `APP_PASSWORD` and running `docker compose up -d` signs everyone out.
- After 10 wrong passwords from one address, the site refuses that address for 15 minutes.
- `/healthz` is the only address that works without the password. It shows whether the app is up and nothing else.

## Update to a new version

Wait until no video is being made, then on the server:

```
cd video-assembly
git pull
docker compose up -d --build
docker image prune -f
```

If you copied the code with `rsync`, run the same `rsync` command from your Mac instead of `git pull`.

If a video was being made when the app restarted, it is marked as stopped. Open it and press **Try again**.

## Back up your videos and brands

Everything is in the `data` folder on the server. To copy it to your Mac, run this on your Mac:

```
rsync -av -e "ssh -i ~/Downloads/ssh-key-video-maker.key" \
  --exclude .cache ubuntu@YOUR_IP:video-assembly/data/ ~/video-maker-backup/
```

Run it again whenever you want a fresh copy. It only copies what has changed. The `.cache` folder is left out because the app rebuilds it.

Oracle's Always Free allowance also includes 5 volume backups. In the console, go to **Storage**, then **Boot volumes**, choose the server's boot volume and **Create boot volume backup**. A backup copies the whole server, so you can restore it if something goes badly wrong.

To restore the `data` folder:

```
docker compose down
rsync -av ~/video-maker-backup/ ubuntu@YOUR_IP:video-assembly/data/
docker compose up -d
```

The first command runs on the server, the second on your Mac and the third on the server.

## Costs

| What | Cost |
| --- | --- |
| Oracle server, storage and traffic | £0 within Always Free: Ampere A1 (2 OCPUs and 12 GB when this guide was written), 200 GB of storage and 10 TB of outgoing data a month |
| Web address from Duck DNS | £0 |
| HTTPS certificate | £0 (Let's Encrypt, through Caddy) |
| Anthropic API | Pay per use. Each brief takes 2 to 5 calls to Claude Sonnet 5.5. Check the real cost in the Anthropic Console after your first few videos, and set a monthly spend limit |

## Settings

These go in `.env`, or in `docker-compose.yml` for the ones it already sets.

| Setting | What it does |
| --- | --- |
| `APP_PASSWORD` | Turns on the sign-in page and sets the password. Without it, the site is open to anyone, so always set it on a server |
| `ANTHROPIC_API_KEY` | Your Anthropic API key, used to read briefs |
| `SITE_ADDRESS` | Your web address for HTTPS, or `:80` for plain HTTP on the IP address |
| `VIDEO_INTERPRETER_MODEL` | The model that reads briefs. Default `claude-sonnet-5-5` |
| `VIDEO_INTERPRETER_BACKEND` | Set to `api` by `docker-compose.yml`, so briefs are read with the Anthropic API. The Claude Code command line is not in the container |
| `DATA_DIR` | Where jobs, brands and caches are kept inside the container. Set to `/data` by `docker-compose.yml`, which is the `data` folder on the server |
| `PORT` | The port the app listens on inside the container. Set to `8080`. Caddy passes visitors to it |

On your Mac none of these need to be set: `npm run app` works as before, on port 3006, with no sign-in page.

## Limits

- **One video at a time.** Videos queue and are made one after another, as on the Mac.
- **Speed.** The server is slower than your Mac. In a test set up to match the free server (2 CPUs and 12 GB of memory, on an Apple silicon Mac), a 17-second video in all three formats took about 5.5 minutes: 1 minute for the voice, 1.5 minutes for the captions and just under 3 minutes to make the three videos. Ampere cores are a little slower than Apple's, so expect roughly 6 to 10 minutes for a short video and 25 to 40 minutes for a long one (estimates). On an M1 Pro Mac a short video takes 2 to 4 minutes. If your account offers 4 OCPUs, videos are made about twice as fast. Saving an edited script is quicker, because the voice and captions for unchanged lines are reused.
- **Memory.** Making the test video used at most about 2 GB of memory, so 12 GB is plenty.
- **Oracle can reclaim idle servers.** Oracle may reclaim an Always Free server that looks idle for 7 days: under 20% CPU, network and memory use most of the time. A video maker that is used now and then can look idle. Make a video at least once a week, keep a recent backup, and check your Oracle email. Oracle's page does not say whether this applies after you upgrade to Pay As You Go.
- **Capacity.** Free Ampere servers are sometimes unavailable in busy regions. If creating the server fails, try another availability domain, try again later, or pick another home region when you sign up.
- **One machine.** There is no second server to take over if this one fails. Keep backups (see above).
- **Security updates.** Ubuntu installs security updates by itself. Run `sudo apt-get upgrade -y` now and then, and update the app (see above) to pick up new versions of Chrome and the other parts of the image.
- **Rendering differs slightly from the Mac.** The server uses Chromium on Linux, so frames are not pixel-for-pixel the same as videos made on your Mac. Videos made on the same server are the same each time.

## If something goes wrong

| Problem | What to check |
| --- | --- |
| The site does not load | `docker compose ps` shows both containers running. Ports 80 and 443 are open in the security list and the server firewall (step 3) |
| The sign-in page says the password is not right | `APP_PASSWORD` in `.env`. After changing it, run `docker compose up -d` |
| No HTTPS certificate | The web address points at `YOUR_IP`, port 80 is open, then `docker compose logs caddy` |
| Briefs fail with an API error | `ANTHROPIC_API_KEY` in `.env`, and the spend limit in the Anthropic Console |
| Anything else | `docker compose logs app --tail 100` and `docker compose exec app npm run doctor` |
