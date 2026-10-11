# imgbrd

A custom Booru browser featuring infinite scrolling, tag search, score filtering, random sorting, and saved tag collections.
Built-in boards: guro.booru.org, gelbooru.com, booru.eu, rule34.xxx, xbooru.com, allgirl.booru.org, zoo.booru.org. Additional boards can be added through the interface.

# Getting Started

Double-click imgbrd.exe in the project folder. No window will appear. A yellow ib icon will appear in the system tray next to the clock. Right-clicking it provides the options Open in Browser and Quit. Double-clicking the icon opens the page.

The page is then accessible at http://localhost:4178 and on your local network at, for example, http://[Server-IP]:4178.


# Notes on the Boards

Gelbooru 0.2 (rule34, gelbooru, xbooru) supports server-side sorting by newest, score, and random.

booru.eu (Shimmie) sorts by score. Random mode selects random result pages because order:random returns no results there.

The older booru.org sites can only sort by score within a loaded page and do not support true random search. Random mode jumps to random pages instead.

Custom boards require a publicly accessible HTTP(S) address and one of the following types: Gelbooru 0.2, Gelbooru 0.1, Shimmie, or Danbooru. If the API host differs from the page host, enter it separately, as with https://api.rule34.xxx for rule34.

Tag collections, custom boards, and saved API keys can be exported as JSON. The file contains the access credentials.


# Android App
The Android app is also very simple.
It directly requests the images from the websites. There are NO ads, no premium/payed features. Just install and enjoy.
You may need to click "allow this source" when installing an app from an apk file for the first time.
Everything else works the same as the desktop version.

# Languages
It's default language is english. It should also be fine in German, french and spanish. I made this with cursorAI and the translation too, so don't blame me lol.

# Made with CursorAI
I made the whole thing in half a day with CursorAI. I am not a programmer and I don't have specific plans for the future of this.
This may never get an update.

# Donation
If you like it and want to thank me:
https://buymeacoffee.com/nervine141
