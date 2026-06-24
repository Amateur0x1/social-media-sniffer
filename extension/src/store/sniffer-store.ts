/**
 * 被动嗅探数据存储。
 *
 * 设计原则：只存数据，不发请求。
 * 所有数据都来自页面自己发的 API 响应，通过 content script 监听后存入这里。
 *
 * 两个数据来源：
 * 1. explore — 发现页浏览到的笔记（研究竞品内容）
 * 2. user — 特定博主主页的笔记（研究对标博主，按博主分组）
 */

// ── 页面来源类型 ──

/** 页面上下文，区分数据来自哪个场景 */
export type PageContext =
  | { page: "explore" }
  | { page: "user"; user_id: string; user_name?: string }
  | { page: "note_detail" }; // 笔记详情页 /explore/{note_id}

// ── 类型定义 ──

export interface VideoDetail {
  /** 视频流 URL（优先取 h264 最高画质） */
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
  type: string; // "video" | "normal"
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
  stats: {
    feedRequests: number;
    commentRequests: number;
    userPostedRequests: number;
  };
}

// ── 初始状态 ──

function emptyData(): SnifferData {
  return {
    notes: {},
    comments: {},
    noteCards: [],
    userProfiles: {},
    stats: {
      feedRequests: 0,
      commentRequests: 0,
      userPostedRequests: 0,
    },
  };
}

// ── Storage key ──

const STORAGE_KEY = "cheat_sniffer_data";

// ── 读写 chrome.storage.local ──

export async function loadData(): Promise<SnifferData> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const data = (result[STORAGE_KEY] as SnifferData) ?? emptyData();
  // 兼容旧数据：如果没有 userProfiles 字段就补上
  if (!data.userProfiles) data.userProfiles = {};
  return data;
}

export async function saveData(data: SnifferData): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

export async function clearData(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: emptyData() });
}

// ── 辅助：安全转数字 ──

export function toInt(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseInt(v, 10) || 0;
  return 0;
}

// ── 页面 URL → PageContext 解析 ──

export function parsePageContext(url: string): PageContext {
  try {
    const u = new URL(url);

    // /user/profile/{user_id}
    const userMatch = u.pathname.match(/^\/user\/profile\/([a-f0-9]+)/);
    if (userMatch) {
      return { page: "user", user_id: userMatch[1] };
    }

    // /explore/{note_id} — 具体笔记详情页
    const noteMatch = u.pathname.match(/^\/explore\/([a-f0-9]+)/);
    if (noteMatch) {
      return { page: "note_detail" };
    }

    // /explore 或其他 www.xiaohongshu.com 页面
    return { page: "explore" };
  } catch {
    return { page: "explore" };
  }
}
