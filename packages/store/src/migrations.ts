import type { DatabaseSync } from 'node:sqlite'

/**
 * 表结构迁移：只追加，不改已发布的条目；当前版本记在 PRAGMA user_version。
 * 第 n 条迁移把库从版本 n-1 升到 n。
 */
const MIGRATIONS: readonly string[] = [
  // v1：bot 和 v0.1 的单聊。
  `
  CREATE TABLE bots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('lead', 'member')),
    title TEXT NOT NULL DEFAULT '',
    persona TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER
  );
  CREATE UNIQUE INDEX bots_single_lead ON bots (role) WHERE role = 'lead';
  CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots (id),
    session_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_opened_at INTEGER NOT NULL
  );
  CREATE INDEX chats_by_bot ON chats (bot_id, last_opened_at DESC);
  `,
  // v2：bot 的完整配置、配置版本、设置、审计和维护状态。
  `
  ALTER TABLE bots ADD COLUMN persona_source TEXT NOT NULL DEFAULT 'user';
  ALTER TABLE bots ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
  ALTER TABLE bots ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE bots ADD COLUMN card TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE bots ADD COLUMN model TEXT;
  ALTER TABLE bots ADD COLUMN tool_profile TEXT NOT NULL DEFAULT 'exec';
  ALTER TABLE bots ADD COLUMN temporary INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE bots ADD COLUMN purged_at INTEGER;
  UPDATE bots SET persona_source = 'seed' WHERE role = 'lead';

  CREATE TABLE bot_versions (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots (id),
    version INTEGER NOT NULL,
    config TEXT NOT NULL,
    source TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    UNIQUE (bot_id, version)
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    actor TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX audit_by_time ON audit (created_at DESC);
  CREATE TRIGGER audit_append_only_update BEFORE UPDATE ON audit
    BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
  CREATE TRIGGER audit_append_only_delete BEFORE DELETE ON audit
    BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
  `,
  // v3：房间、消息、会话、任务、等你事项、持久邮箱和用量；v0.1 的单聊迁成单聊房间。
  `
  CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('direct', 'task', 'team')),
    title TEXT NOT NULL,
    bot_id TEXT REFERENCES bots (id),
    team_id TEXT,
    task_id TEXT,
    topic TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0,
    incognito INTEGER NOT NULL DEFAULT 0,
    notify_level TEXT NOT NULL DEFAULT 'all',
    last_seq INTEGER NOT NULL DEFAULT 0,
    read_seq INTEGER NOT NULL DEFAULT 0,
    last_message_at INTEGER,
    created_at INTEGER NOT NULL,
    archived_at INTEGER,
    purged_at INTEGER
  );
  CREATE INDEX rooms_by_activity ON rooms (archived_at, last_message_at DESC);

  CREATE TABLE room_members (
    room_id TEXT NOT NULL REFERENCES rooms (id),
    bot_id TEXT NOT NULL REFERENCES bots (id),
    muted INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, bot_id)
  );

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms (id),
    seq INTEGER NOT NULL,
    author TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',
    reply_to TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    session_id TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    UNIQUE (room_id, seq)
  );
  CREATE INDEX messages_by_session ON messages (session_id);

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots (id),
    kind TEXT NOT NULL,
    room_id TEXT,
    task_id TEXT,
    segment INTEGER NOT NULL DEFAULT 1,
    preset TEXT NOT NULL,
    folder TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_tokens INTEGER NOT NULL DEFAULT 0,
    context_tokens INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    steps INTEGER NOT NULL DEFAULT 0,
    tainted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_active_at INTEGER,
    retired_at INTEGER
  );
  CREATE INDEX sessions_by_room ON sessions (room_id, status);
  CREATE INDEX sessions_by_task ON sessions (task_id, status);

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    root_id TEXT NOT NULL,
    parent_id TEXT,
    room_id TEXT,
    team_id TEXT,
    title TEXT NOT NULL,
    brief TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT '',
    deliverable TEXT NOT NULL DEFAULT '',
    acceptance TEXT NOT NULL DEFAULT '[]',
    depends_on TEXT NOT NULL DEFAULT '[]',
    needs TEXT NOT NULL DEFAULT '{}',
    owner_bot_id TEXT,
    level TEXT,
    status TEXT NOT NULL,
    stage TEXT,
    note TEXT NOT NULL DEFAULT '',
    result TEXT,
    folder TEXT NOT NULL DEFAULT '',
    plan TEXT,
    plan_version INTEGER NOT NULL DEFAULT 0,
    urgent INTEGER NOT NULL DEFAULT 0,
    tainted INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    requester_session TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX tasks_by_root ON tasks (root_id);
  CREATE INDEX tasks_by_status ON tasks (status, updated_at DESC);
  CREATE INDEX tasks_by_owner ON tasks (owner_bot_id, status);

  CREATE TABLE task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    root_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    actor TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX task_events_by_root ON task_events (root_id, id);

  CREATE TABLE waits (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',
    task_id TEXT,
    root_id TEXT,
    session_id TEXT,
    bot_id TEXT,
    room_id TEXT,
    answer TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX waits_by_status ON waits (status, created_at DESC);

  CREATE TABLE deliveries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    lane TEXT NOT NULL,
    priority INTEGER NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL,
    sent_at INTEGER
  );
  CREATE INDEX deliveries_pending ON deliveries (status, priority, created_at);

  CREATE TABLE usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    bot_id TEXT,
    task_id TEXT,
    room_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_tokens INTEGER NOT NULL,
    cost REAL,
    peak INTEGER NOT NULL DEFAULT 0,
    purpose TEXT NOT NULL DEFAULT 'agent',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX usage_by_time ON usage (created_at);
  CREATE INDEX usage_by_task ON usage (task_id);

  INSERT INTO rooms (id, kind, title, bot_id, topic, created_at, last_message_at)
    SELECT c.id, 'direct', b.name, c.bot_id, '', c.created_at, c.last_opened_at FROM chats c JOIN bots b ON b.id = c.bot_id;
  INSERT INTO room_members (room_id, bot_id, joined_at) SELECT id, bot_id, created_at FROM chats;
  INSERT INTO sessions (id, bot_id, kind, room_id, preset, created_at, last_active_at)
    SELECT session_id, bot_id, 'chat', id, 'pod', created_at, last_opened_at FROM chats;
  DROP TABLE chats;
  `,
  // v4：团队、成员、bot 之间的咨询；任务的权限上限和“谨慎”档待审批的计划。
  `
  CREATE TABLE teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    leader_bot_id TEXT NOT NULL REFERENCES bots (id),
    autonomy TEXT,
    model TEXT,
    room_id TEXT,
    temporary INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER,
    purged_at INTEGER
  );

  CREATE TABLE team_members (
    team_id TEXT NOT NULL REFERENCES teams (id),
    bot_id TEXT NOT NULL REFERENCES bots (id),
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (team_id, bot_id)
  );

  CREATE TABLE consults (
    id TEXT PRIMARY KEY,
    root_id TEXT,
    room_id TEXT,
    asker_session TEXT NOT NULL,
    asker_bot TEXT NOT NULL,
    target_bot TEXT NOT NULL,
    consult_session TEXT,
    question TEXT NOT NULL,
    answer TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    answered_at INTEGER
  );
  CREATE INDEX consults_by_session ON consults (consult_session, status);

  ALTER TABLE tasks ADD COLUMN max_profile TEXT NOT NULL DEFAULT 'exec';
  ALTER TABLE tasks ADD COLUMN plan_pending INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN plan_key TEXT;
  `,
  // v5：核心记忆、记忆条目、记忆变更日志、换段的交接笔记、记忆提取进度。
  `
  CREATE TABLE memory_core (
    scope_kind TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    user_edited INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (scope_kind, scope_id)
  );

  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    scope_kind TEXT NOT NULL,
    scope_id TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    source_ref TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0.7,
    private INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    supersedes TEXT,
    valid_until INTEGER,
    user_edited INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_used_at INTEGER,
    use_count INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER
  );
  CREATE INDEX memories_by_scope ON memories (scope_kind, scope_id, status);

  CREATE TABLE memory_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL,
    action TEXT NOT NULL,
    before TEXT,
    after TEXT,
    actor TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    reverted_at INTEGER
  );
  CREATE INDEX memory_log_by_time ON memory_log (created_at DESC);

  CREATE TABLE handovers (
    id TEXT PRIMARY KEY,
    from_session TEXT NOT NULL,
    to_session TEXT,
    room_id TEXT,
    task_id TEXT,
    bot_id TEXT NOT NULL,
    note TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX handovers_by_room ON handovers (room_id, created_at DESC);
  `,
  // v6：定时例程、盯网页、通知中心。
  `
  CREATE TABLE routines (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('cron', 'watch')),
    cron TEXT NOT NULL DEFAULT '',
    timezone TEXT NOT NULL,
    prompt TEXT NOT NULL,
    bot_id TEXT NOT NULL REFERENCES bots (id),
    room_id TEXT,
    url TEXT NOT NULL DEFAULT '',
    selector TEXT NOT NULL DEFAULT '',
    interval_minutes INTEGER NOT NULL DEFAULT 60,
    fingerprint TEXT NOT NULL DEFAULT '',
    last_text TEXT NOT NULL DEFAULT '',
    catch_up INTEGER NOT NULL DEFAULT 1,
    off_peak INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    next_run_at INTEGER,
    last_status TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX routines_due ON routines (enabled, next_run_at);

  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    room_id TEXT,
    task_id TEXT,
    wait_id TEXT,
    silent INTEGER NOT NULL DEFAULT 0,
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX notifications_by_time ON notifications (created_at DESC);
  `,
  // v7：自我优化——反馈信号、技能和版本、进化日志、按反馈的人设调整和推理档位。
  `
  CREATE TABLE feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    bot_id TEXT,
    task_id TEXT,
    root_id TEXT,
    message_id TEXT,
    value INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX feedback_by_bot ON feedback (bot_id, created_at);
  CREATE INDEX feedback_by_task ON feedback (task_id);
  CREATE UNIQUE INDEX feedback_one_rating ON feedback (message_id) WHERE kind = 'rating';

  CREATE TABLE skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    scope_kind TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    description TEXT NOT NULL,
    content TEXT NOT NULL,
    has_script INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL,
    source_ref TEXT,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (scope_kind, scope_id, name)
  );

  CREATE TABLE skill_versions (
    skill_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    content TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (skill_id, version)
  );

  CREATE TABLE evolution (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    bot_id TEXT,
    subject TEXT NOT NULL,
    summary TEXT NOT NULL,
    before TEXT NOT NULL DEFAULT 'null',
    after TEXT NOT NULL DEFAULT 'null',
    reason TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    baseline TEXT NOT NULL DEFAULT 'null',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    reverted_at INTEGER
  );
  CREATE INDEX evolution_by_time ON evolution (created_at DESC);

  CREATE TABLE tuning (
    bot_id TEXT PRIMARY KEY,
    persona TEXT NOT NULL DEFAULT '',
    effort TEXT,
    updated_at INTEGER NOT NULL
  );
  `,
  // v8：页面——页面、版本（只追加）、页面里的图片；例程可以定时更新某个页面；按页面串起对话里的消息。
  `
  CREATE TABLE pages (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    room_id TEXT,
    session_id TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX pages_by_time ON pages (deleted_at, updated_at DESC);

  CREATE TABLE page_versions (
    page_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    doc TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (page_id, version)
  );

  CREATE TABLE page_assets (
    page_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (page_id, hash)
  );

  ALTER TABLE routines ADD COLUMN page_id TEXT;
  CREATE INDEX messages_by_page ON messages (json_extract(data, '$.pageId')) WHERE json_extract(data, '$.pageId') IS NOT NULL;
  `,
  // v9：bot 的名字颜色；单聊分成一段段对话后，单聊里记下的要点改记在 bot 名下（换一段对话也还在）；
  // aibot 接入的设备（安装码和 Key 只放在这张表里，不进设置、状态和日志）。
  `
  ALTER TABLE bots ADD COLUMN color TEXT NOT NULL DEFAULT '';
  UPDATE memories SET scope_kind = 'bot', scope_id = (SELECT bot_id FROM rooms WHERE rooms.id = memories.scope_id)
    WHERE scope_kind = 'room' AND scope_id IN (SELECT id FROM rooms WHERE kind = 'direct' AND bot_id IS NOT NULL);
  CREATE TABLE aibot_device (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    install_secret TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    device_id TEXT NOT NULL DEFAULT '',
    disabled_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // v10：只跑一次的例程（到点跑一次就删掉），cron 留空。
  `
  ALTER TABLE routines ADD COLUMN run_at INTEGER;
  `,
  // v11：V3 的地基。副作用队列、系统问题、操作 id；任务的执行、汇报、话题、跟进、触发器和每条消息的去向；
  // 投递跟踪到收进历史、读过为止（加列前已投出的当作读过）；催促次数入库。
  `
  CREATE TABLE effects (
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    seq INTEGER NOT NULL,
    generation INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',
    due INTEGER NOT NULL,
    since INTEGER NOT NULL,
    PRIMARY KEY (kind, key)
  );
  CREATE INDEX effects_by_due ON effects (kind, due, seq);

  CREATE TABLE problems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    failures INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX problems_open ON problems (kind, resolved_at);

  CREATE TABLE ops (
    id TEXT PRIMARY KEY,
    command TEXT NOT NULL,
    result TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE task_runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    session_id TEXT,
    status TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    outcome TEXT,
    error TEXT,
    queued_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER
  );
  CREATE INDEX task_runs_by_task ON task_runs (task_id, queued_at);

  CREATE TABLE task_reports (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    task_id TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    report TEXT NOT NULL DEFAULT '',
    question TEXT,
    about_message TEXT,
    reply_message TEXT,
    checks TEXT NOT NULL DEFAULT '[]',
    data TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX task_reports_by_task ON task_reports (task_id, created_at);

  CREATE TABLE message_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    route TEXT NOT NULL,
    task_id TEXT,
    decided_by TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX message_routes_by_message ON message_routes (message_id);
  CREATE INDEX message_routes_by_task ON message_routes (task_id);

  CREATE TABLE topics (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    room_id TEXT,
    root_message TEXT,
    task_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX topics_by_root ON topics (root_message);
  CREATE INDEX topics_by_task ON topics (task_id);

  CREATE TABLE topic_follows (
    topic_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    PRIMARY KEY (topic_id, task_id)
  );
  CREATE INDEX topic_follows_by_task ON topic_follows (task_id);

  CREATE TABLE triggers (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    spec TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    next_at INTEGER,
    last_at INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX triggers_by_task ON triggers (task_id);
  CREATE INDEX triggers_due ON triggers (enabled, next_at);

  ALTER TABLE deliveries ADD COLUMN message_id TEXT;
  ALTER TABLE deliveries ADD COLUMN handed_at INTEGER;
  ALTER TABLE deliveries ADD COLUMN taken_at INTEGER;
  ALTER TABLE deliveries ADD COLUMN read_at INTEGER;
  UPDATE deliveries SET message_id = json_extract(message, '$.id');
  UPDATE deliveries SET handed_at = sent_at, taken_at = sent_at, read_at = sent_at WHERE status = 'sent';
  CREATE INDEX deliveries_by_message ON deliveries (message_id);
  CREATE INDEX deliveries_by_session ON deliveries (session_id, status);

  ALTER TABLE tasks ADD COLUMN origin TEXT;
  ALTER TABLE tasks ADD COLUMN reply_to TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE tasks ADD COLUMN ended_at INTEGER;
  ALTER TABLE tasks ADD COLUMN end_reason TEXT;
  ALTER TABLE tasks ADD COLUMN stage_cache TEXT;
  ALTER TABLE tasks ADD COLUMN nudges INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN nudge_mark TEXT NOT NULL DEFAULT '';

  ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT '';
  UPDATE sessions SET role = CASE kind WHEN 'chat' THEN 'chat' ELSE 'task' END;

  ALTER TABLE messages ADD COLUMN source TEXT NOT NULL DEFAULT 'chat';
  ALTER TABLE messages ADD COLUMN topic_id TEXT;
  ALTER TABLE messages ADD COLUMN topic_via TEXT;

  ALTER TABLE waits ADD COLUMN report_id TEXT;
  `,
  // v12：任务换成工单。执行带开工原因的补充，汇报记作者；旧任务补来由（标成旧任务，没有原话）、
  // 按旧状态补结束方式和一条执行，最后一次结果换成一条汇报。旧的 status 列先留着，由阶段推出来写。
  `
  ALTER TABLE task_runs ADD COLUMN detail TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE task_reports ADD COLUMN author TEXT NOT NULL DEFAULT '';

  UPDATE tasks SET origin = json_object('kind', 'legacy', 'quotes', json('[]'), 'requester', created_by, 'roomId', room_id, 'rule', NULL, 'title', title, 'note', brief)
    WHERE origin IS NULL;
  UPDATE tasks SET reply_to = json_array(json_object('roomId', room_id, 'messageId', NULL)) WHERE room_id IS NOT NULL AND reply_to = '[]';
  UPDATE tasks SET ended_at = COALESCE(finished_at, updated_at), end_reason = CASE status WHEN 'done' THEN 'done' ELSE 'stopped' END
    WHERE status IN ('done', 'stopped', 'cancelled') AND ended_at IS NULL;

  INSERT OR IGNORE INTO task_runs (id, task_id, session_id, status, reason, outcome, error, queued_at, started_at, ended_at, detail)
    SELECT 'run_' || substr(t.id, 6), t.id,
      (SELECT s.id FROM sessions s WHERE s.task_id = t.id AND s.kind IN ('task', 'coord') ORDER BY s.created_at DESC LIMIT 1),
      CASE t.status WHEN 'queued' THEN 'queued' WHEN 'running' THEN 'running' ELSE 'ended' END,
      'new',
      CASE t.status WHEN 'queued' THEN NULL WHEN 'running' THEN NULL WHEN 'paused' THEN 'paused' WHEN 'stopped' THEN 'stopped' WHEN 'cancelled' THEN 'stopped' ELSE 'reported' END,
      NULL, t.created_at, t.started_at,
      CASE WHEN t.status IN ('queued', 'running') THEN NULL ELSE COALESCE(t.finished_at, t.updated_at) END,
      '{}'
    FROM tasks t WHERE t.deleted_at IS NULL;

  INSERT OR IGNORE INTO task_reports (id, run_id, task_id, status, summary, report, question, about_message, reply_message, checks, data, author, created_at)
    SELECT 'rep_' || substr(t.id, 6), 'run_' || substr(t.id, 6), t.id,
      CASE t.status WHEN 'failed' THEN 'failed' ELSE 'ready' END,
      CASE WHEN t.status = 'failed' THEN t.note ELSE COALESCE(json_extract(t.result, '$.summary'), '') END,
      '', NULL, NULL, NULL, '[]', COALESCE(t.result, '{}'), COALESCE(t.owner_bot_id, ''), COALESCE(t.finished_at, t.updated_at)
    FROM tasks t WHERE t.deleted_at IS NULL AND t.status IN ('done', 'review', 'failed');

  UPDATE tasks SET stage_cache = CASE status
      WHEN 'queued' THEN 'queued' WHEN 'running' THEN 'running' WHEN 'waiting' THEN 'waiting' WHEN 'review' THEN 'review'
      WHEN 'failed' THEN 'failed' WHEN 'paused' THEN 'idle' ELSE 'ended' END;
  `,
  // v13：消息去向记下送进任务时的那次投递或执行（判断读没读过）；按话题找消息。
  `
  ALTER TABLE message_routes ADD COLUMN ref TEXT;
  CREATE INDEX IF NOT EXISTS message_routes_by_ref ON message_routes (ref);
  CREATE INDEX IF NOT EXISTS messages_by_topic ON messages (topic_id, created_at);
  `,
  // v14：交给前台和前台的判断记下是哪个 bot 的前台；没送出的就是前台的待送队列。
  `
  ALTER TABLE message_routes ADD COLUMN bot_id TEXT;
  CREATE INDEX IF NOT EXISTS message_routes_by_bot ON message_routes (bot_id, route, ref);
  `,
  // v15：触发器补上关掉的时间、附带的状态（来源、错峰、盯网页的指纹）和谁定的；例程记下换成了哪个常开任务。
  `
  ALTER TABLE triggers ADD COLUMN closed_at INTEGER;
  ALTER TABLE triggers ADD COLUMN state TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE triggers ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
  ALTER TABLE routines ADD COLUMN task_id TEXT;
  `,
  // v16：你让任务先等等的时间：暂停是任务自己的状态，重启后还停着，只有你说接着做才清掉。
  `
  ALTER TABLE tasks ADD COLUMN paused_at INTEGER;
  `,
  // v17：群的组长：群里没点名的话先给它（以前都给 Super-agent）。已有的群启动时补上。
  `
  ALTER TABLE rooms ADD COLUMN lead_bot_id TEXT;
  `,
  // v18：任务记下自己的对话是哪个聊天室：交进群的任务在那个群里干，一个群放得下好几个任务（聊天室上只挂得了一个任务）。
  `
  ALTER TABLE tasks ADD COLUMN conversation_id TEXT;
  `,
  // v19：用量改对口径。dsh 报的 input_tokens 本来就不含命中缓存的，以前当成了全部输入：花费少算，会话的上下文长度只记了没命中的那一点，
  // 到了换段长度也不换。按当时的价格表（pod-domain 的 cost.ts）重算每次的花费，会话的花费跟着汇总；
  // 会话的上下文长度改成最近一次请求的全部输入，超过换段长度的下一轮就换段。
  `
  UPDATE usage SET cost = (usage.cache_tokens * p.hit + usage.input_tokens * p.miss + usage.output_tokens * p.out) / 1000000.0
  FROM (
    SELECT 0 AS pro, 0 AS peak, 0.003 AS hit, 0.15 AS miss, 0.6 AS out
    UNION ALL SELECT 0, 1, 0.006, 0.3, 1.2
    UNION ALL SELECT 1, 0, 0.022, 0.66, 1.98
    UNION ALL SELECT 1, 1, 0.044, 1.32, 3.96
  ) AS p
  WHERE usage.cost IS NOT NULL AND p.peak = usage.peak
    AND p.pro = (usage.model NOT LIKE '%flash%' AND usage.model NOT LIKE '%chat%' AND usage.model NOT LIKE '%v3%'
      AND (usage.model LIKE '%pro%' OR usage.model LIKE '%reasoner%' OR usage.model LIKE '%r1%'));

  UPDATE sessions SET
    cost = (SELECT SUM(COALESCE(u.cost, 0)) FROM usage u WHERE u.session_id = sessions.id),
    context_tokens = (SELECT u.input_tokens + u.cache_tokens FROM usage u WHERE u.session_id = sessions.id ORDER BY u.id DESC LIMIT 1)
  WHERE EXISTS (SELECT 1 FROM usage u WHERE u.session_id = sessions.id);
  `,
]

function readVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { readonly user_version?: number } | undefined
  return row?.user_version ?? 0
}

/** 把库升到最新版本；每条迁移在自己的事务里执行，失败就回滚并抛出。 */
export function migrate(db: DatabaseSync): void {
  const current = readVersion(db)
  MIGRATIONS.forEach((sql, index) => {
    const version = index + 1
    if (version <= current) return
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.exec(`PRAGMA user_version = ${version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  })
}

export const SCHEMA_VERSION = MIGRATIONS.length
