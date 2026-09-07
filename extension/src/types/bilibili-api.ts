/**
 * B站 API 响应类型定义。
 * 被动嗅探所需的核心字段。
 */

// ── 视频详情 /x/web-interface/view ──

export interface BiliVideoOwner {
  mid: number;
  name: string;
  face: string;
}

export interface BiliVideoStat {
  view: number;
  danmaku: number;
  reply: number;
  favorite: number;
  coin: number;
  share: number;
  like: number;
}

export interface BiliVideoDetail {
  bvid: string;
  aid: number;
  title: string;
  pic: string;        // 封面
  desc: string;
  duration: number;    // 秒
  pubdate: number;     // unix ts
  owner: BiliVideoOwner;
  stat: BiliVideoStat;
  tname: string;       // 分区
  dynamic: string;     // 动态/简介
  cid: number;
  tid: number;
  videos: number;      // 分P数
  pages?: Array<{ cid: number; page: number; part: string; duration: number }>;
}

export interface BiliVideoDetailResponse {
  code: number;
  data: BiliVideoDetail;
}

// ── 热门/推荐 /x/web-interface/popular ──

export interface BiliPopularItem {
  bvid: string;
  aid: number;
  title: string;
  pic: string;
  desc: string;
  duration: number;
  pubdate: number;
  owner: BiliVideoOwner;
  stat: BiliVideoStat;
  tname: string;
  rcmd_reason?: { content: string };
}

export interface BiliPopularResponse {
  code: number;
  data: {
    list: BiliPopularItem[];
    no_more: boolean;
  };
}

// ── 评论 /x/v2/reply/main ──

export interface BiliReplyMember {
  mid: string;
  uname: string;
  avatar: string;
}

export interface BiliReply {
  rpid: number;
  oid: number;       // 视频 aid
  mid: number;
  content: { message: string };
  ctime: number;
  like: number;
  rcount: number;    // 回复数
  member: BiliReplyMember;
  reply_control?: { location?: string };
}

export interface BiliReplyResponse {
  code: number;
  data: {
    replies: BiliReply[] | null;
    cursor: { all_count: number; is_end: boolean };
    upper: { mid: number };
  };
}

// ── 用户视频列表 /x/space/wbi/arc/search ──

export interface BiliUserVideoItem {
  bvid: string;
  aid: number;
  title: string;
  pic: string;
  description: string;
  play: number;
  comment: number;
  favorites: number;
  created: number;    // unix ts
  length: string;     // "03:45"
  author: string;
  mid: number;
}

export interface BiliUserVideoResponse {
  code: number;
  data: {
    list: {
      vlist: BiliUserVideoItem[];
    };
    page: {
      count: number;
      pn: number;
      ps: number;
    };
  };
}
