import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import './app.css';
import { promptAdd, promptListBefore, promptListLatest, scAdd, scListBefore, scListLatest } from './lib/db';

function App() {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'rendezvous' | 'rfqs' | 'invites' | 'swaps' | 'refunds' | 'wallets' | 'peers' | 'audit' | 'settings'
  >('overview');

  const [promptOpen, setPromptOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(true);

  const [health, setHealth] = useState<{ ok: boolean; ts: number } | null>(null);
  const [tools, setTools] = useState<Array<any> | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [runMode, setRunMode] = useState<'tool' | 'llm'>('tool');

  const [scConnected, setScConnected] = useState(false);
  const [scFollowTail, setScFollowTail] = useState(true);
  const [scChannels, setScChannels] = useState<string>('0000intercomswapbtcusdt');
  const [scFilter, setScFilter] = useState<{ channel: string; kind: string }>({ channel: '', kind: '' });

  const [selected, setSelected] = useState<any>(null);

  const [promptInput, setPromptInput] = useState('');
  const [toolName, setToolName] = useState('');
  const [toolArgsText, setToolArgsText] = useState('{\n  \n}');

  const [promptEvents, setPromptEvents] = useState<any[]>([]);
  const [scEvents, setScEvents] = useState<any[]>([]);
  const scEventsMax = 3000;
  const promptEventsMax = 3000;

  const scAbortRef = useRef<AbortController | null>(null);
  const promptAbortRef = useRef<AbortController | null>(null);

  const scListRef = useRef<HTMLDivElement | null>(null);
  const promptListRef = useRef<HTMLDivElement | null>(null);

  const scLoadingOlderRef = useRef(false);
  const promptLoadingOlderRef = useRef(false);

  const scFollowTailRef = useRef(scFollowTail);
  useEffect(() => {
    scFollowTailRef.current = scFollowTail;
  }, [scFollowTail]);

  const filteredScEvents = useMemo(() => {
    const chan = scFilter.channel.trim();
    const kind = scFilter.kind.trim();
    return scEvents.filter((e) => {
      if (chan && String(e.channel || '') !== chan) return false;
      if (kind && String(e.kind || '') !== kind) return false;
      return true;
    });
  }, [scEvents, scFilter]);

  const rfqEvents = useMemo(() => {
    return filteredScEvents.filter((e) => String(e.kind || '') === 'swap.rfq');
  }, [filteredScEvents]);

  const inviteEvents = useMemo(() => {
    return filteredScEvents.filter((e) => String(e.kind || '') === 'swap.swap_invite');
  }, [filteredScEvents]);

  function oldestDbId(list: any[]) {
    let min = Number.POSITIVE_INFINITY;
    for (const e of list) {
      const id = typeof e?.db_id === 'number' ? e.db_id : null;
      if (id !== null && Number.isFinite(id) && id < min) min = id;
    }
    return Number.isFinite(min) ? min : null;
  }

  async function loadOlderScEvents({ limit = 200 } = {}) {
    if (scLoadingOlderRef.current) return;
    const beforeId = oldestDbId(scEvents);
    if (!beforeId) return;
    scLoadingOlderRef.current = true;
    const el = scListRef.current;
    const prevHeight = el ? el.scrollHeight : 0;
    const prevTop = el ? el.scrollTop : 0;
    try {
      const older = await scListBefore({ beforeId, limit });
      if (!older || older.length === 0) return;
      const mapped = older.map((r) => ({ ...(r.evt || {}), db_id: r.id }));
      setScEvents((prev) => {
        const seen = new Set(prev.map((e) => e?.db_id).filter((n) => typeof n === 'number'));
        const toAdd = mapped.filter((e) => typeof e?.db_id === 'number' && !seen.has(e.db_id));
        const next = toAdd.concat(prev);
        if (next.length <= scEventsMax) return next;
        // If we’re scrolling back, keep older window and drop the newest.
        return next.slice(0, scEventsMax);
      });
      requestAnimationFrame(() => {
        const el2 = scListRef.current;
        if (!el2) return;
        const delta = el2.scrollHeight - prevHeight;
        if (delta > 0) el2.scrollTop = prevTop + delta;
      });
    } finally {
      scLoadingOlderRef.current = false;
    }
  }

  async function loadOlderPromptEvents({ limit = 200 } = {}) {
    if (promptLoadingOlderRef.current) return;
    const beforeId = oldestDbId(promptEvents);
    if (!beforeId) return;
    promptLoadingOlderRef.current = true;
    const el = promptListRef.current;
    const prevHeight = el ? el.scrollHeight : 0;
    const prevTop = el ? el.scrollTop : 0;
    try {
      const older = await promptListBefore({ beforeId, limit });
      if (!older || older.length === 0) return;
      const mapped = older.map((r) => ({ ...(r.evt || {}), db_id: r.id }));
      setPromptEvents((prev) => {
        const seen = new Set(prev.map((e) => e?.db_id).filter((n) => typeof n === 'number'));
        const toAdd = mapped.filter((e) => typeof e?.db_id === 'number' && !seen.has(e.db_id));
        const next = toAdd.concat(prev);
        if (next.length <= promptEventsMax) return next;
        return next.slice(0, promptEventsMax);
      });
      requestAnimationFrame(() => {
        const el2 = promptListRef.current;
        if (!el2) return;
        const delta = el2.scrollHeight - prevHeight;
        if (delta > 0) el2.scrollTop = prevTop + delta;
      });
    } finally {
      promptLoadingOlderRef.current = false;
    }
  }

  function normalizeToolList(raw: any): Array<{ name: string; description: string; parameters: any }> {
    const list = Array.isArray(raw?.tools) ? raw.tools : Array.isArray(raw) ? raw : [];
    const out: Array<{ name: string; description: string; parameters: any }> = [];
    for (const t of list) {
      const fn = t?.function;
      const name = String(fn?.name || '').trim();
      if (!name) continue;
      out.push({
        name,
        description: String(fn?.description || '').trim(),
        parameters: fn?.parameters ?? null,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  async function fetchJson(path: string, init?: RequestInit) {
    const res = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
    }
    return await res.json();
  }

  async function refreshHealth() {
    try {
      const out = await fetchJson('/healthz', { method: 'GET', headers: {} });
      setHealth({ ok: Boolean(out?.ok), ts: Date.now() });
    } catch (_e) {
      setHealth({ ok: false, ts: Date.now() });
    }
  }

  async function refreshTools() {
    try {
      const out = await fetchJson('/v1/tools', { method: 'GET' });
      const list = normalizeToolList(out);
      setTools(list);
      if (!toolName && list.length > 0) setToolName(list[0].name);
    } catch (err: any) {
      setTools(null);
      void appendPromptEvent(
        { type: 'ui', ts: Date.now(), message: `tools fetch failed (promptd offline?): ${err?.message || String(err)}` },
        { persist: false }
      );
    }
  }

  async function appendPromptEvent(evt: any, { persist = true } = {}) {
    const e = evt && typeof evt === 'object' ? evt : { type: 'event', evt };
    const ts = typeof e.ts === 'number' ? e.ts : Date.now();
    const sid = String(e.session_id || sessionId || '');
    const type = String(e.type || 'event');
    let dbId: number | null = null;
    if (persist) {
      try {
        dbId = await promptAdd({ ts, session_id: sid, type, evt: e });
      } catch (_e) {}
    }
    setPromptEvents((prev) => {
      const next = prev.concat([{ ...e, db_id: dbId }]);
      if (next.length <= promptEventsMax) return next;
      return next.slice(next.length - promptEventsMax);
    });
  }

  async function appendScEvent(evt: any, { persist = true } = {}) {
    const e = evt && typeof evt === 'object' ? evt : { type: 'event', evt };
    const ts = typeof e.ts === 'number' ? e.ts : Date.now();
    const channel = String(e.channel || '');
    const kind = String(e.kind || '');
    const trade_id = String(e.trade_id || '');
    const seq = typeof e.seq === 'number' ? e.seq : null;
    let dbId: number | null = null;
    if (persist && e.type === 'sc_event') {
      try {
        dbId = await scAdd({ ts, channel, kind, trade_id, seq, evt: e });
      } catch (_e) {}
    }
    setScEvents((prev) => {
      const next = prev.concat([{ ...e, db_id: dbId }]);
      if (next.length <= scEventsMax) return next;
      return next.slice(next.length - scEventsMax);
    });
  }

  function deriveKindTrade(msg: any) {
    if (!msg || typeof msg !== 'object') return { kind: '', trade_id: '' };
    const kind = typeof msg.kind === 'string' ? msg.kind : '';
    const trade_id = typeof msg.trade_id === 'string' ? msg.trade_id : '';
    return { kind, trade_id };
  }

  async function startScStream() {
    if (scAbortRef.current) scAbortRef.current.abort();
    const ac = new AbortController();
    scAbortRef.current = ac;

    const channels = scChannels
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
    const url = new URL('/v1/sc/stream', window.location.origin);
    if (channels.length > 0) url.searchParams.set('channels', channels.join(','));
    url.searchParams.set('backlog', '250');

    setScConnected(true);
    await appendScEvent({ type: 'ui', ts: Date.now(), message: `sc/stream connecting (${channels.length || 'all'})...` }, { persist: false });

    try {
      const res = await fetch(url.toString(), { method: 'GET', signal: ac.signal });
      if (!res.ok || !res.body) throw new Error(`sc/stream failed: ${res.status}`);
      const reader = res.body.getReader();
      const td = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += td.decode(value, { stream: true });
        while (true) {
          const idx = buf.indexOf('\n');
          if (idx < 0) break;
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let obj: any = null;
          try {
            obj = JSON.parse(line);
          } catch (_e) {
            await appendScEvent({ type: 'parse_error', ts: Date.now(), line }, { persist: false });
            continue;
          }
          if (obj.type === 'sc_event') {
            const msg = obj.message;
            const d = deriveKindTrade(msg);
            await appendScEvent({ ...obj, ...d }, { persist: true });
          } else {
            await appendScEvent(obj, { persist: false });
          }
        }
      }
    } catch (err: any) {
      await appendScEvent({ type: 'error', ts: Date.now(), error: err?.message || String(err) }, { persist: false });
    } finally {
      setScConnected(false);
    }
  }

  function stopScStream() {
    if (scAbortRef.current) scAbortRef.current.abort();
    scAbortRef.current = null;
    setScConnected(false);
    void appendScEvent({ type: 'ui', ts: Date.now(), message: 'sc/stream stopped' }, { persist: false });
  }

  async function runPromptStream(payload: any) {
    if (promptAbortRef.current) promptAbortRef.current.abort();
    const ac = new AbortController();
    promptAbortRef.current = ac;

    await appendPromptEvent({ type: 'ui', ts: Date.now(), message: 'run starting...' }, { persist: false });

    try {
      const res = await fetch('/v1/run/stream', {
        method: 'POST',
        signal: ac.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) throw new Error(`run failed: ${res.status}`);

      const reader = res.body.getReader();
      const td = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += td.decode(value, { stream: true });
        while (true) {
          const idx = buf.indexOf('\n');
          if (idx < 0) break;
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let obj: any = null;
          try {
            obj = JSON.parse(line);
          } catch (_e) {
            await appendPromptEvent({ type: 'parse_error', ts: Date.now(), line }, { persist: false });
            continue;
          }
          if (obj.type === 'run_start' && obj.session_id) setSessionId(String(obj.session_id));
          await appendPromptEvent(obj, { persist: true });
        }
      }
    } catch (err: any) {
      await appendPromptEvent({ type: 'error', ts: Date.now(), error: err?.message || String(err) }, { persist: false });
    }
  }

  async function onRun() {
    if (runMode === 'tool') {
      const name = toolName.trim();
      if (!name) return;
      let args: any = null;
      try {
        args = toolArgsText.trim() ? JSON.parse(toolArgsText) : {};
      } catch (e: any) {
        void appendPromptEvent({ type: 'error', ts: Date.now(), error: `Invalid JSON args: ${e?.message || String(e)}` }, { persist: false });
        return;
      }
      const directToolPrompt = {
        type: 'tool',
        name,
        arguments: args && typeof args === 'object' ? args : {},
      };
      await runPromptStream({
        prompt: JSON.stringify(directToolPrompt),
        session_id: sessionId,
        auto_approve: autoApprove,
        dry_run: false,
      });
      return;
    }

    const p = promptInput.trim();
    if (!p) return;
    await runPromptStream({
      prompt: p,
      session_id: sessionId,
      auto_approve: autoApprove,
      dry_run: false,
    });
  }

  useEffect(() => {
    refreshHealth();
    refreshTools();
    const t = setInterval(refreshHealth, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load recent history from local IndexedDB (memory-safe; DOM is virtualized).
  useEffect(() => {
    (async () => {
      try {
        const sc = await scListLatest({ limit: 400 });
        setScEvents(sc.map((r) => ({ ...(r.evt || {}), db_id: r.id })));
      } catch (_e) {}
      try {
        const pe = await promptListLatest({ limit: 300 });
        setPromptEvents(pe.map((r) => ({ ...(r.evt || {}), db_id: r.id })));
      } catch (_e) {}
    })();
  }, []);

  useEffect(() => {
    if (!scFollowTail) return;
    const el = scListRef.current;
    if (!el) return;
    // scroll to bottom when new events appended
    el.scrollTop = el.scrollHeight;
  }, [scEvents, scFollowTail]);

  const onScScroll = () => {
    const cur = scListRef.current;
    if (!cur) return;
    const atBottom = cur.scrollHeight - cur.scrollTop - cur.clientHeight < 120;
    if (!atBottom && scFollowTailRef.current) setScFollowTail(false);
    if (cur.scrollTop < 140) void loadOlderScEvents({ limit: 250 });
  };

  const onPromptScroll = () => {
    const cur = promptListRef.current;
    if (!cur) return;
    if (cur.scrollTop < 140) void loadOlderPromptEvents({ limit: 250 });
  };

  return (
    <div
      className={`shell ${promptOpen ? 'prompt-open' : 'prompt-closed'} ${navOpen ? 'nav-open' : 'nav-closed'} ${
        inspectorOpen ? 'inspector-open' : 'inspector-closed'
      }`}
    >
      <header className="topbar">
        <div className="topbar-left">
          <button className="iconbtn" onClick={() => setNavOpen((v) => !v)} aria-label="Toggle navigation">
            ☰
          </button>
          <div className="logo">
            <AnimatedLogo text="Collin" tagline="control center" />
          </div>
        </div>
        <div className="topbar-mid">
          <div className="statusline">
            <StatusPill label="promptd" state={health?.ok ? 'ok' : 'bad'} />
            <StatusPill label="sc/stream" state={scConnected ? 'ok' : 'idle'} />
            <StatusPill label="mode" state="neutral" value={runMode.toUpperCase()} />
            <span className="muted small">{health ? new Date(health.ts).toLocaleTimeString() : '...'}</span>
          </div>
          <div className="quick">
            <button className="btn" onClick={refreshTools}>
              Reload tools
            </button>
            <button className="btn" onClick={() => setInspectorOpen((v) => !v)}>
              {inspectorOpen ? 'Hide' : 'Show'} inspector
            </button>
          </div>
        </div>
        <div className="topbar-right">
          <button className="btn primary" onClick={() => setPromptOpen((v) => !v)}>
            {promptOpen ? 'Collapse' : 'Open'} console
          </button>
        </div>
      </header>

      {navOpen ? (
        <aside className="nav">
          <nav className="nav-inner">
            <NavButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} label="Overview" />
            <NavButton
              active={activeTab === 'rendezvous'}
              onClick={() => setActiveTab('rendezvous')}
              label="Rendezvous"
            />
            <NavButton active={activeTab === 'rfqs'} onClick={() => setActiveTab('rfqs')} label="RFQs" badge={rfqEvents.length} />
            <NavButton
              active={activeTab === 'invites'}
              onClick={() => setActiveTab('invites')}
              label="Invites"
              badge={inviteEvents.length}
            />
            <NavButton active={activeTab === 'swaps'} onClick={() => setActiveTab('swaps')} label="Swaps" />
            <NavButton active={activeTab === 'refunds'} onClick={() => setActiveTab('refunds')} label="Refunds" />
            <NavButton active={activeTab === 'wallets'} onClick={() => setActiveTab('wallets')} label="Wallets" />
            <NavButton active={activeTab === 'peers'} onClick={() => setActiveTab('peers')} label="Peers" />
            <NavButton active={activeTab === 'audit'} onClick={() => setActiveTab('audit')} label="Audit" />
            <NavButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} label="Settings" />
          </nav>
        </aside>
      ) : null}

      <main className="main">
        {activeTab === 'overview' ? (
          <div className="grid2">
            <Panel title="Live Stream (virtualized)">
              <div className="row">
                <input
                  className="input"
                  value={scChannels}
                  onChange={(e) => setScChannels(e.target.value)}
                  placeholder="channels (csv)"
                />
                {!scConnected ? (
                  <button className="btn primary" onClick={startScStream}>
                    Connect
                  </button>
                ) : (
                  <button className="btn" onClick={stopScStream}>
                    Stop
                  </button>
                )}
              </div>
              <div className="row">
                <label className="check">
                  <input type="checkbox" checked={scFollowTail} onChange={(e) => setScFollowTail(e.target.checked)} />
                  follow tail
                </label>
                <input
                  className="input"
                  value={scFilter.channel}
                  onChange={(e) => setScFilter((p) => ({ ...p, channel: e.target.value }))}
                  placeholder="filter channel"
                />
                <input
                  className="input"
                  value={scFilter.kind}
                  onChange={(e) => setScFilter((p) => ({ ...p, kind: e.target.value }))}
                  placeholder="filter kind"
                />
              </div>
              <VirtualList
                listRef={scListRef}
                items={filteredScEvents}
                itemKey={(e) => String(e.db_id || e.seq || e.id || e.ts || Math.random())}
                estimatePx={78}
                onScroll={onScScroll}
                render={(e) => (
                  <EventRow
                    evt={e}
                    onSelect={() => setSelected({ type: 'sc_event', evt: e })}
                    selected={selected?.type === 'sc_event' && selected?.evt?.seq === e.seq}
                  />
                )}
              />
            </Panel>
            <Panel title="Prompt Events (virtualized)">
              <VirtualList
                items={promptEvents}
                itemKey={(e) => String(e.db_id || '') + ':' + String(e.type || '') + ':' + String(e.ts || '')}
                estimatePx={68}
                listRef={promptListRef}
                onScroll={onPromptScroll}
                render={(e) => (
                  <EventRow
                    evt={e}
                    onSelect={() => setSelected({ type: 'prompt_event', evt: e })}
                    selected={selected?.type === 'prompt_event' && selected?.evt === e}
                  />
                )}
              />
            </Panel>
          </div>
        ) : null}

        {activeTab === 'rendezvous' ? (
          <div className="grid2">
            <Panel title="Join / Subscribe">
              <p className="muted">
                This UI uses Intercom’s invite system as-is. Joining rendezvous channels is public; swap channels can be
                invite-only.
              </p>
              <div className="row">
                <input
                  className="input"
                  value={scChannels}
                  onChange={(e) => setScChannels(e.target.value)}
                  placeholder="rendezvous channels (csv)"
                />
                {!scConnected ? (
                  <button className="btn primary" onClick={startScStream}>
                    Connect stream
                  </button>
                ) : (
                  <button className="btn" onClick={stopScStream}>
                    Stop stream
                  </button>
                )}
              </div>
              <div className="row">
                <button
                  className="btn"
                  onClick={() => {
                    const chans = scChannels
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (chans.length === 0) return;
                    setRunMode('tool');
                    setToolName('intercomswap_sc_subscribe');
                    setToolArgsText(JSON.stringify({ channels: chans }, null, 2));
                    setPromptOpen(true);
                  }}
                >
                  Prepare subscribe tool-call
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    const first = scChannels
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)[0];
                    if (!first) return;
                    setRunMode('tool');
                    setToolName('intercomswap_sc_join');
                    setToolArgsText(JSON.stringify({ channel: first }, null, 2));
                    setPromptOpen(true);
                  }}
                >
                  Prepare join tool-call
                </button>
              </div>
            </Panel>
            <Panel title="Recent Messages">
              <VirtualList
                listRef={scListRef}
                items={filteredScEvents}
                itemKey={(e) => String(e.db_id || e.seq || e.id || e.ts || Math.random())}
                estimatePx={78}
                onScroll={onScScroll}
                render={(e) => (
                  <EventRow
                    evt={e}
                    onSelect={() => setSelected({ type: 'sc_event', evt: e })}
                    selected={selected?.type === 'sc_event' && selected?.evt?.seq === e.seq}
                  />
                )}
              />
            </Panel>
          </div>
        ) : null}

        {activeTab === 'rfqs' ? (
          <div className="grid2">
            <Panel title="RFQ Inbox">
              <p className="muted">
                RFQ = Request For Quote. All actions below are structured tool-calls (safe by default).
              </p>
              <VirtualList
                items={rfqEvents}
                itemKey={(e) => String(e.db_id || e.seq || e.ts || Math.random())}
                estimatePx={88}
                render={(e) => (
                  <RfqRow
                    evt={e}
                    onSelect={() => setSelected({ type: 'rfq', evt: e })}
                    onQuote={() => {
                      setRunMode('tool');
                      setToolName('intercomswap_quote_post_from_rfq');
                      setToolArgsText(
                        JSON.stringify(
                          {
                            channel: e.channel,
                            rfq_envelope: e.message,
                            valid_for_sec: 60,
                          },
                          null,
                          2
                        )
                      );
                      setPromptOpen(true);
                    }}
                  />
                )}
              />
            </Panel>
            <Panel title="Prompt Console Shortcuts">
              <button
                className="btn primary"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_rfq_post');
                  setToolArgsText(
                    JSON.stringify(
                      {
                        channel: scChannels.split(',')[0]?.trim() || '0000intercomswapbtcusdt',
                        trade_id: `rfq-${Date.now()}`,
                        btc_sats: 10000,
                        usdt_amount: '1000000',
                        valid_until_unix: Math.floor(Date.now() / 1000) + 600,
                      },
                      null,
                      2
                    )
                  );
                  setPromptOpen(true);
                }}
              >
                New RFQ tool-call
              </button>
              <p className="muted small">
                Note: avoid free-form “have/want” text in prompts. Use the structured RFQ/QUOTE tools.
              </p>
            </Panel>
          </div>
        ) : null}

        {activeTab === 'invites' ? (
          <div className="grid2">
            <Panel title="Swap Invites">
              <VirtualList
                items={inviteEvents}
                itemKey={(e) => String(e.db_id || e.seq || e.ts || Math.random())}
                estimatePx={92}
                render={(e) => (
                  <InviteRow
                    evt={e}
                    onSelect={() => setSelected({ type: 'invite', evt: e })}
                    onJoin={() => {
                      setRunMode('tool');
                      setToolName('intercomswap_join_from_swap_invite');
                      setToolArgsText(JSON.stringify({ swap_invite_envelope: e.message }, null, 2));
                      setPromptOpen(true);
                    }}
                  />
                )}
              />
            </Panel>
            <Panel title="Channel Hygiene">
              <button
                className="btn"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_sc_leave');
                  setToolArgsText(JSON.stringify({ channel: 'swap:...' }, null, 2));
                  setPromptOpen(true);
                }}
              >
                Prepare leave tool-call
              </button>
              <p className="muted small">Leave channels after trade completion/timeout to keep memory bounded.</p>
            </Panel>
          </div>
        ) : null}

        {activeTab === 'refunds' ? (
          <div className="grid2">
            <Panel title="Open Refunds (receipts)">
              <button
                className="btn primary"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_receipts_list_open_refunds');
                  setToolArgsText(JSON.stringify({ limit: 100, offset: 0 }, null, 2));
                  setPromptOpen(true);
                }}
              >
                List open refunds
              </button>
              <button
                className="btn"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_swaprecover_refund');
                  setToolArgsText(JSON.stringify({ trade_id: '...', payment_hash_hex: '...' }, null, 2));
                  setPromptOpen(true);
                }}
              >
                Prepare refund recovery
              </button>
            </Panel>
            <Panel title="Open Claims (receipts)">
              <button
                className="btn primary"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_receipts_list_open_claims');
                  setToolArgsText(JSON.stringify({ limit: 100, offset: 0 }, null, 2));
                  setPromptOpen(true);
                }}
              >
                List open claims
              </button>
              <button
                className="btn"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_swaprecover_claim');
                  setToolArgsText(JSON.stringify({ trade_id: '...', payment_hash_hex: '...' }, null, 2));
                  setPromptOpen(true);
                }}
              >
                Prepare claim recovery
              </button>
            </Panel>
          </div>
        ) : null}

        {activeTab === 'wallets' ? (
          <div className="grid2">
            <Panel title="Lightning">
              <button
                className="btn primary"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_ln_get_info');
                  setToolArgsText('{\n  \n}');
                  setPromptOpen(true);
                }}
              >
                ln_get_info
              </button>
              <button
                className="btn"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_ln_list_funds');
                  setToolArgsText('{\n  \n}');
                  setPromptOpen(true);
                }}
              >
                ln_list_funds
              </button>
              <button
                className="btn"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_ln_new_address');
                  setToolArgsText(JSON.stringify({ type: 'bech32' }, null, 2));
                  setPromptOpen(true);
                }}
              >
                ln_new_address
              </button>
            </Panel>
            <Panel title="Solana">
              <button
                className="btn primary"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_sol_config_get');
                  setToolArgsText('{\n  \n}');
                  setPromptOpen(true);
                }}
              >
                sol_config_get
              </button>
              <button
                className="btn"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_sol_balance');
                  setToolArgsText(JSON.stringify({ pubkey: '...' }, null, 2));
                  setPromptOpen(true);
                }}
              >
                sol_balance
              </button>
            </Panel>
          </div>
        ) : null}

        {activeTab === 'peers' ? (
          <div className="grid2">
            <Panel title="Peer Instances">
              <button
                className="btn primary"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_peer_status');
                  setToolArgsText('{\n  \n}');
                  setPromptOpen(true);
                }}
              >
                peer_status
              </button>
              <button
                className="btn"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_peer_start');
                  setToolArgsText(
                    JSON.stringify(
                      {
                        name: 'peer1',
                        store: 'peer1',
                        sc_port: 49222,
                        sidechannels: scChannels.split(',').map((s) => s.trim()).filter(Boolean),
                        pow_enabled: true,
                        pow_difficulty: 1,
                        invite_required: true,
                        welcome_required: true,
                      },
                      null,
                      2
                    )
                  );
                  setPromptOpen(true);
                }}
              >
                Prepare peer_start
              </button>
              <p className="muted small">Note: never run the same store twice.</p>
            </Panel>
            <Panel title="RFQ Bots">
              <button
                className="btn primary"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_rfqbot_status');
                  setToolArgsText('{\n  \n}');
                  setPromptOpen(true);
                }}
              >
                rfqbot_status
              </button>
              <button
                className="btn"
                onClick={() => {
                  setRunMode('tool');
                  setToolName('intercomswap_rfqbot_start_maker');
                  setToolArgsText(
                    JSON.stringify(
                      {
                        name: 'maker1',
                        store: 'maker1',
                        sc_port: 49222,
                        argv: [],
                      },
                      null,
                      2
                    )
                  );
                  setPromptOpen(true);
                }}
              >
                Prepare maker bot start
              </button>
            </Panel>
          </div>
        ) : null}

        {activeTab === 'audit' ? (
          <Panel title="Prompt Events">
            <VirtualList
              items={promptEvents}
              itemKey={(e) => String(e.db_id || '') + ':' + String(e.type || '') + ':' + String(e.ts || '')}
              estimatePx={68}
              listRef={promptListRef}
              onScroll={onPromptScroll}
              render={(e) => (
                <EventRow
                  evt={e}
                  onSelect={() => setSelected({ type: 'prompt_event', evt: e })}
                  selected={selected?.type === 'prompt_event' && selected?.evt === e}
                />
              )}
            />
          </Panel>
        ) : null}

        {activeTab === 'settings' ? (
          <Panel title="Settings">
            <div className="row">
              <label className="check">
                <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
                auto_approve
              </label>
              <label className="check">
                <input type="checkbox" checked={promptOpen} onChange={(e) => setPromptOpen(e.target.checked)} />
                console open
              </label>
            </div>
            <p className="muted small">
              For external access: run promptd with `server.auth_token` + optional `server.tls` in
              `onchain/prompt/setup.json`.
            </p>
          </Panel>
        ) : null}
      </main>

      {inspectorOpen ? (
        <aside className="inspector">
          <Panel title="Inspector">
            {!selected ? (
              <p className="muted">Select an event to inspect.</p>
            ) : (
              <>
                <pre className="code">{JSON.stringify(selected, null, 2)}</pre>
                <button
                  className="btn"
                  onClick={() => {
                    if (selected?.type === 'sc_event') {
                      setRunMode('tool');
                      setToolName('intercomswap_sc_send_json');
                      setToolArgsText(JSON.stringify({ channel: selected.evt.channel, json: { ack: true } }, null, 2));
                      setPromptOpen(true);
                    }
                  }}
                >
                  Prepare reply tool-call
                </button>
              </>
            )}
          </Panel>
        </aside>
      ) : null}

      <section className={`prompt ${promptOpen ? 'open' : 'closed'}`}>
        <div className="promptbar">
          <div className="promptbar-left">
            <span className="tag">console</span>
            <span className="muted small">session:</span>
            <span className="mono small">{sessionId || 'new'}</span>
          </div>
          <div className="promptbar-right">
            <label className="seg">
              <input type="radio" name="mode" checked={runMode === 'tool'} onChange={() => setRunMode('tool')} />
              <span>Tool</span>
            </label>
            <label className="seg">
              <input type="radio" name="mode" checked={runMode === 'llm'} onChange={() => setRunMode('llm')} />
              <span>LLM</span>
            </label>
            <button className="btn" onClick={() => promptAbortRef.current?.abort()}>
              Stop
            </button>
          </div>
        </div>

        <div className="promptbody">
          {runMode === 'tool' ? (
            <div className="toolrun">
              <div className="row">
                <select className="select" value={toolName} onChange={(e) => setToolName(e.target.value)}>
                  {(tools || []).map((t: any) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button className="btn primary" onClick={onRun}>
                  Run
                </button>
              </div>
              <textarea className="textarea mono" value={toolArgsText} onChange={(e) => setToolArgsText(e.target.value)} />
              <p className="muted small">
                Tool mode uses direct tool-call JSON and does not expose network text to an LLM.
              </p>
            </div>
          ) : (
            <div className="llmrun">
              <textarea
                className="textarea"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                placeholder="Natural-language prompt (advanced). Avoid pasting untrusted peer content."
              />
              <div className="row">
                <button className="btn primary" onClick={onRun}>
                  Run
                </button>
                <button className="btn" onClick={() => setPromptInput('')}>
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default App

function NavButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button className={`navbtn ${active ? 'active' : ''}`} onClick={onClick}>
      <span>{label}</span>
      {typeof badge === 'number' && badge > 0 ? <span className="badge">{badge}</span> : null}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: any }) {
  return (
    <section className="panel">
      <div className="panel-hd">
        <h2>{title}</h2>
      </div>
      <div className="panel-bd">{children}</div>
    </section>
  );
}

function StatusPill({ label, state, value }: { label: string; state: 'ok' | 'bad' | 'idle' | 'neutral'; value?: string }) {
  return (
    <span className={`pill ${state}`}>
      <span className="pill-dot" />
      <span className="pill-label">{label}</span>
      {value ? <span className="pill-value">{value}</span> : null}
    </span>
  );
}

function EventRow({
  evt,
  onSelect,
  selected,
}: {
  evt: any;
  onSelect: () => void;
  selected: boolean;
}) {
  const ts = evt?.ts ? new Date(evt.ts).toLocaleTimeString() : '';
  const kind = evt?.kind ? String(evt.kind) : '';
  const channel = evt?.channel ? String(evt.channel) : '';
  const type = evt?.type ? String(evt.type) : '';
  const summary = kind ? `${kind} ${evt.trade_id ? `(${evt.trade_id})` : ''}` : type;

  return (
    <div className={`rowitem ${selected ? 'selected' : ''}`} onClick={onSelect} role="button">
      <div className="rowitem-top">
        <span className="mono dim">{ts}</span>
        {channel ? <span className="mono chip">{channel}</span> : null}
      </div>
      <div className="rowitem-mid">
        <span className="mono">{summary}</span>
      </div>
      <div className="rowitem-bot">
        <span className="muted small">{previewMessage(evt?.message)}</span>
      </div>
    </div>
  );
}

function RfqRow({ evt, onSelect, onQuote }: { evt: any; onSelect: () => void; onQuote: () => void }) {
  const body = evt?.message?.body;
  const btc = body?.btc_sats;
  const usdt = body?.usdt_amount;
  return (
    <div className="rowitem" role="button" onClick={onSelect}>
      <div className="rowitem-top">
        <span className="mono chip">{evt.channel}</span>
        <span className="mono dim">{evt.trade_id || evt?.message?.trade_id || ''}</span>
      </div>
      <div className="rowitem-mid">
        <span className="mono">BTC sats: {btc ?? '?'}</span>
        <span className="mono">USDT: {usdt ?? '?'}</span>
      </div>
      <div className="rowitem-bot">
        <button className="btn small primary" onClick={(e) => { e.stopPropagation(); onQuote(); }}>
          Quote
        </button>
      </div>
    </div>
  );
}

function InviteRow({ evt, onSelect, onJoin }: { evt: any; onSelect: () => void; onJoin: () => void }) {
  const body = evt?.message?.body;
  const swapChannel = body?.swap_channel;
  return (
    <div className="rowitem" role="button" onClick={onSelect}>
      <div className="rowitem-top">
        <span className="mono chip">{evt.channel}</span>
        {swapChannel ? <span className="mono chip hi">{swapChannel}</span> : null}
      </div>
      <div className="rowitem-mid">
        <span className="mono">swap_invite</span>
      </div>
      <div className="rowitem-bot">
        <button className="btn small primary" onClick={(e) => { e.stopPropagation(); onJoin(); }}>
          Join
        </button>
      </div>
    </div>
  );
}

function previewMessage(msg: any) {
  if (msg === null || msg === undefined) return '';
  if (typeof msg === 'string') {
    const s = msg.replace(/\s+/g, ' ').trim();
    return s.length > 140 ? s.slice(0, 140) + '…' : s;
  }
  try {
    const s = JSON.stringify(msg);
    return s.length > 160 ? s.slice(0, 160) + '…' : s;
  } catch (_e) {
    return String(msg);
  }
}

function AnimatedLogo({ text, tagline }: { text: string; tagline: string }) {
  const [mode, setMode] = useState<'wave' | 'gradient' | 'sparkle' | 'typewriter'>('wave');
  const [waveIndex, setWaveIndex] = useState(0);
  const [sparkle, setSparkle] = useState<Set<number>>(new Set());

  const colors = useMemo(
    () => ['#22d3ee', '#84cc16', '#f97316', '#f43f5e', '#eab308'] as const,
    []
  );

  function randColor(exclude?: string) {
    const pool = exclude ? colors.filter((c) => c !== exclude) : colors;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  useEffect(() => {
    const interval = setInterval(() => {
      setMode((prev) => {
        const all = ['wave', 'gradient', 'sparkle', 'typewriter'] as const;
        const idx = all.indexOf(prev);
        return all[(idx + 1) % all.length];
      });
    }, 12000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (mode !== 'wave') return;
    const interval = setInterval(() => setWaveIndex((p) => (p + 1) % text.length), 90);
    return () => clearInterval(interval);
  }, [mode, text.length]);

  useEffect(() => {
    if (mode !== 'sparkle') return;
    const interval = setInterval(() => {
      const next = new Set<number>();
      const count = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) next.add(Math.floor(Math.random() * text.length));
      setSparkle(next);
    }, 160);
    return () => clearInterval(interval);
  }, [mode, text.length]);

  const [typewriterIndex, setTypewriterIndex] = useState(0);
  const [typewriterColors, setTypewriterColors] = useState(() => text.split('').map(() => randColor()));
  const resetScheduled = useRef(false);
  useEffect(() => {
    if (mode !== 'typewriter') return;
    resetScheduled.current = false;
    const interval = setInterval(() => {
      setTypewriterIndex((prev) => {
        if (prev >= text.length) {
          if (!resetScheduled.current) {
            resetScheduled.current = true;
            setTimeout(() => {
              resetScheduled.current = false;
              setTypewriterColors(text.split('').map(() => randColor()));
              setTypewriterIndex(0);
            }, 900);
          }
          return prev;
        }
        return prev + 1;
      });
    }, 70);
    return () => clearInterval(interval);
  }, [mode, text]);

  const renderChar = (ch: string, idx: number) => {
    if (ch === ' ') return <span key={idx}>&nbsp;</span>;
    let style: React.CSSProperties = {};
    let className = 'logo-ch';

    if (mode === 'wave') {
      const dist = Math.abs(idx - waveIndex);
      const intensity = Math.max(0, 1 - dist * 0.18);
      const ci = (waveIndex + idx) % colors.length;
      const color = colors[ci];
      style = {
        color: intensity > 0.25 ? color : '#89b6c8',
        transform: intensity > 0.6 ? `translateY(${-2.5 * intensity}px)` : undefined,
        textShadow: intensity > 0.6 ? `0 0 ${10 * intensity}px ${color}` : undefined,
      };
      className += ' fast';
    } else if (mode === 'gradient') {
      style = { animationDelay: `${idx * 0.045}s` };
      className += ' gradient';
    } else if (mode === 'sparkle') {
      const isSparkle = sparkle.has(idx);
      const color = isSparkle ? randColor() : '#b2e3f3';
      style = {
        color,
        transform: isSparkle ? 'scale(1.08)' : undefined,
        textShadow: isSparkle ? `0 0 10px ${color}` : undefined,
      };
      className += ' med';
    } else if (mode === 'typewriter') {
      const isRevealed = idx < typewriterIndex;
      const color = typewriterColors[idx] || '#22d3ee';
      style = {
        color: isRevealed ? color : 'rgba(255,255,255,0.16)',
        textShadow: isRevealed ? `0 0 7px ${color}` : undefined,
      };
      className += ' med';
    }

    return (
      <span key={idx} className={className} style={style}>
        {ch}
      </span>
    );
  };

  return (
    <div className="logo-wrap">
      <div className="logo-text">{text.split('').map((c, i) => renderChar(c, i))}</div>
      <div className="logo-tag">{tagline}</div>
    </div>
  );
}

function VirtualList({
  items,
  render,
  estimatePx,
  itemKey,
  listRef,
  onScroll,
}: {
  items: any[];
  render: (item: any) => any;
  estimatePx: number;
  itemKey: (item: any) => string;
  listRef?: any;
  onScroll?: () => void;
}) {
  // Lightweight virtualization without extra deps beyond @tanstack/react-virtual.
  // We keep it local so each panel can set its own sizing and scroll container.
  const parentRef = useRef<HTMLDivElement | null>(null);

  // Allow caller to receive the scroll element for “follow tail”.
  useEffect(() => {
    if (!listRef) return;
    listRef.current = parentRef.current;
  }, [listRef]);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatePx,
    overscan: 8,
    getItemKey: (idx: number) => itemKey(items[idx]),
  });

  return (
    <div ref={parentRef} className="vlist" onScroll={onScroll}>
      <div className="vlist-inner" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((v: any) => {
          const item = items[v.index];
          return (
            <div
              key={v.key}
              className="vrow"
              style={{ transform: `translateY(${v.start}px)`, height: `${v.size}px` }}
            >
              {render(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
