/**
 * Service Worker — 数据汇聚中心（多平台版）。
 *
 * 接收来自各平台 content script 的 SNIFFER_DATA 消息，
 * 根据 platform 字段路由到对应的处理器，
 * 解析后合并写入 chrome.storage.local（每个平台独立 key）。
 *
 * 设计原则：只聚合数据，不发任何网络请求。
 */

/// <reference types="chrome" />

import type { SniffMessage, PlatformKey } from "./types/common";
import type {
  NoteEntry,
  CommentEntry,
  NoteCard,
  SnifferData,
  VideoDetail,
  PageContext,
} from "./store/sniffer-store";
import {
  loadData,
  saveData,
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

// 按接收顺序写入，避免详情和播放响应并发覆盖。
let sniffQueue: Promise<void> = Promise.resolve();

// ── 消息处理 ──

chrome.runtime.onMessage.addListener(
  (message: SniffMessage, _sender, sendResponse) => {
    if (message.type !== "SNIFFER_DATA") {
      sendResponse({ ok: false, reason: "unknown message type" });
      return;
    }

    sniffQueue = sniffQueue.catch(() => {}).then(() => handleSniffData(message));
    sniffQueue
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[SM Sniffer] 处理数据失败:", err);
        sendResponse({ ok: false, reason: String(err) });
      });

    return true;
  }
);

async function handleSniffData(msg: SniffMessage): Promise<void> {
  const platform = msg.platform || "xhs"; // 兼容旧版消息
  const data = await loadData(platform);
  const payload = msg.payload as Record<string, unknown>;
  const ctx = parsePageContext(msg.pageUrl, platform);

  console.log("[SM Sniffer]", platform, "页面来源:", ctx.page, msg.source, msg.pageUrl);

  switch (platform) {
    case "xhs":
      handleXhs(data, msg, payload, ctx);
      break;
    case "bilibili":
      handleBilibili(data, msg, payload, ctx);
      break;
    case "douyin":
      handleDouyin(data, msg, payload, ctx);
      break;
  }

  await saveData(data, platform);

  // 通知 side panel 刷新
  try {
    chrome.runtime.sendMessage({ type: "SNIFFER_UPDATED", platform });
  } catch { /* side panel 可能没打开 */ }
}

// ═══════════════════════════════════════════
// ██  小红书处理器
// ═══════════════════════════════════════════

function handleXhs(
  data: SnifferData,
  msg: SniffMessage,
  payload: Record<string, unknown>,
  ctx: PageContext
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
      mergeXhsFeed(data, payload, ctx);
      break;
    case "comment":
      mergeXhsComments(data, payload);
      break;
    case "user_posted":
      mergeXhsUserPosted(data, payload, ctx);
      break;
  }
}

function mergeXhsFeed(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext): void {
  data.stats.feedRequests++;

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

    const entry: NoteEntry = {
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
      images: imageList?.map((img) => extractImageUrl(img)).filter(Boolean) as string[] ?? [],
      video: videoDetail,
      author: (user?.nickname as string) || undefined,
      author_id: (user?.user_id as string) || undefined,
      source,
      source_user_id: ctx.page === "user" ? ctx.user_id : undefined,
      platform: "xhs",
    };

    data.notes[noteId] = entry;

    if (ctx.page === "user" && user) {
      updateUserProfile(data, ctx.user_id, (user.nickname as string) || "");
    }
  }
}

function mergeXhsComments(data: SnifferData, raw: Record<string, unknown>): void {
  data.stats.commentRequests++;

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
    }
  }
}

function mergeXhsUserPosted(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext): void {
  data.stats.userPostedRequests++;

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
      cover_url: cover ? (extractImageUrl(cover as Record<string, unknown>) || "") : "",
      author: (user?.nickname as string) || (user?.nick_name as string) || undefined,
      author_id: (user?.user_id as string) || undefined,
      source_user_id: sourceUserId,
    };

    if (!data.noteCards.some((c) => c.note_id === noteId)) {
      data.noteCards.push(card);
    }

    if (ctx.page === "user" && user) {
      updateUserProfile(
        data,
        ctx.user_id,
        (user.nickname as string) || (user.nick_name as string) || ""
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
  ctx: PageContext
): void {
  switch (msg.source) {
    case "bili_playurl":
      mergeBiliPlayurl(data, payload, msg);
      break;
    case "bili_rcmd":
      mergeBiliRcmd(data, payload);
      break;
    case "bili_popular":
      mergeBiliPopular(data, payload);
      break;
    case "bili_video_detail":
      mergeBiliVideoDetail(data, payload, ctx);
      break;
    case "bili_reply":
      mergeBiliReply(data, payload, msg.url);
      break;
    case "bili_user_video":
      mergeBiliUserVideo(data, payload, ctx);
      break;
  }
}

/** 仅消费页面已请求的播放信息，不主动调用 B站 API。 */
function mergeBiliPlayurl(data: SnifferData, raw: Record<string, unknown>, msg: SniffMessage): void {
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
    // 存 aid 用于评论关联（挂在扩展字段上）
    _bili_aid: aid,
  } as NoteEntry & { _bili_aid?: number };
}

/** 首页推荐流 /x/web-interface/wbi/index/top/feed/rcmd */
function mergeBiliRcmd(data: SnifferData, raw: Record<string, unknown>): void {
  data.stats.feedRequests++;

  // 推荐流数据在 data.item 数组中
  const dataObj = raw.data as { item?: unknown[] } | undefined;
  const items = dataObj?.item;
  if (!Array.isArray(items)) return;

  for (const item of items) {
    const v = item as Record<string, unknown>;
    const entry = biliVideoToNote(v, "explore");
    if (entry) {
      data.notes[entry.note_id] = { ...entry, video: { ...entry.video, ...data.notes[entry.note_id]?.video } };
    }
  }
}

/** 热门排行榜 /x/web-interface/popular */
function mergeBiliPopular(data: SnifferData, raw: Record<string, unknown>): void {
  data.stats.feedRequests++;

  const dataObj = raw.data as { list?: unknown[] } | undefined;
  const list = dataObj?.list;
  if (!Array.isArray(list)) return;

  for (const item of list) {
    const entry = biliVideoToNote(item as Record<string, unknown>, "explore");
    if (entry) {
      data.notes[entry.note_id] = { ...entry, video: { ...entry.video, ...data.notes[entry.note_id]?.video } };
    }
  }
}

/** 视频详情 /x/web-interface/wbi/view/detail — 数据嵌套在 data.View 中 */
function mergeBiliVideoDetail(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext): void {
  data.stats.feedRequests++;

  const dataObj = raw.data as Record<string, unknown> | undefined;
  if (!dataObj) return;

  // wbi/view/detail 聚合接口：视频信息在 data.View 中
  const v = (dataObj.View as Record<string, unknown>) || dataObj;
  if (!v.bvid) return;

  const source = ctx.page === "user" ? "user" as const : "note_detail" as const;
  const sourceUserId = ctx.page === "user" ? ctx.user_id : undefined;

  const entry = biliVideoToNote(v, source, sourceUserId);
  if (!entry) return;

  data.notes[entry.note_id] = { ...entry, video: { ...entry.video, ...data.notes[entry.note_id]?.video } };

  if (ctx.page === "user") {
    const owner = v.owner as Record<string, unknown> | undefined;
    if (owner) {
      updateUserProfile(data, ctx.user_id, (owner.name as string) || "");
    }
  }
}

function mergeBiliReply(data: SnifferData, raw: Record<string, unknown>, apiUrl: string): void {
  data.stats.commentRequests++;

  const dataObj = raw.data as { replies?: unknown[]; upper?: { mid?: number } } | undefined;
  const replies = dataObj?.replies;
  if (!Array.isArray(replies)) return;

  // 从 API URL 参数中获取 oid (视频 aid)，用于关联评论
  // B站评论以 oid 为 key，但我们需要 bvid，只能用 oid 作为中间 key
  const oidMatch = apiUrl.match(/[?&]oid=(\d+)/);
  const oid = oidMatch ? oidMatch[1] : "";
  if (!oid) return;

  // 在已有笔记中查找对应的 bvid
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
    }
  }
}

function mergeBiliUserVideo(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext): void {
  data.stats.userPostedRequests++;

  const dataObj = raw.data as { list?: { vlist?: unknown[] } } | undefined;
  const vlist = dataObj?.list?.vlist;
  if (!Array.isArray(vlist)) return;

  const sourceUserId = ctx.page === "user" ? ctx.user_id : undefined;

  for (const v of vlist) {
    const item = v as Record<string, unknown>;
    const bvid = item.bvid as string;
    if (!bvid) continue;

    const card: NoteCard = {
      note_id: bvid,
      xsec_token: "",
      title: (item.title as string) || "",
      type: "video",
      liked_count: 0, // user_video 接口不返回点赞数
      cover_url: (item.pic as string) || "",
      author: (item.author as string) || undefined,
      author_id: item.mid != null ? String(item.mid) : undefined,
      source_user_id: sourceUserId,
    };

    if (!data.noteCards.some((c) => c.note_id === bvid)) {
      data.noteCards.push(card);
    }

    if (ctx.page === "user") {
      updateUserProfile(data, ctx.user_id, (item.author as string) || "");
    }
  }
}

/** 通过 aid 在已采集的笔记中找到 bvid */
function findBvidByAid(data: SnifferData, aid: number): string | undefined {
  for (const [bvid, note] of Object.entries(data.notes)) {
    if (note.platform === "bilibili") {
      // biliVideoToNote 中存了 _bili_aid
      const noteAny = note as NoteEntry & { _bili_aid?: number };
      if (noteAny._bili_aid === aid) return bvid;
    }
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
  ctx: PageContext
): void {
  switch (msg.source) {
    case "dy_recommend":
      mergeDyRecommend(data, payload);
      break;
    case "dy_video_detail":
      mergeDyVideoDetail(data, payload, ctx);
      break;
    case "dy_comment":
      mergeDyComment(data, payload);
      break;
    case "dy_user_post":
    case "dy_user_post_ssr":
      mergeDyUserPost(data, payload, ctx);
      break;
    case "dy_user_profile":
      mergeDyUserProfile(data, payload, ctx);
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

  const avatarThumb = author?.avatar_thumb as { url_list?: string[] } | undefined;
  void avatarThumb; // 暂不使用头像

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
    tags: textExtra?.map((t) => t.hashtag_name).filter(Boolean) as string[] ?? [],
    images: imageUrls,
    video: videoDetail,
    author: (author?.nickname as string) || undefined,
    author_id: (author?.sec_uid as string) || (author?.uid as string) || undefined,
    source,
    source_user_id: sourceUserId,
    platform: "douyin",
  };
}

function mergeDyRecommend(data: SnifferData, raw: Record<string, unknown>): void {
  data.stats.feedRequests++;

  const awemeList = raw.aweme_list as unknown[] | undefined;
  if (!Array.isArray(awemeList)) return;

  for (const item of awemeList) {
    const entry = parseDyAwemeToNote(item as Record<string, unknown>, "explore");
    if (entry) {
      data.notes[entry.note_id] = entry;
    }
  }
}

function mergeDyVideoDetail(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext): void {
  data.stats.feedRequests++;

  const aweme = raw.aweme_detail as Record<string, unknown> | undefined;
  if (!aweme) return;

  const source = ctx.page === "user" ? "user" as const : "note_detail" as const;
  const sourceUserId = ctx.page === "user" ? ctx.user_id : undefined;

  const entry = parseDyAwemeToNote(aweme, source, sourceUserId);
  if (entry) {
    data.notes[entry.note_id] = entry;

    if (ctx.page === "user") {
      const author = aweme.author as Record<string, unknown> | undefined;
      if (author) {
        updateUserProfile(data, ctx.user_id, (author.nickname as string) || "");
      }
    }
  }
}

function mergeDyComment(data: SnifferData, raw: Record<string, unknown>): void {
  data.stats.commentRequests++;

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
    }
  }
}

function mergeDyUserPost(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext): void {
  data.stats.userPostedRequests++;

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

    if (!data.noteCards.some((c) => c.note_id === awemeId)) {
      data.noteCards.push(card);
    }

    if (ctx.page === "user" && author) {
      updateUserProfile(data, ctx.user_id, (author.nickname as string) || "");
    }
  }
}

/** 用户主页信息 /aweme/v1/web/user/profile/other */
function mergeDyUserProfile(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext): void {
  const user = raw.user as Record<string, unknown> | undefined;
  if (!user) return;

  const secUid = (user.sec_uid as string) || "";
  const nickname = (user.nickname as string) || "";
  const userId = secUid || (ctx.page === "user" ? ctx.user_id : "");
  if (!userId) return;

  updateUserProfile(data, userId, nickname);
}

// ═══════════════════════════════════════════
// ██  通用辅助函数
// ═══════════════════════════════════════════

// ── 博主 Profile 更新 ──

function updateUserProfile(data: SnifferData, userId: string, userName: string): void {
  if (!data.userProfiles[userId]) {
    data.userProfiles[userId] = {
      user_id: userId,
      user_name: userName || userId,
      note_count: 0,
      first_seen: Date.now(),
    };
  }
  if (userName) {
    data.userProfiles[userId].user_name = userName;
  }
  const count = Object.values(data.notes).filter(
    (n) => n.source_user_id === userId
  ).length + data.noteCards.filter(
    (c) => c.source_user_id === userId
  ).length;
  data.userProfiles[userId].note_count = count;
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
