# Turn on the automatic app build

GitHub builds the app on its own machines and publishes it for the mini PC to download. To switch that on, you add one file. GitHub only lets the account owner add it, so it is a quick job for you on the website.

## 1. Add the build file (1 minute)

1. Make sure you are signed in to GitHub as **jasontheodorou**.
2. Open this link. It opens a new file called `.github/workflows/image.yml`, already filled in:

   **[Create the build file](https://github.com/jasontheodorou/video-maker/new/main?filename=.github/workflows/image.yml&value=%23%20Builds%20the%20app%20image%20for%20Intel/AMD%20and%20Arm%20on%20GitHub%27s%20own%20machines%20and%20publishes%20it%20as%0A%23%20ghcr.io/jasontheodorou/video-maker%3Alatest%2C%20which%20%22./video-maker%20install%22%20and%20%22./video-maker%20update%22%20download.%0Aname%3A%20Build%20the%20app%20image%0A%0Aon%3A%0A%20%20push%3A%0A%20%20%20%20branches%3A%20%5Bmain%5D%0A%20%20%20%20paths-ignore%3A%20%5B%22%2A%2A.md%22%2C%20%22docs/%2A%2A%22%2C%20%22install.sh%22%2C%20%22home-server/%2A%2A%22%5D%0A%20%20workflow_dispatch%3A%0A%0Apermissions%3A%0A%20%20contents%3A%20read%0A%20%20packages%3A%20write%0A%0Aenv%3A%0A%20%20IMAGE%3A%20ghcr.io/%24%7B%7B%20github.repository%20%7D%7D%0A%0Ajobs%3A%0A%20%20build%3A%0A%20%20%20%20strategy%3A%0A%20%20%20%20%20%20fail-fast%3A%20false%0A%20%20%20%20%20%20matrix%3A%0A%20%20%20%20%20%20%20%20include%3A%0A%20%20%20%20%20%20%20%20%20%20-%20platform%3A%20linux/amd64%0A%20%20%20%20%20%20%20%20%20%20%20%20runner%3A%20ubuntu-24.04%0A%20%20%20%20%20%20%20%20%20%20-%20platform%3A%20linux/arm64%0A%20%20%20%20%20%20%20%20%20%20%20%20runner%3A%20ubuntu-24.04-arm%0A%20%20%20%20runs-on%3A%20%24%7B%7B%20matrix.runner%20%7D%7D%0A%20%20%20%20timeout-minutes%3A%20120%0A%20%20%20%20steps%3A%0A%20%20%20%20%20%20%23%20The%20image%20is%20about%204.4%20GB%2C%20so%20clear%20tools%20this%20build%20does%20not%20use.%0A%20%20%20%20%20%20-%20name%3A%20Free%20disk%20space%0A%20%20%20%20%20%20%20%20run%3A%20sudo%20rm%20-rf%20/usr/share/dotnet%20/usr/local/lib/android%20/opt/ghc%20/opt/hostedtoolcache/CodeQL%20%26%26%20df%20-h%20/%0A%0A%20%20%20%20%20%20-%20uses%3A%20actions/checkout%40v4%0A%0A%20%20%20%20%20%20-%20uses%3A%20docker/setup-buildx-action%40v3%0A%0A%20%20%20%20%20%20-%20uses%3A%20docker/login-action%40v3%0A%20%20%20%20%20%20%20%20with%3A%0A%20%20%20%20%20%20%20%20%20%20registry%3A%20ghcr.io%0A%20%20%20%20%20%20%20%20%20%20username%3A%20%24%7B%7B%20github.actor%20%7D%7D%0A%20%20%20%20%20%20%20%20%20%20password%3A%20%24%7B%7B%20secrets.GITHUB_TOKEN%20%7D%7D%0A%0A%20%20%20%20%20%20-%20name%3A%20Build%20and%20push%20by%20digest%0A%20%20%20%20%20%20%20%20id%3A%20build%0A%20%20%20%20%20%20%20%20uses%3A%20docker/build-push-action%40v6%0A%20%20%20%20%20%20%20%20with%3A%0A%20%20%20%20%20%20%20%20%20%20context%3A%20.%0A%20%20%20%20%20%20%20%20%20%20platforms%3A%20%24%7B%7B%20matrix.platform%20%7D%7D%0A%20%20%20%20%20%20%20%20%20%20labels%3A%20%7C%0A%20%20%20%20%20%20%20%20%20%20%20%20org.opencontainers.image.source%3Dhttps%3A//github.com/%24%7B%7B%20github.repository%20%7D%7D%0A%20%20%20%20%20%20%20%20%20%20%20%20org.opencontainers.image.description%3DThe%20video%20maker%3A%20plain-English%20briefs%20in%2C%20on-brand%20MP4s%20out.%0A%20%20%20%20%20%20%20%20%20%20outputs%3A%20type%3Dimage%2Cname%3D%24%7B%7B%20env.IMAGE%20%7D%7D%2Cpush-by-digest%3Dtrue%2Cname-canonical%3Dtrue%2Cpush%3Dtrue%0A%20%20%20%20%20%20%20%20%20%20cache-from%3A%20type%3Dgha%2Cscope%3D%24%7B%7B%20matrix.platform%20%7D%7D%0A%20%20%20%20%20%20%20%20%20%20cache-to%3A%20type%3Dgha%2Cmode%3Dmax%2Cscope%3D%24%7B%7B%20matrix.platform%20%7D%7D%0A%0A%20%20%20%20%20%20-%20name%3A%20Keep%20the%20digest%0A%20%20%20%20%20%20%20%20run%3A%20%7C%0A%20%20%20%20%20%20%20%20%20%20mkdir%20-p%20/tmp/digests%0A%20%20%20%20%20%20%20%20%20%20d%3D%22%24%7B%7B%20steps.build.outputs.digest%20%7D%7D%22%0A%20%20%20%20%20%20%20%20%20%20touch%20%22/tmp/digests/%24%7Bd%23sha256%3A%7D%22%0A%0A%20%20%20%20%20%20-%20uses%3A%20actions/upload-artifact%40v4%0A%20%20%20%20%20%20%20%20with%3A%0A%20%20%20%20%20%20%20%20%20%20name%3A%20digest-%24%7B%7B%20matrix.runner%20%7D%7D%0A%20%20%20%20%20%20%20%20%20%20path%3A%20/tmp/digests/%2A%0A%20%20%20%20%20%20%20%20%20%20retention-days%3A%201%0A%0A%20%20publish%3A%0A%20%20%20%20needs%3A%20build%0A%20%20%20%20runs-on%3A%20ubuntu-24.04%0A%20%20%20%20steps%3A%0A%20%20%20%20%20%20-%20uses%3A%20actions/download-artifact%40v4%0A%20%20%20%20%20%20%20%20with%3A%0A%20%20%20%20%20%20%20%20%20%20path%3A%20/tmp/digests%0A%20%20%20%20%20%20%20%20%20%20pattern%3A%20digest-%2A%0A%20%20%20%20%20%20%20%20%20%20merge-multiple%3A%20true%0A%0A%20%20%20%20%20%20-%20uses%3A%20docker/setup-buildx-action%40v3%0A%0A%20%20%20%20%20%20-%20uses%3A%20docker/login-action%40v3%0A%20%20%20%20%20%20%20%20with%3A%0A%20%20%20%20%20%20%20%20%20%20registry%3A%20ghcr.io%0A%20%20%20%20%20%20%20%20%20%20username%3A%20%24%7B%7B%20github.actor%20%7D%7D%0A%20%20%20%20%20%20%20%20%20%20password%3A%20%24%7B%7B%20secrets.GITHUB_TOKEN%20%7D%7D%0A%0A%20%20%20%20%20%20-%20name%3A%20Tag%20both%20builds%20as%20latest%0A%20%20%20%20%20%20%20%20working-directory%3A%20/tmp/digests%0A%20%20%20%20%20%20%20%20run%3A%20%7C%0A%20%20%20%20%20%20%20%20%20%20docker%20buildx%20imagetools%20create%20%5C%0A%20%20%20%20%20%20%20%20%20%20%20%20-t%20%22%24IMAGE%3Alatest%22%20-t%20%22%24IMAGE%3A%24%7BGITHUB_SHA%3A%3A7%7D%22%20%5C%0A%20%20%20%20%20%20%20%20%20%20%20%20%24%28printf%20%22%24IMAGE%40sha256%3A%25s%20%22%20%2A%29%0A%20%20%20%20%20%20%20%20%20%20docker%20buildx%20imagetools%20inspect%20%22%24IMAGE%3Alatest%22%0A)**

3. Click the green **Commit changes...** button, then **Commit changes** again.

If the file opens empty, copy everything in the box at the end of this page into it, then commit.

## 2. Wait for the first build (30 to 60 minutes)

The build starts by itself. Watch it on the **[Actions page](https://github.com/jasontheodorou/video-maker/actions)**. A green tick means it worked. Later builds are faster, because GitHub keeps a cache.

## 3. Make the app public (1 minute, once)

GitHub keeps a new app image private, even in a public repo. After the first green tick:

1. Open the **[package settings](https://github.com/users/jasontheodorou/packages/container/video-maker/settings)**.
2. Scroll to **Danger Zone** and click **Change visibility**.
3. Choose **Public**, type `video-maker` to confirm, and click the button.

## 4. Install on the mini PC

```
curl -fsSL https://raw.githubusercontent.com/jasontheodorou/video-maker/main/install.sh | bash
```

## The build file

```yaml
# Builds the app image for Intel/AMD and Arm on GitHub's own machines and publishes it as
# ghcr.io/jasontheodorou/video-maker:latest, which "./video-maker install" and "./video-maker update" download.
name: Build the app image

on:
  push:
    branches: [main]
    paths-ignore: ["**.md", "docs/**", "install.sh", "home-server/**"]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

env:
  IMAGE: ghcr.io/${{ github.repository }}

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: linux/amd64
            runner: ubuntu-24.04
          - platform: linux/arm64
            runner: ubuntu-24.04-arm
    runs-on: ${{ matrix.runner }}
    timeout-minutes: 120
    steps:
      # The image is about 4.4 GB, so clear tools this build does not use.
      - name: Free disk space
        run: sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /opt/hostedtoolcache/CodeQL && df -h /

      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push by digest
        id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: ${{ matrix.platform }}
          labels: |
            org.opencontainers.image.source=https://github.com/${{ github.repository }}
            org.opencontainers.image.description=The video maker: plain-English briefs in, on-brand MP4s out.
          outputs: type=image,name=${{ env.IMAGE }},push-by-digest=true,name-canonical=true,push=true
          cache-from: type=gha,scope=${{ matrix.platform }}
          cache-to: type=gha,mode=max,scope=${{ matrix.platform }}

      - name: Keep the digest
        run: |
          mkdir -p /tmp/digests
          d="${{ steps.build.outputs.digest }}"
          touch "/tmp/digests/${d#sha256:}"

      - uses: actions/upload-artifact@v4
        with:
          name: digest-${{ matrix.runner }}
          path: /tmp/digests/*
          retention-days: 1

  publish:
    needs: build
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: /tmp/digests
          pattern: digest-*
          merge-multiple: true

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Tag both builds as latest
        working-directory: /tmp/digests
        run: |
          docker buildx imagetools create \
            -t "$IMAGE:latest" -t "$IMAGE:${GITHUB_SHA::7}" \
            $(printf "$IMAGE@sha256:%s " *)
          docker buildx imagetools inspect "$IMAGE:latest"
```
