-- Returns a new independent scheduler instance.
-- start(fn) — spawn fn as a managed coroutine, running it to its first yield.
-- tick(event) — forward one CC event to all threads whose filter matches.
-- is_idle() — true when no threads are alive.

return function()
    local threads = {}

    local function start(fn)
        local co = coroutine.create(fn)
        local ok, filter = coroutine.resume(co)
        if not ok then
            print("[scheduler] start error: " .. tostring(filter))
        elseif coroutine.status(co) ~= "dead" then
            table.insert(threads, { co = co, filter = filter })
        end
    end

    local function tick(event)
        local alive = {}
        for _, t in ipairs(threads) do
            if t.filter == nil or t.filter == event[1] then
                local ok, filter = coroutine.resume(t.co, table.unpack(event))
                if not ok then
                    print("[scheduler] thread error: " .. tostring(filter))
                elseif coroutine.status(t.co) ~= "dead" then
                    table.insert(alive, { co = t.co, filter = filter })
                end
            else
                table.insert(alive, t)
            end
        end
        threads = alive
    end

    local function is_idle()
        return #threads == 0
    end

    return { start = start, tick = tick, is_idle = is_idle }
end
