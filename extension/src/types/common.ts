/**
 * 跨平台通用类型定义。
 * 所有平台共享的消息协议和枚举。
 */

// ── 平台标识 ──

export type PlatformKey = "xhs" | "bilibili" | "douyin";

// ── 嗅探来源 ──

export type SniffSource =
  // 小红书
  | "feed"
  | "comment"
  | "user_posted"
  // B站
  | "bili_playurl"
  | "bili_rcmd"
  | "bili_popular"
  | "bili_video_detail"
  | "bili_reply"
  | "bili_user_video"
  // 抖音
  | "dy_recommend"
  | "dy_video_detail"
  | "dy_comment"
  | "dy_user_post"
  | "dy_user_post_ssr"
  | "dy_user_profile";

// ── Content Script → Service Worker 通用消息 ──

export interface SniffMessage {
  type: "SNIFFER_DATA";
  platform: PlatformKey;
  source: SniffSource;
  payload: unknown;
  url: string;
  /** 发起请求的页面 URL，用于判断来源场景 */
  pageUrl: string;
  timestamp: number;
}
