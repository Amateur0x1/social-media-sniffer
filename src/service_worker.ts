/**
 * Service Worker — 数据汇聚中心。
 *
 * 接收来自 content script 的 SNIFFER_DATA 消息，
 * 根据 pageUrl 判断来源场景（explore / user / creator），
 * 解析后合并写入 chrome.storage.local。
 *
 * 设计原则：只聚合数据，不发任何网络请求。
 */

/// <reference types="chrome" />

import type { SniffMessage } from "./types/xhs-api";
import type {
  NoteEntry,
  CommentEntry,
  NoteCard,
  SnifferData,
  VideoDetail,
  PageContext,
} from "./store/sniffer-store";
import { loadData, saveData, toInt, parsePageContext } from "./store/sniffer-store";

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

// ── 消息处理 ──

chrome.runtime.onMessage.addListener(
  (message: SniffMessage, _sender, sendResponse) => {
    if (message.type !== "SNIFFER_DATA") {
      sendResponse({ ok: false, reason: "unknown message type" });
      return;
    }

    handleSniffData(message)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[SM Sniffer] 处理数据失败:", err);
        sendResponse({ ok: false, reason: String(err) });
      });

    return true;
  }
);

async function handleSniffData(msg: SniffMessage): Promise<void> {
  const data = await loadData();
  const payload = msg.payload as Record<string, unknown>;
  const ctx = parsePageContext(msg.pageUrl);

  console.log("[SM Sniffer] 页面来源:", ctx.page, msg.source, msg.pageUrl);

  switch (msg.source) {
    case "feed":
      mergeFeed(data, payload, ctx);
      break;
    case "comment":
      mergeComments(data, payload);
      break;
    case "user_posted":
      mergeUserPosted(data, payload, ctx);
      break;
    case "galaxy":
      mergeGalaxy(data, payload);
      break;
  }

  await saveData(data);

  // 通知 side panel 刷新
  try {
    chrome.runtime.sendMessage({ type: "SNIFFER_UPDATED" });
  } catch { /* side panel 可能没打开 */ }
}

// ── Feed 笔记详情 ──

function mergeFeed(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext): void {
  data.stats.feedRequests++;

  const items = (raw as { data?: { items?: unknown[] } }).data?.items;
  if (!Array.isArray(items)) return;

  // 确定来源
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

    // 提取视频信息
    const videoObj = card.video as Record<string, unknown> | undefined;
    let videoDetail: VideoDetail | undefined;
    if ((card.type as string) === "video" && videoObj) {
      videoDetail = extractVideo(videoObj);
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
    };

    data.notes[noteId] = entry;

    // 如果在 user 页面，更新博主 profile
    if (ctx.page === "user" && user) {
      updateUserProfile(data, ctx.user_id, (user.nickname as string) || "");
    }
  }
}

// ── 评论列表 ──

function mergeComments(data: SnifferData, raw: Record<string, unknown>): void {
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

// ── 博主笔记卡片列表 ──

function mergeUserPosted(data: SnifferData, raw: Record<string, unknown>, ctx: PageContext): void {
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

    // 去重
    if (!data.noteCards.some((c) => c.note_id === noteId)) {
      data.noteCards.push(card);
    }

    // 更新博主 profile
    if (ctx.page === "user" && user) {
      updateUserProfile(
        data,
        ctx.user_id,
        (user.nickname as string) || (user.nick_name as string) || ""
      );
    }
  }
}

// ── Galaxy 创作者中心 ──

function mergeGalaxy(data: SnifferData, raw: Record<string, unknown>): void {
  data.stats.galaxyRequests++;

  const d = raw.data as Record<string, unknown> | undefined;
  if (!d) return;

  const notes = (d.notes ?? d.note_list) as unknown[] | undefined;
  if (Array.isArray(notes)) {
    for (const n of notes) {
      const note = n as Record<string, unknown>;
      const noteId = note.note_id as string;
      if (!noteId) continue;

      const entry: NoteEntry = {
        note_id: noteId,
        title: (note.title as string) || "",
        desc: (note.desc as string) || "",
        type: (note.type as string) || "normal",
        time: (note.create_time as number) || 0,
        ip_location: "",
        like_count: toInt(note.like_count),
        collect_count: toInt(note.collect_count),
        comment_count: toInt(note.comment_count),
        share_count: toInt(note.share_count),
        tags: [],
        images: note.cover ? [note.cover as string] : [],
        source: "creator",
      };

      data.creatorNotes[noteId] = entry;
    }
  }

  const stats = d.note_stats as Record<string, unknown> | undefined;
  if (stats) {
    const noteId = (stats.note_id ?? d.note_id) as string | undefined;
    if (noteId && data.creatorNotes[noteId]) {
      const existing = data.creatorNotes[noteId];
      existing.like_count = toInt(stats.like_count) || existing.like_count;
      existing.collect_count = toInt(stats.collect_count) || existing.collect_count;
      existing.comment_count = toInt(stats.comment_count) || existing.comment_count;
      existing.share_count = toInt(stats.share_count) || existing.share_count;
    }
  }
}

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
  // 统计该博主采集到的笔记数
  const count = Object.values(data.notes).filter(
    (n) => n.source_user_id === userId
  ).length + data.noteCards.filter(
    (c) => c.source_user_id === userId
  ).length;
  data.userProfiles[userId].note_count = count;
}

// ── 视频数据提取 ──

function extractVideo(videoObj: Record<string, unknown>): VideoDetail | undefined {
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
