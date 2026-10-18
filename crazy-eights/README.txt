OpenGameGallery — Crazy Eights Alpha

Files in this folder:
- crazy-eights.html
- crazy-eights.js
- crazy-eights-ai.js

Installation:
1. Copy the crazy-eights folder into the root of the OpenGameGallery repository.
2. Replace the repository's library.json with the library.json included at the root of this ZIP.
3. Commit and publish the changes through your usual GitHub Pages workflow.

Implemented rules:
- 2–8 players, with local human players and computer opponents.
- 7 cards each for a 2-player game; 5 cards each for 3–8 players.
- Match the top discard by rank or suit; eights are wild and let the player choose a suit.
- Draw one card when unable to play; a drawn playable card may be played immediately.
- First player to empty their hand wins the round.
- Remaining cards score penalty points (8=50, J/Q/K=10, Ace=1, others face value); lowest total wins when a player reaches 100.
- Local multi-human turn handoff uses a full-screen black overlay for two seconds.

This is an initial Alpha. It has not been fully browser-playtested. Online play is not implemented.
