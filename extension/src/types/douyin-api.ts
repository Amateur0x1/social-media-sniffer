/**
 * 抖音 API 响应类型定义。
 * 被动嗅探所需的核心字段。
 *
 * 抖音 Web 版接口返回的数据结构较多变，这里只定义最稳定的核心字段。
 */

// ── 通用 ──

export interface DyAuthor {
  uid: string;
  sec_uid: string;
  nickname: string;
  avatar_thumb: { url_list: string[] };
  unique_id: string;  // 抖音号
}

export interface DyStatistics {
  digg_count: number;      // 点赞
  comment_count: number;
  collect_count: number;   // 收藏
  share_count: number;
  play_count: number;
}

export interface DyVideo {
  play_addr: { url_list: string[] };
  cover: { url_list: string[] };
  duration: number;  // 毫秒
  width: number;
  height: number;
}

// ── 视频/笔记 ──

export interface DyAwemeItem {
  aweme_id: string;
  desc: string;          // 标题/描述
  create_time: number;   // unix ts (秒)
  author: DyAuthor;
  statistics: DyStatistics;
  video: DyVideo;
  text_extra?: Array<{ hashtag_name?: string }>;
  aweme_type: number;    // 0: 视频, 68: 图文
  images?: Array<{ url_list: string[] }>;  // 图文笔记
  ip_label?: string;
}

// ── 推荐流 /aweme/v1/web/tab/feed ──

export interface DyRecommendResponse {
  aweme_list: DyAwemeItem[];
  has_more: number;
  cursor: number;
  status_code: number;
}

// ── 视频详情 /aweme/v1/web/aweme/detail ──

export interface DyDetailResponse {
  aweme_detail: DyAwemeItem;
  status_code: number;
}

// ── 评论 /aweme/v1/web/comment/list ──

export interface DyCommentItem {
  cid: string;
  text: string;
  create_time: number;
  digg_count: number;
  reply_comment_total: number;
  user: {
    uid: string;
    sec_uid: string;
    nickname: string;
    unique_id: string;
  };
  ip_label?: string;
  aweme_id: string;
}

export interface DyCommentResponse {
  comments: DyCommentItem[] | null;
  has_more: number;
  cursor: number;
  total: number;
  status_code: number;
}

// ── 用户作品列表 /aweme/v1/web/aweme/post ──

export interface DyUserPostResponse {
  aweme_list: DyAwemeItem[];
  has_more: number;
  max_cursor: number;
  status_code: number;
}
