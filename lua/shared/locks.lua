-- Singleton: require() caches this table, so all callers share one lock namespace.
-- This is intentional — locks guard physical turtle/world state that is global to
-- the computer regardless of how many rc_loop instances are running.
local held = {}

local function is_available(names)
    for _, name in ipairs(names) do
        if held[name] then return false end
    end
    return true
end

local function acquire(names)
    while not is_available(names) do
        os.pullEvent("lock_released")
    end
    for _, name in ipairs(names) do
        held[name] = true
    end
end

local function release(names)
    for _, name in ipairs(names) do
        held[name] = false
    end
    os.queueEvent("lock_released")
end

return { acquire = acquire, release = release, is_available = is_available }
