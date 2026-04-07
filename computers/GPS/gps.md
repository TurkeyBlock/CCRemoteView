# gps API

Use modems to locate the position of the current turtle or computer.

Communicates with GPS host computers that know their position, measures distances via `modem_message`, and uses trilateration to derive coordinates.

> Added in version 1.31

See also: [GPS Constellation Setup](README.md)

---

## Constants

### `CHANNEL_GPS = 65534`

The channel on which GPS requests and responses are broadcast.

---

## Functions

### `gps.locate([timeout=2 [, debug=false]])`

Tries to retrieve the computer or turtle's own location.

**Parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `timeout` | number | `2` | Maximum seconds to wait for a position fix |
| `debug` | boolean | `false` | Print debugging messages |

**Returns**

- `number, number, number` — The computer's `x`, `y`, `z` position.
- `nil` — If the position could not be established.

**Example**

```lua
local x, y, z = gps.locate()
if x then
    print("Position: " .. x .. ", " .. y .. ", " .. z)
else
    print("Could not determine position")
end
```
