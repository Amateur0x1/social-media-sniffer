import { useState, useEffect, useCallback, useMemo } from "react";
import {
  loadData,
  clearData,
  type SnifferData,
  type NoteEntry,
  type NoteCard,
} from "./store/sniffer-store";

// ── 平台定义 ──

type PlatformKey = "xhs" | "bilibili" | "douyin";

interface PlatformDef {
  key: PlatformKey;
  label: string;
  /** emoji 或图片路径（以 / 或 . 开头视为图片） */
  icon: string;
  color: string;
  enabled: boolean;
}

const PLATFORMS: PlatformDef[] = [
  { key: "xhs", label: "小红书", icon: "/platform-xhs.png", color: "#ff6b6b", enabled: true },
  { key: "bilibili", label: "B站", icon: "📺", color: "#00a1d6", enabled: false },
  { key: "douyin", label: "抖音", icon: "🎵", color: "#111", enabled: false },
];

/** 判断 icon 是图片路径还是 emoji */
function isImageIcon(icon: string): boolean {
  return icon.startsWith("/") || icon.startsWith(".");
}

type TabKey = "explore" | "user";

function App() {
  const [platform, setPlatform] = useState<PlatformKey>("xhs");
  const [data, setData] = useState<SnifferData | null>(null);
  const [tab, setTab] = useState<TabKey>("explore");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 博主 tab 中选中的博主 user_id */
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  /** user tab 中当前展开的博主 */
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  const activePlatform = PLATFORMS.find((p) => p.key === platform)!;

  const refresh = useCallback(async () => {
    try {
      const d = await loadData();
      setData(d);
    } catch (err) {
      console.error("加载数据失败:", err);
    }
  }, []);

  useEffect(() => {
    const port = chrome.runtime.connect({ name: "sidepanel" });
    refresh();
    const listener = (msg: { type?: string }) => {
      if (msg.type === "SNIFFER_UPDATED") refresh();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      port.disconnect();
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [refresh]);

  // ── 按 tab 分类笔记 ──

  const exploreNotes = useMemo(() => {
    if (!data) return [];
    return Object.values(data.notes)
      .filter((n) => n.source === "explore" || n.source === "note_detail")
      .sort((a, b) => (b.time || 0) - (a.time || 0));
  }, [data]);

  const userNotes = useMemo(() => {
    if (!data) return [];
    return Object.values(data.notes)
      .filter((n) => n.source === "user")
      .sort((a, b) => (b.time || 0) - (a.time || 0));
  }, [data]);

  // user 页的卡片数据（user_posted API）
  const userCards = useMemo(() => {
    if (!data) return [];
    return data.noteCards.filter((c) => c.source_user_id);
  }, [data]);

  // 博主分组
  const userGroups = useMemo(() => {
    if (!data) return [];

    // 也考虑没有 profile 但有数据的博主
    const allUserIds = new Set<string>();
    userNotes.forEach((n) => n.source_user_id && allUserIds.add(n.source_user_id));
    userCards.forEach((c) => c.source_user_id && allUserIds.add(c.source_user_id));

    return Array.from(allUserIds).map((uid) => {
      const profile = data.userProfiles[uid];
      const notes = userNotes.filter((n) => n.source_user_id === uid);
      const cards = userCards.filter((c) => c.source_user_id === uid);
      return {
        user_id: uid,
        user_name: profile?.user_name || notes[0]?.author || cards[0]?.author || uid.slice(0, 8),
        notes,
        cards,
        total: notes.length + cards.length,
      };
    }).sort((a, b) => b.total - a.total);
  }, [data, userNotes, userCards]);

  // 统计
  const commentCount = data
    ? Object.values(data.comments).reduce((acc, arr) => acc + arr.length, 0)
    : 0;

  // ── 选中逻辑 ──
  // explore tab: 选中笔记 note_id
  // user tab 博主列表: 选中博主 user_id
  // user tab 展开后: 选中笔记 note_id

  /** 当前是否处于博主选择模式（user tab 未展开） */
  const isUserListMode = tab === "user" && !expandedUser;

  const currentNoteIds = useMemo(() => {
    if (tab === "explore") return exploreNotes.map((n) => n.note_id);
    if (tab === "user" && expandedUser) {
      const group = userGroups.find((g) => g.user_id === expandedUser);
      return group ? group.notes.map((n) => n.note_id) : [];
    }
    return [];
  }, [tab, exploreNotes, userGroups, expandedUser]);

  const currentUserIds = useMemo(() => {
    return userGroups.map((g) => g.user_id);
  }, [userGroups]);

  const allSelected = isUserListMode
    ? currentUserIds.length > 0 && currentUserIds.every((id) => selectedUsers.has(id))
    : currentNoteIds.length > 0 && currentNoteIds.every((id) => selected.has(id));

  const selectionCount = isUserListMode ? selectedUsers.size : selected.size;

  const toggleAll = () => {
    if (isUserListMode) {
      const next = new Set(selectedUsers);
      if (allSelected) {
        currentUserIds.forEach((id) => next.delete(id));
      } else {
        currentUserIds.forEach((id) => next.add(id));
      }
      setSelectedUsers(next);
    } else {
      const next = new Set(selected);
      if (allSelected) {
        currentNoteIds.forEach((id) => next.delete(id));
      } else {
        currentNoteIds.forEach((id) => next.add(id));
      }
      setSelected(next);
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleUser = (userId: string) => {
    const next = new Set(selectedUsers);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setSelectedUsers(next);
  };

  // 导出选中
  const handleExport = useCallback(() => {
    if (!data) return;

    // 博主列表模式：按博主导出
    if (isUserListMode && selectedUsers.size > 0) {
      const exportUsers = userGroups
        .filter((g) => selectedUsers.has(g.user_id))
        .map((g) => {
          const comments: Record<string, unknown> = {};
          for (const note of g.notes) {
            if (data.comments[note.note_id]) {
              comments[note.note_id] = data.comments[note.note_id];
            }
          }
          return {
            user_id: g.user_id,
            user_name: g.user_name,
            notes: g.notes,
            cards: g.cards,
            comments,
          };
        });

      const result = {
        users: exportUsers,
        exported_count: exportUsers.length,
        exported_at: new Date().toISOString(),
      };

      downloadJson(result, `${platform}-users-${new Date().toISOString().slice(0, 10)}.json`);
      return;
    }

    // 笔记模式
    if (selected.size === 0) return;

    const exportNotes: NoteEntry[] = [];
    const exportComments: Record<string, unknown> = {};

    for (const id of selected) {
      const note = data.notes[id];
      if (note) exportNotes.push(note);
      if (data.comments[id]) exportComments[id] = data.comments[id];
    }

    const result = {
      notes: exportNotes,
      comments: exportComments,
      exported_count: exportNotes.length,
      exported_at: new Date().toISOString(),
    };

    downloadJson(result, `${platform}-${tab}-${new Date().toISOString().slice(0, 10)}.json`);
  }, [data, selected, selectedUsers, isUserListMode, userGroups, tab, platform]);

  function downloadJson(obj: unknown, filename: string) {
    const json = JSON.stringify(obj, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const handleClear = useCallback(async () => {
    if (!confirm("确定清空所有采集数据？")) return;
    await clearData();
    setSelected(new Set());
    setSelectedUsers(new Set());
    setExpandedUser(null);
    refresh();
  }, [refresh]);

  return (
    <div style={S.root}>
      {/* ── 左侧平台导航栏 ── */}
      <div style={S.sidebar}>
        <div style={S.sidebarTop}>
          {PLATFORMS.map((p) => (
            <button
              key={p.key}
              title={p.enabled ? p.label : `${p.label}（即将支持）`}
              style={{
                ...S.platformBtn,
                ...(platform === p.key ? {
                  backgroundColor: p.color + "18",
                  borderColor: p.color,
                } : {}),
                ...(p.enabled ? {} : S.platformBtnDisabled),
              }}
              onClick={() => p.enabled && setPlatform(p.key)}
              disabled={!p.enabled}
            >
              {isImageIcon(p.icon)
                ? <img src={p.icon} alt={p.label} style={S.platformIconImg} />
                : <span style={S.platformIcon}>{p.icon}</span>
              }
              <span style={{
                ...S.platformLabel,
                color: platform === p.key ? p.color : (p.enabled ? "#666" : "#ccc"),
                fontWeight: platform === p.key ? 700 : 400,
              }}>
                {p.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 右侧主内容 ── */}
      <div style={S.main}>
        {/* Header */}
        <div style={{ ...S.header, borderBottomColor: activePlatform.color + "40" }}>
          <div style={S.headerLeft}>
            {isImageIcon(activePlatform.icon)
              ? <img src={activePlatform.icon} alt={activePlatform.label} style={S.headerIconImg} />
              : <span style={S.headerIcon}>{activePlatform.icon}</span>
            }
            <span style={S.headerTitle}>{activePlatform.label}</span>
          </div>
          <span style={S.headerBadge}>被动采集</span>
        </div>

        {/* Tabs */}
        <div style={S.tabBar}>
          {([
            ["explore", `发现 (${exploreNotes.length})`],
            ["user", `博主 (${userGroups.length})`],
          ] as [TabKey, string][]).map(([key, label]) => (
            <button
              key={key}
              style={{
                ...(tab === key ? S.tabActive : S.tab),
                ...(tab === key ? { borderBottomColor: activePlatform.color, color: activePlatform.color } : {}),
              }}
              onClick={() => { setTab(key); setExpandedUser(null); }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        {(isUserListMode ? currentUserIds.length > 0 : currentNoteIds.length > 0) && (
          <div style={S.toolbar}>
            <label style={S.checkboxLabel}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} style={S.checkbox} />
              全选
            </label>
            <span style={{ ...S.selectedCount, color: activePlatform.color }}>
              已选 {selectionCount} {isUserListMode ? "位博主" : "篇"}
              {!isUserListMode && commentCount > 0 && ` · 💬 ${commentCount} 条评论`}
            </span>
          </div>
        )}

        {/* Content area */}
        <div style={S.listContainer}>
          {tab === "explore" && (
            exploreNotes.length === 0 ? (
              <EmptyState text={`浏览${activePlatform.label}发现页时自动采集`} />
            ) : (
              exploreNotes.map((note) => (
                <NoteItem
                  key={note.note_id}
                  note={note}
                  checked={selected.has(note.note_id)}
                  commentCount={data?.comments[note.note_id]?.length || 0}
                  onToggle={() => toggleOne(note.note_id)}
                  accentColor={activePlatform.color}
                />
              ))
            )
          )}

          {tab === "user" && (
            userGroups.length === 0 ? (
              <EmptyState text="浏览博主主页时自动采集" />
            ) : expandedUser ? (
              // 展开某个博主的笔记列表
              <>
                <button
                  style={S.backBtn}
                  onClick={() => setExpandedUser(null)}
                >
                  ← 返回博主列表
                </button>
                {(() => {
                  const group = userGroups.find((g) => g.user_id === expandedUser);
                  if (!group) return null;
                  return group.notes.length > 0
                    ? group.notes.map((note) => (
                        <NoteItem
                          key={note.note_id}
                          note={note}
                          checked={selected.has(note.note_id)}
                          commentCount={data?.comments[note.note_id]?.length || 0}
                          onToggle={() => toggleOne(note.note_id)}
                          accentColor={activePlatform.color}
                        />
                      ))
                    : (
                      <div style={S.emptyText}>
                        该博主暂无笔记详情，仅有 {group.cards.length} 张卡片数据
                      </div>
                    );
                })()}
              </>
            ) : (
              // 博主分组列表
              userGroups.map((group) => (
                <UserGroupCard
                  key={group.user_id}
                  group={group}
                  checked={selectedUsers.has(group.user_id)}
                  onToggle={() => toggleUser(group.user_id)}
                  onClick={() => setExpandedUser(group.user_id)}
                  accentColor={activePlatform.color}
                />
              ))
            )
          )}

        </div>

        {/* Bottom action bar */}
        <div style={S.bottomBar}>
          <button
            style={selectionCount > 0
              ? { ...S.btnExport, backgroundColor: activePlatform.color }
              : S.btnExportDisabled}
            onClick={handleExport}
            disabled={selectionCount === 0}
          >
            📥 导出选中 ({selectionCount})
          </button>
          <button style={S.btnClear} onClick={handleClear}>
            🗑️
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 子组件 ──

function EmptyState({ text }: { text: string }) {
  return (
    <div style={S.empty}>
      <p style={{ fontSize: 36, margin: 0 }}>📡</p>
      <p style={S.emptyText}>{text}</p>
    </div>
  );
}

function UserGroupCard({
  group,
  checked,
  onToggle,
  onClick,
  accentColor,
}: {
  group: {
    user_id: string;
    user_name: string;
    notes: NoteEntry[];
    cards: NoteCard[];
    total: number;
  };
  checked: boolean;
  onToggle: () => void;
  onClick: () => void;
  accentColor: string;
}) {
  return (
    <div
      style={{
        ...S.userGroupCard,
        ...(checked ? { borderColor: accentColor, backgroundColor: accentColor + "08" } : {}),
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        style={{ cursor: "pointer", flexShrink: 0 }}
      />
      <div style={{ ...S.userGroupAvatar, backgroundColor: accentColor }} onClick={onClick}>
        {group.user_name.slice(0, 1).toUpperCase()}
      </div>
      <div style={S.userGroupBody} onClick={onClick}>
        <div style={S.userGroupName}>@{group.user_name}</div>
        <div style={S.userGroupMeta}>
          {group.notes.length > 0 && `${group.notes.length} 篇详情`}
          {group.notes.length > 0 && group.cards.length > 0 && " · "}
          {group.cards.length > 0 && `${group.cards.length} 张卡片`}
        </div>
      </div>
      <span style={S.userGroupArrow} onClick={onClick}>›</span>
    </div>
  );
}

function NoteItem({
  note,
  checked,
  commentCount,
  onToggle,
  accentColor,
}: {
  note: NoteEntry;
  checked: boolean;
  commentCount: number;
  onToggle: () => void;
  accentColor: string;
}) {
  const title = note.title || note.desc?.slice(0, 40) || "(无标题)";
  const time = note.time
    ? new Date(note.time).toLocaleDateString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const hasVideo = note.type === "video";
  const hasImages = note.images && note.images.some((u) => u);
  const coverUrl = hasImages
    ? note.images.find((u) => u)
    : note.video?.first_frame_fileid
      ? `https://sns-img-bd.xhscdn.com/${note.video.first_frame_fileid}`
      : undefined;

  return (
    <div
      style={{
        ...S.noteCard,
        ...(checked ? { borderColor: accentColor, backgroundColor: accentColor + "08" } : {}),
      }}
      onClick={onToggle}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        style={S.noteCheckbox}
      />

      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          style={S.noteCover}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div style={S.noteCoverPlaceholder}>{hasVideo ? "🎬" : "📝"}</div>
      )}

      <div style={S.noteBody}>
        <div style={S.noteTitle}>
          {hasVideo && <span style={S.videoBadge}>视频</span>}
          {title}
        </div>
        {note.author && <div style={S.noteAuthor}>@{note.author}</div>}
        <div style={S.noteMeta}>
          <span>❤️ {note.like_count}</span>
          <span>⭐ {note.collect_count}</span>
          <span>💬 {note.comment_count}</span>
          {commentCount > 0 && (
            <span style={S.commentCaptured}>(已采 {commentCount})</span>
          )}
        </div>
        <div style={S.noteTime}>
          {time}
          {note.ip_location && ` · ${note.ip_location}`}
        </div>
      </div>
    </div>
  );
}

// ── Styles ──

const S: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    height: "100vh",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#333",
    backgroundColor: "#f5f5f5",
    fontSize: 13,
  },

  // ── 左侧导航 ──
  sidebar: {
    width: 56,
    minWidth: 56,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    backgroundColor: "#fafafa",
    borderRight: "1px solid #e8e8e8",
    paddingTop: 12,
  },
  sidebarTop: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 4,
    width: "100%",
    padding: "0 4px",
  },
  platformBtn: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 2,
    width: 48,
    padding: "8px 0",
    border: "2px solid transparent",
    borderRadius: 10,
    backgroundColor: "transparent",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  platformBtnDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },
  platformIcon: {
    fontSize: 20,
    lineHeight: 1,
  },
  platformIconImg: {
    width: 22,
    height: 22,
    borderRadius: 4,
    objectFit: "contain" as const,
  },
  platformLabel: {
    fontSize: 9,
    lineHeight: 1,
    whiteSpace: "nowrap" as const,
  },

  // ── 右侧主区域 ──
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    minWidth: 0,
    overflow: "hidden" as const,
  },

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    backgroundColor: "#fff",
    borderBottom: "1px solid #e8e8e8",
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 6 },
  headerIcon: { fontSize: 18 },
  headerIconImg: {
    width: 20,
    height: 20,
    borderRadius: 3,
    objectFit: "contain" as const,
  },
  headerTitle: { fontSize: 15, fontWeight: 700 },
  headerBadge: {
    fontSize: 10,
    padding: "2px 8px",
    borderRadius: 10,
    backgroundColor: "#e8f5e9",
    color: "#4caf50",
    fontWeight: 600,
  },

  tabBar: {
    display: "flex",
    backgroundColor: "#fff",
    borderBottom: "1px solid #e8e8e8",
  },
  tab: {
    flex: 1,
    padding: "9px 0",
    border: "none",
    borderBottom: "2px solid transparent",
    backgroundColor: "transparent",
    color: "#999",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    textAlign: "center" as const,
  },
  tabActive: {
    flex: 1,
    padding: "9px 0",
    border: "none",
    borderBottom: "2px solid #ff6b6b",
    backgroundColor: "transparent",
    color: "#ff6b6b",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    textAlign: "center" as const,
  },

  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 14px",
    backgroundColor: "#fff",
    borderBottom: "1px solid #f0f0f0",
    fontSize: 11,
  },
  checkboxLabel: { display: "flex", alignItems: "center", gap: 5, cursor: "pointer", color: "#666" },
  checkbox: { cursor: "pointer" },
  selectedCount: { color: "#ff6b6b", fontWeight: 600 },

  listContainer: { flex: 1, overflowY: "auto" as const, padding: "6px 10px" },

  empty: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#bbb",
  },
  emptyText: { fontSize: 12, textAlign: "center" as const, lineHeight: 1.6, color: "#bbb" },

  // User group card
  userGroupCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    marginBottom: 5,
    backgroundColor: "#fff",
    borderRadius: 8,
    border: "1px solid #eee",
    cursor: "pointer",
  },
  userGroupAvatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    backgroundColor: "#ff6b6b",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 15,
    fontWeight: 700,
    flexShrink: 0,
  },
  userGroupBody: { flex: 1, minWidth: 0 },
  userGroupName: { fontSize: 13, fontWeight: 600, color: "#333" },
  userGroupMeta: { fontSize: 10, color: "#999", marginTop: 2 },
  userGroupArrow: { fontSize: 18, color: "#ccc", flexShrink: 0 },

  backBtn: {
    padding: "6px 10px",
    marginBottom: 6,
    border: "1px solid #e0e0e0",
    borderRadius: 6,
    backgroundColor: "#fff",
    color: "#666",
    fontSize: 11,
    cursor: "pointer",
    alignSelf: "flex-start",
  },

  // Note card
  noteCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "8px 10px",
    marginBottom: 5,
    backgroundColor: "#fff",
    borderRadius: 8,
    border: "1px solid #eee",
    cursor: "pointer",
  },
  noteCardChecked: { borderColor: "#ff6b6b", backgroundColor: "#fff8f8" },
  noteCheckbox: { marginTop: 4, cursor: "pointer", flexShrink: 0 },

  noteCover: {
    width: 48,
    height: 48,
    borderRadius: 6,
    objectFit: "cover" as const,
    flexShrink: 0,
    backgroundColor: "#f0f0f0",
  },
  noteCoverPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 6,
    flexShrink: 0,
    backgroundColor: "#f5f5f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
  },

  noteBody: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" as const, gap: 2 },
  noteTitle: {
    fontSize: 12,
    fontWeight: 600,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  },
  videoBadge: {
    display: "inline-block",
    fontSize: 9,
    padding: "1px 4px",
    borderRadius: 3,
    backgroundColor: "#e3f2fd",
    color: "#1976d2",
    fontWeight: 600,
    marginRight: 3,
  },
  noteAuthor: { fontSize: 10, color: "#999" },
  noteMeta: { display: "flex", gap: 6, fontSize: 10, color: "#888" },
  commentCaptured: { color: "#4caf50", fontWeight: 500 },
  noteTime: { fontSize: 9, color: "#bbb" },

  bottomBar: {
    display: "flex",
    gap: 6,
    padding: "10px 12px",
    backgroundColor: "#fff",
    borderTop: "1px solid #e8e8e8",
  },
  btnExport: {
    flex: 1,
    padding: "9px 0",
    border: "none",
    borderRadius: 8,
    backgroundColor: "#ff6b6b",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnExportDisabled: {
    flex: 1,
    padding: "9px 0",
    border: "none",
    borderRadius: 8,
    backgroundColor: "#ddd",
    color: "#999",
    fontSize: 13,
    fontWeight: 600,
    cursor: "not-allowed",
  },
  btnClear: {
    padding: "9px 14px",
    border: "1px solid #e0e0e0",
    borderRadius: 8,
    backgroundColor: "#fff",
    color: "#e74c3c",
    fontSize: 12,
    cursor: "pointer",
  },
};

export default App;
