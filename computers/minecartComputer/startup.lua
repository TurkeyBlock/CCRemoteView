-- Minecart Computer startup
-- Downloads the latest minecart computer files and launches the remote control loop.
-- GPS must be available before starting — location is required for all reporting.

-- !MUST END WITH '/computers/minecartComputer/'
base_url = "http://turtles.turkeyblock.org/"

function Split(s, delimiter)
  result = {}
  for match in (s..delimiter):gmatch("(.-)"..delimiter) do
    table.insert(result, match)
  end
  return result
end

local function get_files_from_server()
  local files = { "capi", "rcMinecart.lua", "startup.lua" }
  term.write("autoupdate...")
  for _, name in ipairs(files) do
    local url = base_url .. "computers/minecartComputer/" .. name
    local res = http.get(url, nil)
    while not res do
      print("Error on GET " .. url .. " - retrying in 5 seconds")
      sleep(5)
      res = http.get(url, nil)
    end
    local f = fs.open(name, "w")
    f.write(res.readAll())
    f.close()
    res.close()
    if name == "startup.lua" then
      if fs.exists("backup") then
        fs.delete("backup/startup.lua")
      else
        fs.makeDir("backup")
      end
      if fs.exists("startup.lua") then
        fs.copy("startup.lua", "backup/startup.lua")
      end
    end
  end
  term.write("complete\n")
end

get_files_from_server()

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
