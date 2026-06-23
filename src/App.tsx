import { useState, useEffect, useCallback, useMemo } from "react";
import {
  loadData,
  clearData,
  type SnifferData,
  type NoteEntry,
  type NoteCard,
  type UserProfile,
} from "./store/sniffer-store";

type TabKey = "explore" | "user" | "creator";

function App() {
  const [data, setData] = useState<SnifferData | null>(null);
  const [tab, setTab] = useState<TabKey>("explore");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** user tab 中当前展开的博主 */
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

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

  const creatorNotes = useMemo(() => {
    if (!data) return [];
    return Object.values(data.creatorNotes).sort(
      (a, b) => (b.time || 0) - (a.time || 0)
    );
  }, [data]);

  // 博主分组
  const userGroups = useMemo(() => {
    if (!data) return [];
    const profiles = Object.values(data.userProfiles || {});

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

  // 全选 / 取消当前 tab 的数据
  const currentNoteIds = useMemo(() => {
    if (tab === "explore") return exploreNotes.map((n) => n.note_id);
    if (tab === "creator") return creatorNotes.map((n) => n.note_id);
    if (tab === "user") {
      if (expandedUser) {
        const group = userGroups.find((g) => g.user_id === expandedUser);
        return group ? group.notes.map((n) => n.note_id) : [];
      }
      return userNotes.map((n) => n.note_id);
    }
    return [];
  }, [tab, exploreNotes, creatorNotes, userNotes, userGroups, expandedUser]);

  const allSelected = currentNoteIds.length > 0 && currentNoteIds.every((id) => selected.has(id));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) {
      currentNoteIds.forEach((id) => next.delete(id));
    } else {
      currentNoteIds.forEach((id) => next.add(id));
    }
    setSelected(next);
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  // 导出选中
  const handleExport = useCallback(() => {
    if (!data || selected.size === 0) return;

    const allNotes = { ...data.notes, ...data.creatorNotes };
    const exportNotes: NoteEntry[] = [];
    const exportComments: Record<string, unknown> = {};

    for (const id of selected) {
      const note = allNotes[id];
      if (note) exportNotes.push(note);
      if (data.comments[id]) exportComments[id] = data.comments[id];
    }

    const result = {
      notes: exportNotes,
      comments: exportComments,
      exported_count: exportNotes.length,
      exported_at: new Date().toISOString(),
    };

    const json = JSON.stringify(result, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `xhs-${tab}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, selected, tab]);

  const handleClear = useCallback(async () => {
    if (!confirm("确定清空所有采集数据？")) return;
    await clearData();
    setSelected(new Set());
    setExpandedUser(null);
    refresh();
  }, [refresh]);

  return (
    <div style={S.container}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <span style={S.headerIcon}>🔍</span>
          <span style={S.headerTitle}>社媒数据助手</span>
        </div>
        <span style={S.headerBadge}>被动采集</span>
      </div>

      {/* Tabs */}
      <div style={S.tabBar}>
        {([
          ["explore", `发现 (${exploreNotes.length})`],
          ["user", `博主 (${userGroups.length})`],
          ["creator", `我的 (${creatorNotes.length})`],
        ] as [TabKey, string][]).map(([key, label]) => (
          <button
            key={key}
            style={tab === key ? S.tabActive : S.tab}
            onClick={() => { setTab(key); setExpandedUser(null); }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      {currentNoteIds.length > 0 && (
        <div style={S.toolbar}>
          <label style={S.checkboxLabel}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} style={S.checkbox} />
            全选
          </label>
          <span style={S.selectedCount}>
            已选 {selected.size} 篇
            {commentCount > 0 && ` · 💬 ${commentCount} 条评论`}
          </span>
        </div>
      )}

      {/* Content area */}
      <div style={S.listContainer}>
        {tab === "explore" && (
          exploreNotes.length === 0 ? (
            <EmptyState text="浏览小红书发现页时自动采集" />
          ) : (
            exploreNotes.map((note) => (
              <NoteItem
                key={note.note_id}
                note={note}
                checked={selected.has(note.note_id)}
                commentCount={data?.comments[note.note_id]?.length || 0}
                onToggle={() => toggleOne(note.note_id)}
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
                onClick={() => setExpandedUser(group.user_id)}
              />
            ))
          )
        )}

        {tab === "creator" && (
          creatorNotes.length === 0 ? (
            <EmptyState text="打开创作者中心时自动采集" />
          ) : (
            creatorNotes.map((note) => (
              <NoteItem
                key={note.note_id}
                note={note}
                checked={selected.has(note.note_id)}
                commentCount={data?.comments[note.note_id]?.length || 0}
                onToggle={() => toggleOne(note.note_id)}
              />
            ))
          )
        )}
      </div>

      {/* Bottom action bar */}
      <div style={S.bottomBar}>
        <button
          style={selected.size > 0 ? S.btnExport : S.btnExportDisabled}
          onClick={handleExport}
          disabled={selected.size === 0}
        >
          📥 导出选中 ({selected.size})
        </button>
        <button style={S.btnClear} onClick={handleClear}>
          🗑️
        </button>
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
  onClick,
}: {
  group: {
    user_id: string;
    user_name: string;
    notes: NoteEntry[];
    cards: NoteCard[];
    total: number;
  };
  onClick: () => void;
}) {
  return (
    <div style={S.userGroupCard} onClick={onClick}>
      <div style={S.userGroupAvatar}>
        {group.user_name.slice(0, 1).toUpperCase()}
      </div>
      <div style={S.userGroupBody}>
        <div style={S.userGroupName}>@{group.user_name}</div>
        <div style={S.userGroupMeta}>
          {group.notes.length > 0 && `${group.notes.length} 篇详情`}
          {group.notes.length > 0 && group.cards.length > 0 && " · "}
          {group.cards.length > 0 && `${group.cards.length} 张卡片`}
        </div>
      </div>
      <span style={S.userGroupArrow}>›</span>
    </div>
  );
}

function NoteItem({
  note,
  checked,
  commentCount,
  onToggle,
}: {
  note: NoteEntry;
  checked: boolean;
  commentCount: number;
  onToggle: () => void;
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
        ...(checked ? S.noteCardChecked : {}),
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
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#333",
    backgroundColor: "#f5f5f5",
    fontSize: 13,
  },

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    backgroundColor: "#fff",
    borderBottom: "1px solid #e8e8e8",
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 8 },
  headerIcon: { fontSize: 20 },
  headerTitle: { fontSize: 16, fontWeight: 700 },
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
    padding: "10px 0",
    border: "none",
    borderBottom: "2px solid transparent",
    backgroundColor: "transparent",
    color: "#999",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    textAlign: "center" as const,
  },
  tabActive: {
    flex: 1,
    padding: "10px 0",
    border: "none",
    borderBottom: "2px solid #ff6b6b",
    backgroundColor: "transparent",
    color: "#ff6b6b",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    textAlign: "center" as const,
  },

  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 16px",
    backgroundColor: "#fff",
    borderBottom: "1px solid #f0f0f0",
    fontSize: 12,
  },
  checkboxLabel: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#666" },
  checkbox: { cursor: "pointer" },
  selectedCount: { color: "#ff6b6b", fontWeight: 600 },

  listContainer: { flex: 1, overflowY: "auto" as const, padding: "8px 12px" },

  empty: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#bbb",
  },
  emptyText: { fontSize: 13, textAlign: "center" as const, lineHeight: 1.6, color: "#bbb" },

  // User group card
  userGroupCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    marginBottom: 6,
    backgroundColor: "#fff",
    borderRadius: 8,
    border: "1px solid #eee",
    cursor: "pointer",
  },
  userGroupAvatar: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    backgroundColor: "#ff6b6b",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
    fontWeight: 700,
    flexShrink: 0,
  },
  userGroupBody: { flex: 1, minWidth: 0 },
  userGroupName: { fontSize: 14, fontWeight: 600, color: "#333" },
  userGroupMeta: { fontSize: 11, color: "#999", marginTop: 2 },
  userGroupArrow: { fontSize: 20, color: "#ccc", flexShrink: 0 },

  backBtn: {
    padding: "8px 12px",
    marginBottom: 8,
    border: "1px solid #e0e0e0",
    borderRadius: 6,
    backgroundColor: "#fff",
    color: "#666",
    fontSize: 12,
    cursor: "pointer",
    alignSelf: "flex-start",
  },

  // Note card
  noteCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    marginBottom: 6,
    backgroundColor: "#fff",
    borderRadius: 8,
    border: "1px solid #eee",
    cursor: "pointer",
  },
  noteCardChecked: { borderColor: "#ff6b6b", backgroundColor: "#fff8f8" },
  noteCheckbox: { marginTop: 4, cursor: "pointer", flexShrink: 0 },

  noteCover: {
    width: 52,
    height: 52,
    borderRadius: 6,
    objectFit: "cover" as const,
    flexShrink: 0,
    backgroundColor: "#f0f0f0",
  },
  noteCoverPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 6,
    flexShrink: 0,
    backgroundColor: "#f5f5f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 20,
  },

  noteBody: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" as const, gap: 3 },
  noteTitle: {
    fontSize: 13,
    fontWeight: 600,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  },
  videoBadge: {
    display: "inline-block",
    fontSize: 10,
    padding: "1px 5px",
    borderRadius: 3,
    backgroundColor: "#e3f2fd",
    color: "#1976d2",
    fontWeight: 600,
    marginRight: 4,
  },
  noteAuthor: { fontSize: 11, color: "#999" },
  noteMeta: { display: "flex", gap: 8, fontSize: 11, color: "#888" },
  commentCaptured: { color: "#4caf50", fontWeight: 500 },
  noteTime: { fontSize: 10, color: "#bbb" },

  bottomBar: {
    display: "flex",
    gap: 8,
    padding: "12px 16px",
    backgroundColor: "#fff",
    borderTop: "1px solid #e8e8e8",
  },
  btnExport: {
    flex: 1,
    padding: "10px 0",
    border: "none",
    borderRadius: 8,
    backgroundColor: "#ff6b6b",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnExportDisabled: {
    flex: 1,
    padding: "10px 0",
    border: "none",
    borderRadius: 8,
    backgroundColor: "#ddd",
    color: "#999",
    fontSize: 14,
    fontWeight: 600,
    cursor: "not-allowed",
  },
  btnClear: {
    padding: "10px 16px",
    border: "1px solid #e0e0e0",
    borderRadius: 8,
    backgroundColor: "#fff",
    color: "#e74c3c",
    fontSize: 13,
    cursor: "pointer",
  },
};

export default App;
