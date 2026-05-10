# GPS Constellation Setup

The GPS API lets a computer find its position using a wireless modem. It communicates with GPS host computers that already know their position, measures distances via `modem_message`, and uses trilateration to calculate its own coordinates.

## Prerequisites

- 4 computers
- 4 Ender Modems (normal wireless modems work but have very limited range)
- 1 additional computer + wireless modem to test

## Choosing a Location

Build your constellation inside a **10x10x10 cube** (minimum 5x5x5). Larger constellations are more accurate over long distances. All four hosts must be chunk-loaded at all times — consider using spawn chunks or a permanently loaded chunk. Use **F3+G** to view chunk boundaries.

## Building the Constellation

1. Place a computer in one corner of your cube with a modem on top.
2. Place two more computers in the two adjacent corners, each with a modem on top.
3. Pillar up to the top of the cube directly above the first computer, and place the fourth computer with a modem.

Each host must differ in position on at least one axis from the others.

## Configuring Each Host

1. Press **F3** and look at the computer to find its coordinates under **Targeted Block**.
2. Open the computer and run `edit startup.lua`.
3. Enter the following, replacing `x`, `y`, `z` with the block's coordinates:
   ```lua
   shell.run("gps", "host", x, y, z)
   ```
4. Save and reboot the computer (**Ctrl+R** or run `reboot`).
5. Repeat for all four computers.

## Testing

Place a computer nearby with a wireless modem and run `gps locate`, or call `gps.locate()` in code.
