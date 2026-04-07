-- Minecart Computer startup
-- Loads the capi and launches the main remote control loop.
-- GPS must be available before starting — location is required for all reporting.

os.loadAPI("capi")

print("Checking GPS...")
local x, y, z = gps.locate(5)
if not x then
  print("! GPS unavailable. Cannot start — no location fix.")
  print("Ensure GPS hosts are running and a wireless modem is attached.")
  return
end
print("GPS OK: " .. x .. ", " .. y .. ", " .. z)

shell.run("rcMinecart")
