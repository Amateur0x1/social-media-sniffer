/**
 * Service Worker — 数据汇聚中心（多平台版）。
 *
 * 接收来自各平台 content script 的 SNIFFER_DATA 消息，
 * 根据 platform 字段路由到对应的处理器，
 * 解析后以「分片 + 增量」的方式写入 chrome.storage.local。
 *
 * 设计原则：只聚合数据，不发任何网络请求。
 *
 * ## 写入策略
 *
 * 解析在内存里完成（getData 带进程内缓存，service worker 被回收后自动重建），
 * 处理过程中用 Tx 记录哪几篇笔记 / 哪几篇评论 / meta 真的变了，
 * 最后只落盘这些切片。相比 v1 的「每条消息全量读 + 全量写」，
 * 大账号数据量下的写入成本从 O(笔记数) 降到 O(本次变更数)。
 */

/// <reference types="chrome" />

import type { SniffMessage, PlatformKey } from "./types/common";
import type {
  NoteEntry,
  CommentEntry,
  NoteCard,
  SnifferData,
  UserProfile,
  VideoDetail,
  PageContext,
  SnifferChange,
} from "./store/sniffer-store";
import {
  loadData,
  saveChanges,
  clearData,
  toInt,
  parsePageContext,
} from "./store/sniffer-store";

// ── Side Panel 状态追踪 ──

const sidePanelStatus = {
  isRunning: false,
  port: null as chrome.runtime.Port | null,
};

// ── 扩展安装 ──

chrome.runtime.onInstalled.addListener(() => {
  console.log("[SM Sniffer] 扩展已安装");
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// ── Side Panel 连接监听 ──

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "sidepanel") {
    console.log("[SM Sniffer] Side panel 已连接");
    sidePanelStatus.isRunning = true;
    sidePanelStatus.port = port;

    port.onDisconnect.addListener(() => {
      console.log("[SM Sniffer] Side panel 已断开");
      sidePanelStatus.isRunning = false;
      sidePanelStatus.port = null;
    });
  }
});

// ── 进程内数据缓存 ──
//
// 所有写入都经过 service worker，所以缓存与 storage 始终一致；
// service worker 被浏览器回收时缓存一起消失，下次消息会重新从 storage 重建。

const dataCache = new Map<PlatformKey, SnifferData>();

async function getData(platform: PlatformKey): Promise<SnifferData> {
  const cached = dataCache.get(platform);
  if (cached) return cached;

  const data = await loadData(platform);
  dataCache.set(platform, data);
  return data;
}

// ── 变更追踪 ──
//
// 处理函数只负责在内存里改 SnifferData，同时用 Tx 标脏；
// 落盘时只写被标脏的切片。

class Tx {
  private readonly notes = new Set<string>();
  private readonly comments = new Set<string>();
  private readonly removedComments = new Set<string>();
  private cards = false;
  private meta = false;

  note(noteId: string): void {
    this.notes.add(noteId);
  }

  comment(noteId: string): void {
    this.comments.add(noteId);
  }

  dropComment(noteId: string): void {
    this.comments.delete(noteId);
    this.removedComments.add(noteId);
  }

  card(): void {
    this.cards = true;
  }

  stats(): void {
    this.meta = true;
  }

  profile(): void {
    this.meta = true;
  }

  toChange(data: SnifferData): SnifferChange {
    const change: SnifferChange = {};

    if (this.notes.size > 0) {
      change.notes = [...this.notes]
        .map((id) => data.notes[id])
        .filter((note): note is NoteEntry => Boolean(note));
    }

    if (this.comments.size > 0) {
      change.comments = [...this.comments].map((id) => ({
        noteId: id,
        entries: data.comments[id] ?? [],
      }));
    }

    if (this.removedComments.size > 0) {
      change.removedComments = [...this.removedComments];
    }

    if (this.cards) change.noteCards = data.noteCards;
    if (this.meta) change.meta = { stats: data.stats, userProfiles: data.userProfiles };

    return change;
  }
}

// 按接收顺序写入，避免详情和播放响应并发覆盖。
let sniffQueue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  sniffQueue = sniffQueue.catch(() => {}).then(task);
  return sniffQueue;
}

function notifyPanel(platform: PlatformKey): void {
  try {
    chrome.runtime.sendMessage({ type: "SNIFFER_UPDATED", platform });
  } catch {
    /* side panel 可能没打开 */
  }
}

// ── 消息处理 ──

type ControlMessage = { type: "SNIFFER_CLEAR"; platform: PlatformKey };

chrome.runtime.onMessage.addListener(
  (message: SniffMessage | ControlMessage, _sender, sendResponse) => {
    if (message.type === "SNIFFER_CLEAR") {
      enqueue(async () => {
        dataCache.delete(message.platform);
        await clearData(message.platform);
        notifyPanel(message.platform);
      })
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error("[SM Sniffer] 清空数据失败:", err);
          sendResponse({ ok: false, reason: String(err) });
        });
      return true;
    }

    if (message.type !== "SNIFFER_DATA") {
      sendResponse({ ok: false, reason: "unknown message type" });
      return;
    }

    enqueue(() => handleSniffData(message))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[SM Sniffer] 处理数据失败:", err);
        sendResponse({ ok: false, reason: String(err) });
      });

    return true;
  }
);

async function handleSniffData(msg: SniffMessage): Promise<void> {
  const platform: PlatformKey = msg.platform || "xhs"; // 兼容旧版消息
  const data = await getData(platform);
  const payload = msg.payload as Record<string, unknown>;
  const ctx = parsePageContext(msg.pageUrl, platform);
  const tx = new Tx();

  switch (platform) {
    case "xhs":
      handleXhs(data, msg, payload, ctx, tx);
      break;
    case "bilibili":
      handleBilibili(data, msg, payload, ctx, tx);
      break;
    case "douyin":
      handleDouyin(data, msg, payload, ctx, tx);
      break;
  }

  const change = tx.toChange(data);
  if (Object.keys(change).length === 0) return; // 没有任何变化，不必写盘也不必刷新面板

  await saveChanges(platform, change);

  // 落盘成功后才广播，避免面板读到半写状态
  notifyPanel(platform);
}

// ═══════════════════════════════════════════
// ██  小红书处理器
// ═══════════════════════════════════════════

function handleXhs(
  data: SnifferData,
  msg: SniffMessage,
  payload: Record<string, unknown>,
  ctx: PageContext,
  tx: Tx
): void {
  // user_posted API 一定来自 user 页面
  if (msg.source === "user_posted" && ctx.page !== "user") {
    const userId = extractUserIdFromApiUrl(msg.url);
    if (userId) {
      ctx = { page: "user", user_id: userId };
    }
  }

  switch (msg.source) {
    case "feed":
      mergeXhsFeed(data, payload, ctx, tx);
      break;
    case "comment":
      mergeXhsComments(data, payload, tx);
      break;
    case "user_posted":
      mergeXhsUserPosted(data, payload, ctx, tx);
      break;
  }
}

function mergeXhsFeed(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext, tx: Tx): void {
  data.stats.feedRequests++;
  tx.stats();

  const items = (raw as { data?: { items?: unknown[] } }).data?.items;
  if (!Array.isArray(items)) return;

  const source = ctx.page === "user" ? "user" as const
    : ctx.page === "note_detail" ? "note_detail" as const
    : "explore" as const;

  for (const item of items) {
    const card = (item as { note_card?: Record<string, unknown> }).note_card;
    if (!card) continue;

    const noteId = card.note_id as string;
    if (!noteId) continue;

    const interact = card.interact_info as Record<string, unknown> | undefined;
    const user = card.user as Record<string, unknown> | undefined;
    const tagList = card.tag_list as Array<{ name: string }> | undefined;
    const imageList = card.image_list as Array<Record<string, unknown>> | undefined;

    const videoObj = card.video as Record<string, unknown> | undefined;
    let videoDetail: VideoDetail | undefined;
    if ((card.type as string) === "video" && videoObj) {
      videoDetail = extractXhsVideo(videoObj);
    }

    const images = (imageList ?? [])
      .map((img) => extractImageUrl(img))
      .filter((url): url is string => Boolean(url));

    data.notes[noteId] = {
      note_id: noteId,
      title: (card.title as string) || "",
      desc: (card.desc as string) || "",
      type: (card.type as string) || "normal",
      time: (card.time as number) || 0,
      ip_location: (card.ip_location as string) || "",
      like_count: toInt(interact?.liked_count),
      collect_count: toInt(interact?.collected_count),
      comment_count: toInt(interact?.comment_count),
      share_count: toInt(interact?.share_count),
      tags: tagList?.map((t) => t.name) ?? [],
      images,
      video: videoDetail,
      author: (user?.nickname as string) || undefined,
      author_id: (user?.user_id as string) || undefined,
      source,
      source_user_id: ctx.page === "user" ? ctx.user_id : undefined,
      platform: "xhs",
    };
    tx.note(noteId);

    if (ctx.page === "user" && user) {
      updateUserProfile(data, ctx.user_id, (user.nickname as string) || "", tx);
    }
  }
}

function mergeXhsComments(data: SnifferData, raw: Record<string, unknown>, tx: Tx): void {
  data.stats.commentRequests++;
  tx.stats();

  const comments = (raw as { data?: { comments?: unknown[] } }).data?.comments;
  if (!Array.isArray(comments)) return;

  for (const c of comments) {
    const comment = c as Record<string, unknown>;
    const noteId = comment.note_id as string;
    const cid = comment.id as string;
    if (!noteId || !cid) continue;

    const userInfo = comment.user_info as Record<string, unknown> | undefined;

    const entry: CommentEntry = {
      cid,
      text: (comment.content as string) || "",
      like_count: toInt(comment.like_count),
      sub_comment_count: toInt(comment.sub_comment_count),
      create_time: (comment.create_time as number) || 0,
      user_name: (userInfo?.nickname as string) || "",
      ip_label: (comment.ip_location as string) || "",
    };

    if (!data.comments[noteId]) {
      data.comments[noteId] = [];
    }
    const existing = data.comments[noteId];
    if (!existing.some((e) => e.cid === cid)) {
      existing.push(entry);
      tx.comment(noteId);
    }
  }
}

function mergeXhsUserPosted(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext, tx: Tx): void {
  data.stats.userPostedRequests++;
  tx.stats();

  const notes = (raw as { data?: { notes?: unknown[] } }).data?.notes;
  if (!Array.isArray(notes)) return;

  const sourceUserId = ctx.page === "user" ? ctx.user_id : undefined;

  for (const n of notes) {
    const note = n as Record<string, unknown>;
    const noteId = note.note_id as string;
    const xsecToken = note.xsec_token as string;
    if (!noteId) continue;

    const user = note.user as Record<string, unknown> | undefined;
    const interact = note.interact_info as Record<string, unknown> | undefined;
    const cover = note.cover as Record<string, unknown> | undefined;

    const card: NoteCard = {
      note_id: noteId,
      xsec_token: xsecToken || "",
      title: (note.display_title as string) || "",
      type: (note.type as string) || "normal",
      liked_count: toInt(interact?.liked_count),
      cover_url: cover ? (extractImageUrl(cover) || "") : "",
      author: (user?.nickname as string) || (user?.nick_name as string) || undefined,
      author_id: (user?.user_id as string) || undefined,
      source_user_id: sourceUserId,
    };

    if (!data.noteCards.some((c) => c.note_id === noteId)) {
      data.noteCards.push(card);
      tx.card();
    }

    if (ctx.page === "user" && user) {
      updateUserProfile(
        data,
        ctx.user_id,
        (user.nickname as string) || (user.nick_name as string) || "",
        tx
      );
    }
  }
}

// ═══════════════════════════════════════════
// ██  B站处理器
// ═══════════════════════════════════════════

function handleBilibili(
  data: SnifferData,
  msg: SniffMessage,
  payload: Record<string, unknown>,
  ctx: PageContext,
  tx: Tx
): void {
  switch (msg.source) {
    case "bili_playurl":
      mergeBiliPlayurl(data, payload, msg, tx);
      break;
    case "bili_rcmd":
      mergeBiliRcmd(data, payload, tx);
      break;
    case "bili_popular":
      mergeBiliPopular(data, payload, tx);
      break;
    case "bili_video_detail":
      mergeBiliVideoDetail(data, payload, ctx, tx);
      break;
    case "bili_reply":
      mergeBiliReply(data, payload, msg.url, tx);
      break;
    case "bili_user_video":
      mergeBiliUserVideo(data, payload, ctx, tx);
      break;
  }
}

/** 仅消费页面已请求的播放信息，不主动调用 B站 API。 */
function mergeBiliPlayurl(data: SnifferData, raw: Record<string, unknown>, msg: SniffMessage, tx: Tx): void {
  if (raw.code !== 0) return;
  const params = new URL(msg.url).searchParams;
  const bvid = params.get("bvid") || /\/video\/(BV[\w]+)/i.exec(msg.pageUrl)?.[1];
  if (!bvid) return;
  const play = raw.data as { dash?: { video?: Array<{ baseUrl?: string; base_url?: string; bandwidth?: number; width?: number; height?: number }>; audio?: Array<{ baseUrl?: string; base_url?: string; bandwidth?: number }> }; durl?: Array<{ url: string }>; timelength?: number } | undefined;
  if (!play) return;
  const video = [...(play.dash?.video || [])].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
  const audio = [...(play.dash?.audio || [])].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
  // 多段 durl 用页面链接交给下载器完整合并，避免只导出第一段。
  const url = video?.baseUrl || video?.base_url || (play.durl?.length === 1 ? play.durl[0].url : undefined);
  const entry = data.notes[bvid] || biliVideoToNote({ bvid }, "note_detail");
  if (!entry) return;
  const pageUrl = msg.pageUrl;
  entry.video = {
    ...entry.video,
    page_url: pageUrl,
    referer: pageUrl,
    video_url: url,
    audio_url: audio?.baseUrl || audio?.base_url,
    width: video?.width,
    height: video?.height,
    duration: play.timelength ? play.timelength / 1000 : entry.video?.duration,
  };
  data.notes[bvid] = entry;
  tx.note(bvid);
}

/** 将一个 B站视频对象转换为 NoteEntry（热门/推荐/详情页共用） */
function biliVideoToNote(
  v: Record<string, unknown>,
  source: "explore" | "user" | "note_detail",
  sourceUserId?: string
): NoteEntry | null {
  const bvid = v.bvid as string;
  if (!bvid) return null;

  const owner = v.owner as Record<string, unknown> | undefined;
  const stat = v.stat as Record<string, unknown> | undefined;
  const aid = v.aid as number | undefined;

  return {
    note_id: bvid,
    title: (v.title as string) || "",
    desc: (v.desc as string) || "",
    type: "video",
    time: ((v.pubdate as number) || 0) * 1000,
    ip_location: "",
    like_count: toInt(stat?.like),
    collect_count: toInt(stat?.favorite),
    comment_count: toInt(stat?.reply),
    share_count: toInt(stat?.share),
    tags: [],
    images: (v.pic as string) ? [v.pic as string] : [],
    video: {
      page_url: `https://www.bilibili.com/video/${bvid}`,
      duration: v.duration as number | undefined,
    },
    author: (owner?.name as string) || undefined,
    author_id: owner?.mid != null ? String(owner.mid) : undefined,
    source,
    source_user_id: sourceUserId,
    platform: "bilibili",
    aid,
  };
}

/**
 * 写入 B站笔记并处理关联数据。
 *
 * 两件事：
 * 1. 新旧数据合并 —— 新的统计字段优先，已有的视频直链 / 归属博主优先保留。
 * 2. 孤儿评论回填 —— 评论接口只带 aid，如果评论先于详情到达，
 *    会被临时挂在 `aid_<aid>` 上，这里把它迁回 bvid。
 */
function upsertBiliNote(data: SnifferData, entry: NoteEntry, tx: Tx): void {
  const existing = data.notes[entry.note_id];
  const aid = entry.aid ?? existing?.aid;

  data.notes[entry.note_id] = {
    ...existing,
    ...entry,
    aid,
    // 从博主主页采集到的归属信息不应该被之后的信息流请求冲掉
    source: entry.source_user_id ? entry.source : (existing?.source ?? entry.source),
    source_user_id: entry.source_user_id ?? existing?.source_user_id,
    images: entry.images.length > 0 ? entry.images : (existing?.images ?? []),
    tags: entry.tags.length > 0 ? entry.tags : (existing?.tags ?? []),
    video: { ...entry.video, ...existing?.video },
  };

  tx.note(entry.note_id);
  adoptOrphanComments(data, entry.note_id, aid, tx);
}

/** 把先到达、暂时挂在 aid_ 伪 key 上的评论合并回 bvid */
function adoptOrphanComments(
  data: SnifferData,
  bvid: string,
  aid: number | undefined,
  tx: Tx
): void {
  if (!aid) return;

  const orphanKey = `aid_${aid}`;
  const orphan = data.comments[orphanKey];
  if (!orphan || orphan.length === 0) return;

  const merged = data.comments[bvid] ?? [];
  for (const comment of orphan) {
    if (!merged.some((e) => e.cid === comment.cid)) merged.push(comment);
  }

  data.comments[bvid] = merged;
  delete data.comments[orphanKey];

  tx.comment(bvid);
  tx.dropComment(orphanKey);
}

/** 首页推荐流 /x/web-interface/wbi/index/top/feed/rcmd */
function mergeBiliRcmd(data: SnifferData, raw: Record<string, unknown>, tx: Tx): void {
  data.stats.feedRequests++;
  tx.stats();

  // 推荐流数据在 data.item 数组中
  const dataObj = raw.data as { item?: unknown[] } | undefined;
  const items = dataObj?.item;
  if (!Array.isArray(items)) return;

  for (const item of items) {
    const entry = biliVideoToNote(item as Record<string, unknown>, "explore");
    if (entry) upsertBiliNote(data, entry, tx);
  }
}

/** 热门排行榜 /x/web-interface/popular */
function mergeBiliPopular(data: SnifferData, raw: Record<string, unknown>, tx: Tx): void {
  data.stats.feedRequests++;
  tx.stats();

  const dataObj = raw.data as { list?: unknown[] } | undefined;
  const list = dataObj?.list;
  if (!Array.isArray(list)) return;

  for (const item of list) {
    const entry = biliVideoToNote(item as Record<string, unknown>, "explore");
    if (entry) upsertBiliNote(data, entry, tx);
  }
}

/** 视频详情 /x/web-interface/wbi/view/detail — 数据嵌套在 data.View 中 */
function mergeBiliVideoDetail(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext, tx: Tx): void {
  data.stats.feedRequests++;
  tx.stats();

  const dataObj = raw.data as Record<string, unknown> | undefined;
  if (!dataObj) return;

  // wbi/view/detail 聚合接口：视频信息在 data.View 中
  const v = (dataObj.View as Record<string, unknown>) || dataObj;
  if (!v.bvid) return;

  const source = ctx.page === "user" ? "user" as const : "note_detail" as const;
  const sourceUserId = ctx.page === "user" ? ctx.user_id : undefined;

  const entry = biliVideoToNote(v, source, sourceUserId);
  if (!entry) return;

  upsertBiliNote(data, entry, tx);

  if (ctx.page === "user") {
    const owner = v.owner as Record<string, unknown> | undefined;
    if (owner) {
      updateUserProfile(data, ctx.user_id, (owner.name as string) || "", tx);
    }
  }
}

function mergeBiliReply(data: SnifferData, raw: Record<string, unknown>, apiUrl: string, tx: Tx): void {
  data.stats.commentRequests++;
  tx.stats();

  const dataObj = raw.data as { replies?: unknown[]; upper?: { mid?: number } } | undefined;
  const replies = dataObj?.replies;
  if (!Array.isArray(replies)) return;

  // 从 API URL 参数中获取 oid (视频 aid)，用于关联评论
  // B站评论以 oid 为 key，但我们需要 bvid，只能用 oid 作为中间 key
  const oidMatch = apiUrl.match(/[?&]oid=(\d+)/);
  const oid = oidMatch ? oidMatch[1] : "";
  if (!oid) return;

  // 在已有笔记中查找对应的 bvid；找不到就先挂 aid_ 伪 key，等详情到达后回填
  const noteId = findBvidByAid(data, parseInt(oid, 10)) || `aid_${oid}`;

  for (const r of replies) {
    const reply = r as Record<string, unknown>;
    const rpid = reply.rpid as number;
    if (!rpid) continue;

    const content = reply.content as Record<string, unknown> | undefined;
    const member = reply.member as Record<string, unknown> | undefined;
    const replyControl = reply.reply_control as Record<string, unknown> | undefined;

    const entry: CommentEntry = {
      cid: String(rpid),
      text: (content?.message as string) || "",
      like_count: toInt(reply.like),
      sub_comment_count: toInt(reply.rcount),
      create_time: (reply.ctime as number) || 0,
      user_name: (member?.uname as string) || "",
      ip_label: (replyControl?.location as string)?.replace("IP属地：", "") || "",
    };

    if (!data.comments[noteId]) {
      data.comments[noteId] = [];
    }
    const existing = data.comments[noteId];
    if (!existing.some((e) => e.cid === entry.cid)) {
      existing.push(entry);
      tx.comment(noteId);
    }
  }
}

function mergeBiliUserVideo(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext, tx: Tx): void {
  data.stats.userPostedRequests++;
  tx.stats();

  const dataObj = raw.data as { list?: { vlist?: unknown[] } } | undefined;
  const vlist = dataObj?.list?.vlist;
  if (!Array.isArray(vlist)) return;

  const sourceUserId = ctx.page === "user" ? ctx.user_id : undefined;

  for (const v of vlist) {
    const item = v as Record<string, unknown>;
    const bvid = item.bvid as string;
    if (!bvid) continue;

    // arc/search 不返回点赞数，若之前从详情/信息流拿到过就复用
    const known = data.notes[bvid];

    const card: NoteCard = {
      note_id: bvid,
      xsec_token: "",
      title: (item.title as string) || "",
      type: "video",
      liked_count: known?.like_count ?? 0,
      cover_url: (item.pic as string) || "",
      author: (item.author as string) || undefined,
      author_id: item.mid != null ? String(item.mid) : undefined,
      source_user_id: sourceUserId,
    };

    const existingCard = data.noteCards.find((c) => c.note_id === bvid);
    if (existingCard) {
      Object.assign(existingCard, {
        ...card,
        liked_count: Math.max(existingCard.liked_count, card.liked_count),
      });
      tx.card();
    } else {
      data.noteCards.push(card);
      tx.card();
    }

    if (ctx.page === "user") {
      updateUserProfile(data, ctx.user_id, (item.author as string) || "", tx);
    }
  }
}

/** 通过 aid 在已采集的笔记中找到 bvid */
function findBvidByAid(data: SnifferData, aid: number): string | undefined {
  for (const [bvid, note] of Object.entries(data.notes)) {
    if (note.platform === "bilibili" && note.aid === aid) return bvid;
  }
  return undefined;
}

// ═══════════════════════════════════════════
// ██  抖音处理器
// ═══════════════════════════════════════════

function handleDouyin(
  data: SnifferData,
  msg: SniffMessage,
  payload: Record<string, unknown>,
  ctx: PageContext,
  tx: Tx
): void {
  switch (msg.source) {
    case "dy_recommend":
      mergeDyRecommend(data, payload, tx);
      break;
    case "dy_video_detail":
      mergeDyVideoDetail(data, payload, ctx, tx);
      break;
    case "dy_comment":
      mergeDyComment(data, payload, tx);
      break;
    case "dy_user_post":
      mergeDyUserPost(data, payload, ctx, tx);
      break;
    case "dy_user_profile":
      mergeDyUserProfile(data, payload, ctx, tx);
      break;
  }
}

function parseDyAwemeToNote(
  aweme: Record<string, unknown>,
  source: "explore" | "user" | "note_detail",
  sourceUserId?: string
): NoteEntry | null {
  const awemeId = aweme.aweme_id as string;
  if (!awemeId) return null;

  const author = aweme.author as Record<string, unknown> | undefined;
  const stats = aweme.statistics as Record<string, unknown> | undefined;
  const video = aweme.video as Record<string, unknown> | undefined;
  const textExtra = aweme.text_extra as Array<{ hashtag_name?: string }> | undefined;
  const images = aweme.images as Array<Record<string, unknown>> | undefined;
  const awemeType = aweme.aweme_type as number;

  // 提取视频信息
  let videoDetail: VideoDetail | undefined;
  if (video) {
    const playAddr = video.play_addr as { url_list?: string[] } | undefined;
    const cover = video.cover as { url_list?: string[] } | undefined;
    videoDetail = {
      video_url: playAddr?.url_list?.[0],
      video_urls: playAddr?.url_list,
      duration: video.duration ? Math.round((video.duration as number) / 1000) : undefined,
      width: video.width as number | undefined,
      height: video.height as number | undefined,
      first_frame_fileid: cover?.url_list?.[0],
    };
  }

  // 提取图文笔记图片
  const imageUrls: string[] = [];
  if (awemeType === 68 && Array.isArray(images)) {
    for (const img of images) {
      const urlList = img.url_list as string[] | undefined;
      if (urlList?.[0]) imageUrls.push(urlList[0]);
    }
  } else if (video) {
    const cover = video.cover as { url_list?: string[] } | undefined;
    if (cover?.url_list?.[0]) imageUrls.push(cover.url_list[0]);
  }

  return {
    note_id: awemeId,
    title: (aweme.desc as string) || "",
    desc: (aweme.desc as string) || "",
    type: awemeType === 68 ? "image" : "video",
    time: ((aweme.create_time as number) || 0) * 1000,
    ip_location: (aweme.ip_label as string) || "",
    like_count: toInt(stats?.digg_count),
    collect_count: toInt(stats?.collect_count),
    comment_count: toInt(stats?.comment_count),
    share_count: toInt(stats?.share_count),
    tags: (textExtra ?? [])
      .map((t) => t.hashtag_name)
      .filter((name): name is string => Boolean(name)),
    images: imageUrls,
    video: videoDetail,
    author: (author?.nickname as string) || undefined,
    author_id: (author?.sec_uid as string) || (author?.uid as string) || undefined,
    source,
    source_user_id: sourceUserId,
    platform: "douyin",
  };
}

function mergeDyRecommend(data: SnifferData, raw: Record<string, unknown>, tx: Tx): void {
  data.stats.feedRequests++;
  tx.stats();

  const awemeList = raw.aweme_list as unknown[] | undefined;
  if (!Array.isArray(awemeList)) return;

  for (const item of awemeList) {
    const entry = parseDyAwemeToNote(item as Record<string, unknown>, "explore");
    if (entry) {
      data.notes[entry.note_id] = entry;
      tx.note(entry.note_id);
    }
  }
}

function mergeDyVideoDetail(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext, tx: Tx): void {
  data.stats.feedRequests++;
  tx.stats();

  const aweme = raw.aweme_detail as Record<string, unknown> | undefined;
  if (!aweme) return;

  const source = ctx.page === "user" ? "user" as const : "note_detail" as const;
  const sourceUserId = ctx.page === "user" ? ctx.user_id : undefined;

  const entry = parseDyAwemeToNote(aweme, source, sourceUserId);
  if (!entry) return;

  // 详情比信息流的字段更全，但博主归属以已采集到的为准
  const existing = data.notes[entry.note_id];
  data.notes[entry.note_id] = {
    ...existing,
    ...entry,
    source: entry.source_user_id ? entry.source : (existing?.source ?? entry.source),
    source_user_id: entry.source_user_id ?? existing?.source_user_id,
  };
  tx.note(entry.note_id);

  if (ctx.page === "user") {
    const author = aweme.author as Record<string, unknown> | undefined;
    if (author) {
      updateUserProfile(data, ctx.user_id, (author.nickname as string) || "", tx);
    }
  }
}

function mergeDyComment(data: SnifferData, raw: Record<string, unknown>, tx: Tx): void {
  data.stats.commentRequests++;
  tx.stats();

  const comments = raw.comments as unknown[] | undefined;
  if (!Array.isArray(comments)) return;

  for (const c of comments) {
    const comment = c as Record<string, unknown>;
    const cid = comment.cid as string;
    const awemeId = comment.aweme_id as string;
    if (!cid || !awemeId) continue;

    const user = comment.user as Record<string, unknown> | undefined;

    const entry: CommentEntry = {
      cid,
      text: (comment.text as string) || "",
      like_count: toInt(comment.digg_count),
      sub_comment_count: toInt(comment.reply_comment_total),
      create_time: (comment.create_time as number) || 0,
      user_name: (user?.nickname as string) || "",
      ip_label: (comment.ip_label as string) || "",
    };

    if (!data.comments[awemeId]) {
      data.comments[awemeId] = [];
    }
    const existing = data.comments[awemeId];
    if (!existing.some((e) => e.cid === cid)) {
      existing.push(entry);
      tx.comment(awemeId);
    }
  }
}

function mergeDyUserPost(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext, tx: Tx): void {
  data.stats.userPostedRequests++;
  tx.stats();

  const awemeList = raw.aweme_list as unknown[] | undefined;
  if (!Array.isArray(awemeList)) return;

  const sourceUserId = ctx.page === "user" ? ctx.user_id : undefined;

  for (const item of awemeList) {
    const aweme = item as Record<string, unknown>;
    const awemeId = aweme.aweme_id as string;
    if (!awemeId) continue;

    const author = aweme.author as Record<string, unknown> | undefined;
    const stats = aweme.statistics as Record<string, unknown> | undefined;
    const video = aweme.video as Record<string, unknown> | undefined;
    const cover = video?.cover as { url_list?: string[] } | undefined;

    const card: NoteCard = {
      note_id: awemeId,
      xsec_token: "",
      title: (aweme.desc as string) || "",
      type: (aweme.aweme_type as number) === 68 ? "image" : "video",
      liked_count: toInt(stats?.digg_count),
      cover_url: cover?.url_list?.[0] || "",
      author: (author?.nickname as string) || undefined,
      author_id: (author?.sec_uid as string) || (author?.uid as string) || undefined,
      source_user_id: sourceUserId,
    };

    const existingCard = data.noteCards.find((c) => c.note_id === awemeId);
    if (existingCard) {
      Object.assign(existingCard, card);
      tx.card();
    } else {
      data.noteCards.push(card);
      tx.card();
    }

    if (ctx.page === "user" && author) {
      updateUserProfile(data, ctx.user_id, (author.nickname as string) || "", tx);
    }
  }
}

/** 用户主页信息 /aweme/v1/web/user/profile/other */
function mergeDyUserProfile(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext, tx: Tx): void {
  const user = raw.user as Record<string, unknown> | undefined;
  if (!user) return;

  const secUid = (user.sec_uid as string) || "";
  const nickname = (user.nickname as string) || "";
  const userId = secUid || (ctx.page === "user" ? ctx.user_id : "");
  if (!userId) return;

  const avatar = user.avatar_thumb as { url_list?: string[] } | undefined;

  updateUserProfile(data, userId, nickname, tx, {
    avatar: avatar?.url_list?.[0],
    signature: (user.signature as string) || undefined,
    follower_count: (user.follower_count as number) || undefined,
    following_count: (user.following_count as number) || undefined,
    total_favorited: (user.total_favorited as number) || undefined,
    platform: "douyin",
  });
}

// ═══════════════════════════════════════════
// ██  通用辅助函数
// ═══════════════════════════════════════════

// ── 博主 Profile 更新 ──

function updateUserProfile(
  data: SnifferData,
  userId: string,
  userName: string,
  tx: Tx,
  extras?: Partial<UserProfile>
): void {
  const profile = data.userProfiles[userId];

  if (!profile) {
    data.userProfiles[userId] = {
      user_id: userId,
      user_name: userName || userId,
      note_count: 0,
      first_seen: Date.now(),
      ...extras,
    };
  } else {
    if (userName) profile.user_name = userName;
    if (extras) {
      for (const [key, value] of Object.entries(extras)) {
        if (value !== undefined && value !== "") {
          (profile as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }
  }

  const count = Object.values(data.notes).filter(
    (n) => n.source_user_id === userId
  ).length + data.noteCards.filter(
    (c) => c.source_user_id === userId
  ).length;

  data.userProfiles[userId].note_count = count;
  data.userProfiles[userId].updated_at = Date.now();
  tx.profile();
}

// ── 小红书视频数据提取 ──

function extractXhsVideo(videoObj: Record<string, unknown>): VideoDetail | undefined {
  const media = videoObj.media as Record<string, unknown> | undefined;
  if (!media) return undefined;

  const stream = media.stream as Record<string, unknown> | undefined;
  const capa = videoObj.capa as Record<string, unknown> | undefined;
  const consumer = videoObj.consumer as Record<string, unknown> | undefined;
  const image = videoObj.image as Record<string, unknown> | undefined;

  const videoUrls: string[] = [];
  let bestUrl: string | undefined;
  let width: number | undefined;
  let height: number | undefined;

  if (stream) {
    for (const codec of ["h264", "h265", "av1"]) {
      const streams = stream[codec] as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(streams)) continue;
      for (const s of streams) {
        const url = s.master_url as string;
        if (url) {
          videoUrls.push(url);
          if (!bestUrl) {
            bestUrl = url;
            width = s.width as number | undefined;
            height = s.height as number | undefined;
          }
        }
        const backups = s.backup_urls as string[] | undefined;
        if (Array.isArray(backups)) {
          videoUrls.push(...backups.filter((u) => typeof u === "string"));
        }
      }
    }

    const streamMasterUrl = stream.master_url as string | undefined;
    if (streamMasterUrl && !videoUrls.includes(streamMasterUrl)) {
      videoUrls.unshift(streamMasterUrl);
      if (!bestUrl) bestUrl = streamMasterUrl;
    }
  }

  if (!bestUrl && videoUrls.length === 0) return undefined;

  return {
    video_url: bestUrl,
    video_urls: videoUrls.length > 0 ? videoUrls : undefined,
    duration: capa?.duration as number | undefined,
    origin_video_key: consumer?.origin_video_key as string | undefined,
    first_frame_fileid: image?.first_frame_fileid as string | undefined,
    thumbnail_fileid: image?.thumbnail_fileid as string | undefined,
    width,
    height,
  };
}

// ── 图片 URL 提取 ──

function extractImageUrl(img: Record<string, unknown>): string | undefined {
  const urlDefault = img.url_default as string | undefined;
  if (urlDefault) return urlDefault;

  const urlPre = img.url_pre as string | undefined;
  if (urlPre) return urlPre;

  const url = img.url as string | undefined;
  if (url) return url;

  const infoList = img.info_list as Array<{ url: string }> | undefined;
  if (Array.isArray(infoList) && infoList.length > 0 && infoList[0].url) {
    return infoList[0].url;
  }

  return undefined;
}

// ── 从 API URL 提取 user_id ──

function extractUserIdFromApiUrl(apiUrl: string): string | undefined {
  try {
    const u = new URL(apiUrl, "https://www.xiaohongshu.com");
    return u.searchParams.get("user_id") || undefined;
  } catch {
    const match = apiUrl.match(/[?&]user_id=([a-f0-9]+)/);
    return match ? match[1] : undefined;
  }
}
