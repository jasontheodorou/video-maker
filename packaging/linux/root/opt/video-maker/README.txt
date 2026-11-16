Video Maker

Open it from the Video Maker icon in your apps.

The first time, it asks you to choose the team password, and for your Anthropic API key. You can change both
later on the Settings page. The Settings page also turns the team link on and off.

It runs in the background all the time, and starts by itself when the computer starts.

Videos, brands and settings are kept in /var/lib/video-maker. Uninstalling the app keeps them.

If something goes wrong:
  systemctl status video-maker          is it running?
  journalctl -u video-maker -n 100      what it did last
  sudo systemctl restart video-maker    restart it
