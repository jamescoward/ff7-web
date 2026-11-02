# FF7 Web Runtime

A hobby project to play the original **Final Fantasy VII (USA, PS1)** on an iPhone with touch controls designed for the game. You bring your own disc; this repository contains no game data.

**Status:** Phase 0 research done; nothing built yet. Next is Experiment 01, an iPhone performance baseline using homebrew test programs.

**Approach in one line:** the PCSX ReARMed PS1 emulator in WebAssembly, plus a layer that reads the game's state from memory and turns taps into controller input, plus a touch UI built around the original picture.

## Read next
- `docs/PHASE0.md`: the plan and milestones.
- `docs/ARCHITECTURE_SURVEY.md`: options compared, with sources and commit hashes.
- `docs/EXPERIMENT_01_IPHONE_BASELINE.md`: the first experiment.
- `docs/SECURITY.md`: rules for game data.
- `CLAUDE.md`: rules for coding agents.

## Not affiliated
Not affiliated with or endorsed by Square Enix or Sony. You must own the game. No game files, BIOS images, screenshots or code derived from the game are distributed here.
