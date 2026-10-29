/**
 * 被动嗅探数据存储 — 多平台版 v2。
 *
 * 设计原则：只存数据，不发请求。
 * 所有数据都来自页面自己发的 API 响应，通过 content script 监听后存入这里。
 *
 * ## 为什么分片
 *
 * v1 把整个平台的数据塞进一个 storage key，每收到一条响应就要把
 * 全部笔记 + 评论读出来再整块写回去。笔记上千条之后：
 *   1. 单次写入是 O(n) 的序列化，刷新一次信息流能卡住 service worker；
 *   2. chrome.storage.local 默认只有 10MB，写超配额会抛 QUOTA_BYTES，
 *      旧的错误处理只是 console.error，用户侧看起来一切正常但数据全丢。
 *
 * v2 拆成按 note_id 分片的 key，一次写入只碰真正变化的切片：
 *
 *   sms:<platform>:meta               { stats, userProfiles }
 *   sms:<platform>:cards              NoteCard[]
 *   sms:<platform>:note:<note_id>     NoteEntry
 *   sms:<platform>:comment:<note_id>  CommentEntry[]
 *
 * 旧版单 key 数据会在首次读取时自动迁移（迁移成功后才删除旧 key）。
 */

import type { PlatformKey } from "../types/common";

// ── 页面来源类型 ──

/** 页面上下文，区分数据来自哪个场景 */
export type PageContext =
  | { page: "explore" }
  | { page: "user"; user_id: string; user_name?: string }
  | { page: "note_detail" }; // 笔记/视频详情页

// ── 类型定义 ──

export interface VideoDetail {
  page_url?: string;
  audio_url?: string;
  referer?: string;
  /** 视频流 URL（优先取最高画质） */
  video_url?: string;
  /** 所有可用的视频流 URL */
  video_urls?: string[];
  /** 视频时长（秒） */
  duration?: number;
  /** 原始视频 key */
  origin_video_key?: string;
  /** 视频首帧 / 缩略图 file_id */
  first_frame_fileid?: string;
  thumbnail_fileid?: string;
  /** 视频宽高 */
  width?: number;
  height?: number;
}

export interface NoteEntry {
  note_id: string;
  title: string;
  desc: string;
  type: string; // "video" | "normal" | "image"
  time: number;
  ip_location: string;
  like_count: number;
  collect_count: number;
  comment_count: number;
  share_count: number;
  tags: string[];
  images: string[];
  /** 视频笔记的视频详情 */
  video?: VideoDetail;
  author?: string;
  author_id?: string;
  /** 数据来源页面 */
  source: "explore" | "user" | "note_detail";
  /** user 来源时，所属博主的 user_id */
  source_user_id?: string;
  /** 所属平台（冗余存储便于导出） */
  platform?: PlatformKey;
  /** B站专用：评论接口以 aid 为 oid，需要它才能把评论关联回 bvid */
  aid?: number;
}

export interface CommentEntry {
  cid: string;
  text: string;
  like_count: number;
  sub_comment_count: number;
  create_time: number;
  user_name: string;
  ip_label: string;
}

export interface NoteCard {
  note_id: string;
  xsec_token: string;
  title: string;
  type: string;
  liked_count: number;
  cover_url: string;
  author?: string;
  author_id?: string;
  /** 从哪个博主主页采集到的 */
  source_user_id?: string;
}

/** 博主信息（从 user 页面自动记录） */
export interface UserProfile {
  user_id: string;
  user_name: string;
  /** 笔记数量 */
  note_count: number;
  /** 首次采集时间 */
  first_seen: number;
  /** 最近一次更新 */
  updated_at?: number;
  /** 以下字段仅部分平台提供 */
  avatar?: string;
  signature?: string;
  follower_count?: number;
  following_count?: number;
  /** 获赞总数（抖音）/ 总播放（B站可拓展） */
  total_favorited?: number;
  platform?: PlatformKey;
}

export interface SnifferStats {
  feedRequests: number;
  commentRequests: number;
  userPostedRequests: number;
}

export interface SnifferData {
  /** 按笔记 ID 存储的笔记详情 */
  notes: Record<string, NoteEntry>;
  /** 按笔记 ID 存储的评论列表 */
  comments: Record<string, CommentEntry[]>;
  /** 博主笔记卡片列表（来自 user_posted API） */
  noteCards: NoteCard[];
  /** 采集到的博主信息 */
  userProfiles: Record<string, UserProfile>;
  stats: SnifferStats;
}

/** 一次嗅探处理产生的增量变更，只有出现在这里的切片会被写盘 */
export interface SnifferChange {
  meta?: { stats: SnifferStats; userProfiles: Record<string, UserProfile> };
  noteCards?: NoteCard[];
  notes?: NoteEntry[];
  comments?: Array<{ noteId: string; entries: CommentEntry[] }>;
  /** 需要删除的评论分片（例如 aid_ 伪 key 合并后清理） */
  removedComments?: string[];
}

// ── 初始状态 ──

function emptyStats(): SnifferStats {
  return {
    feedRequests: 0,
    commentRequests: 0,
    userPostedRequests: 0,
  };
}

function emptyData(): SnifferData {
  return {
    notes: {},
    comments: {},
    noteCards: [],
    userProfiles: {},
    stats: emptyStats(),
  };
}

// ── Storage key 布局 ──

const NAMESPACE = "sms";

const PREFIXES: Record<PlatformKey, string> = {
  xhs: `${NAMESPACE}:xhs:`,
  bilibili: `${NAMESPACE}:bilibili:`,
  douyin: `${NAMESPACE}:douyin:`,
};

/** v1 的单 key，仅用于迁移 */
const LEGACY_KEYS: Record<PlatformKey, string> = {
  xhs: "cheat_sniffer_data",
  bilibili: "cheat_sniffer_data_bili",
  douyin: "cheat_sniffer_data_dy",
};

const NOTE_PREFIX = "note:";
const COMMENT_PREFIX = "comment:";
const META_KEY = "meta";
const CARDS_KEY = "cards";

function metaKey(platform: PlatformKey): string {
  return PREFIXES[platform] + META_KEY;
}

function cardsKey(platform: PlatformKey): string {
  return PREFIXES[platform] + CARDS_KEY;
}

function noteKey(platform: PlatformKey, noteId: string): string {
  return PREFIXES[platform] + NOTE_PREFIX + noteId;
}

function commentKey(platform: PlatformKey, noteId: string): string {
  return PREFIXES[platform] + COMMENT_PREFIX + noteId;
}

// ── v1 → v2 迁移 ──
//
// 迁移用 Promise 缓存去重：同一个 JS 上下文里不会重复执行。
// 跨上下文（service worker / side panel）可能各跑一次，但写入内容一致，
// 且都遵循「先写 v2 再删旧 key」，最坏情况只是重复写一遍。

const migrationTasks = new Map<PlatformKey, Promise<void>>();

function ensureMigrated(platform: PlatformKey): Promise<void> {
  const existing = migrationTasks.get(platform);
  if (existing) return existing;

  const task = migrateLegacy(platform).catch((err) => {
    console.error("[SM Sniffer] 数据迁移失败:", err);
  });
  migrationTasks.set(platform, task);
  return task;
}

async function migrateLegacy(platform: PlatformKey): Promise<void> {
  const legacyKey = LEGACY_KEYS[platform];
  const result = await chrome.storage.local.get(legacyKey);
  const legacy = result[legacyKey] as SnifferData | undefined;
  if (!legacy) return;

  await writeSnapshot(platform, legacy);
  await chrome.storage.local.remove(legacyKey);
  console.log("[SM Sniffer] 已迁移 v1 数据到分片存储:", platform);
}

async function writeSnapshot(platform: PlatformKey, data: SnifferData): Promise<void> {
  const batch: Record<string, unknown> = {
    [metaKey(platform)]: {
      stats: { ...emptyStats(), ...(data.stats ?? {}) },
      userProfiles: data.userProfiles ?? {},
    },
    [cardsKey(platform)]: data.noteCards ?? [],
  };

  for (const [noteId, note] of Object.entries(data.notes ?? {})) {
    batch[noteKey(platform, noteId)] = note;
  }
  for (const [noteId, comments] of Object.entries(data.comments ?? {})) {
    batch[commentKey(platform, noteId)] = comments;
  }

  await chrome.storage.local.set(batch);
}

// ── 读取 ──

/**
 * 读取某个平台的全量数据（侧栏渲染、迁移后回读都走这里）。
 *
 * 底层是一次 `get(null)`：分片之后 key 数量多了，但每个分片都很小，
 * 相比 v1 的单个巨型 key，整体传输量反而更低，也不会撞配额。
 */
export async function loadData(platform: PlatformKey = "xhs"): Promise<SnifferData> {
  await ensureMigrated(platform);

  const prefix = PREFIXES[platform];
  const all = (await chrome.storage.local.get(null)) as Record<string, unknown>;
  const data = emptyData();

  for (const key of Object.keys(all)) {
    if (!key.startsWith(prefix)) continue;

    const rest = key.slice(prefix.length);
    const value = all[key];

    if (rest === META_KEY) {
      const meta = value as { stats?: Partial<SnifferStats>; userProfiles?: Record<string, UserProfile> } | undefined;
      if (meta?.stats) data.stats = { ...emptyStats(), ...meta.stats };
      if (meta?.userProfiles) data.userProfiles = meta.userProfiles;
    } else if (rest === CARDS_KEY) {
      if (Array.isArray(value)) data.noteCards = value as NoteCard[];
    } else if (rest.startsWith(NOTE_PREFIX)) {
      const noteId = rest.slice(NOTE_PREFIX.length);
      if (value) data.notes[noteId] = value as NoteEntry;
    } else if (rest.startsWith(COMMENT_PREFIX)) {
      const noteId = rest.slice(COMMENT_PREFIX.length);
      if (Array.isArray(value)) data.comments[noteId] = value as CommentEntry[];
    }
  }

  return data;
}

// ── 写入 ──

/** 只写入本次真正发生变化的分片 */
export async function saveChanges(platform: PlatformKey, change: SnifferChange): Promise<void> {
  const batch: Record<string, unknown> = {};

  if (change.meta) batch[metaKey(platform)] = change.meta;
  if (change.noteCards) batch[cardsKey(platform)] = change.noteCards;
  if (change.notes) {
    for (const note of change.notes) batch[noteKey(platform, note.note_id)] = note;
  }
  if (change.comments) {
    for (const { noteId, entries } of change.comments) {
      batch[commentKey(platform, noteId)] = entries;
    }
  }

  if (Object.keys(batch).length === 0) return;
  await chrome.storage.local.set(batch);

  if (change.removedComments?.length) {
    await chrome.storage.local.remove(change.removedComments.map((id) => commentKey(platform, id)));
  }
}

/** 清空某个平台的全部数据（含旧版 key） */
export async function clearData(platform: PlatformKey = "xhs"): Promise<void> {
  const prefix = PREFIXES[platform];
  const all = (await chrome.storage.local.get(null)) as Record<string, unknown>;
  const keys = Object.keys(all).filter(
    (key) => key.startsWith(prefix) || key === LEGACY_KEYS[platform]
  );
  if (keys.length > 0) await chrome.storage.local.remove(keys);
}

// ── 辅助：安全转数字 ──

export function toInt(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseInt(v, 10) || 0;
  return 0;
}

// ── 页面 URL → PageContext 解析 ──

/** 小红书 URL 解析 */
export function parseXhsPageContext(url: string): PageContext {
  try {
    const u = new URL(url);
    const userMatch = u.pathname.match(/^\/user\/profile\/([a-f0-9]+)/);
    if (userMatch) {
      return { page: "user", user_id: userMatch[1] };
    }
    // 详情页有两种常见形态：/explore/{id} 和 /discovery/item/{id}
    const noteMatch = u.pathname.match(/^\/(?:explore|discovery\/item)\/([a-f0-9]+)/);
    if (noteMatch) {
      return { page: "note_detail" };
    }
    return { page: "explore" };
  } catch {
    return { page: "explore" };
  }
}

/** B站 URL 解析 */
export function parseBiliPageContext(url: string): PageContext {
  try {
    const u = new URL(url);

    // 个人空间有两种域名形态，都要认：
    //   https://space.bilibili.com/{mid}/video
    //   https://www.bilibili.com/space/{mid}
    if (u.hostname === "space.bilibili.com") {
      const subMatch = u.pathname.match(/^\/(\d+)/);
      if (subMatch) {
        return { page: "user", user_id: subMatch[1] };
      }
    }

    const spaceMatch = u.pathname.match(/^\/space\/(\d+)/);
    if (spaceMatch) {
      return { page: "user", user_id: spaceMatch[1] };
    }

    // /video/{bvid} 视频详情
    const videoMatch = u.pathname.match(/^\/video\/(BV[\w]+)/i);
    if (videoMatch) {
      return { page: "note_detail" };
    }

    return { page: "explore" };
  } catch {
    return { page: "explore" };
  }
}

/** 抖音 URL 解析 */
export function parseDyPageContext(url: string): PageContext {
  try {
    const u = new URL(url);
    // /user/{sec_uid}
    const userMatch = u.pathname.match(/^\/user\/(MS4w[\w-]+|[\w-]{10,})/);
    if (userMatch) {
      return { page: "user", user_id: userMatch[1] };
    }
    // /video/{id} 或 /note/{id}
    const videoMatch = u.pathname.match(/^\/(video|note)\/(\d+)/);
    if (videoMatch) {
      return { page: "note_detail" };
    }
    return { page: "explore" };
  } catch {
    return { page: "explore" };
  }
}

/** 统一入口：根据平台选择解析器 */
export function parsePageContext(url: string, platform: PlatformKey = "xhs"): PageContext {
  switch (platform) {
    case "xhs":
      return parseXhsPageContext(url);
    case "bilibili":
      return parseBiliPageContext(url);
    case "douyin":
      return parseDyPageContext(url);
    default:
      return { page: "explore" };
  }
}
