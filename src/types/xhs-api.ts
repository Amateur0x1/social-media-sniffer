/**
 * 小红书 API 响应类型定义。
 * 参考 social-media-copilot 的 typings.d.ts，仅保留被动嗅探所需字段。
 */

// ── 通用 ──

export interface UserInfo {
  nickname: string;
  image?: string;
  user_id: string;
  avatar?: string;
}

export interface ImageInfo {
  height: number;
  width: number;
  url: string;
  url_pre?: string;
  url_default?: string;
  file_id?: string;
  trace_id?: string;
  live_photo?: boolean;
  stream?: unknown;
}

// ── 视频相关 ──

export interface VideoStream {
  master_url?: string;
  /** 各编码格式的视频流 */
  h264?: Array<{
    master_url: string;
    backup_urls?: string[];
    width?: number;
    height?: number;
    avg_bitrate?: number;
    duration?: number;
    size?: number;
    quality_type?: string;
  }>;
  h265?: Array<{
    master_url: string;
    backup_urls?: string[];
    width?: number;
    height?: number;
    avg_bitrate?: number;
    duration?: number;
    size?: number;
    quality_type?: string;
  }>;
  av1?: Array<{
    master_url: string;
    backup_urls?: string[];
    width?: number;
    height?: number;
  }>;
}

export interface VideoInfo {
  media: {
    stream: VideoStream;
    video_id?: number;
    video?: unknown;
  };
  image?: {
    first_frame_fileid?: string;
    thumbnail_fileid?: string;
  };
  capa?: {
    duration: number;
  };
  consumer?: {
    origin_video_key: string;
  };
}

export interface InteractInfo {
  liked_count: string;
  collected_count: string;
  comment_count: string;
  share_count: string;
}

// ── /api/sns/web/v1/feed ──

export interface NoteCard {
  desc: string;
  image_list: ImageInfo[];
  interact_info: InteractInfo;
  ip_location: string;
  last_update_time: number;
  note_id: string;
  time: number;
  title: string;
  type: string; // "video" | "normal"
  user: UserInfo;
  tag_list?: Array<{ name: string }>;
  video?: VideoInfo;
}

export interface FeedItem {
  id: string;
  model_type: string;
  note_card: NoteCard;
}

export interface WebV1FeedResponse {
  data: {
    cursor_score: string;
    items: FeedItem[];
    current_time: number;
  };
}

// ── /api/sns/web/v2/comment/page ──

export interface BaseComment {
  content: string;
  create_time: number;
  id: string;
  ip_location: string;
  like_count: string;
  liked: boolean;
  note_id: string;
  status: number;
  user_info: UserInfo;
}

export interface SubComment extends BaseComment {
  target_comment: {
    id: string;
    user_info: UserInfo;
  };
}

export interface Comment extends BaseComment {
  sub_comment_count: string;
  sub_comment_cursor: string;
  sub_comment_has_more: boolean;
  sub_comments: SubComment[];
}

export interface WebV2CommentPageResponse {
  data: {
    comments: Comment[];
    cursor: string;
    has_more: boolean;
  };
}

// ── /api/sns/web/v1/user_posted ──

export interface UserPostedNote {
  type: string;
  display_title: string;
  user: {
    nick_name: string;
    avatar: string;
    user_id: string;
    nickname: string;
  };
  interact_info: {
    liked: boolean;
    liked_count: string;
    sticky: boolean;
  };
  cover: {
    url: string;
    url_pre?: string;
    url_default?: string;
    file_id?: string;
    height: number;
    width: number;
  };
  note_id: string;
  xsec_token: string;
}

export interface WebV1UserPostedResponse {
  data: {
    cursor: string;
    notes: UserPostedNote[];
    has_more: boolean;
  };
}

// ── Galaxy 创作者中心 API ──

export interface GalaxyNote {
  note_id: string;
  title: string;
  desc?: string;
  type: string;
  cover?: string;
  create_time?: number;
  /** 笔记数据统计 */
  read_count?: number;
  like_count?: number;
  collect_count?: number;
  comment_count?: number;
  share_count?: number;
}

export interface GalaxyNoteListResponse {
  data: {
    notes: GalaxyNote[];
    has_more: boolean;
    cursor?: string;
  };
}

// ── 内部消息 ──

export type SniffSource = "feed" | "comment" | "user_posted" | "galaxy";

export interface SniffMessage {
  type: "SNIFFER_DATA";
  source: SniffSource;
  payload: unknown;
  url: string;
  /** 发起请求的页面 URL，用于判断来源场景 */
  pageUrl: string;
  timestamp: number;
}
