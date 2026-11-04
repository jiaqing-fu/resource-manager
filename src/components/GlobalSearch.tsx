"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Empty, Input, Spin } from "antd";
import { SearchOutlined } from "@ant-design/icons";

type SearchItem = { id: string; title: string; subtitle: string; href: string };
type SearchGroup = { key: string; label: string; items: SearchItem[] };
type SearchResponse = { q: string; groups: SearchGroup[] };

export function GlobalSearch() {
  const [value, setValue] = useState("");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const router = useRouter();
  const { data, isLoading } = useSWR<SearchResponse>(
    open && term ? `/api/search?q=${encodeURIComponent(term)}` : null,
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const schedule = (text: string) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (text.trim() === "") {
      setTerm("");
      return;
    }
    timerRef.current = window.setTimeout(() => setTerm(text.trim()), 400);
  };

  const go = (href: string) => {
    setOpen(false);
    setValue("");
    setTerm("");
    router.push(href);
  };

  const groups = data?.groups ?? [];

  return (
    <div className="rm-search">
      <Input
        allowClear
        value={value}
        prefix={<SearchOutlined />}
        placeholder="搜索名称 / IP / 序列号 / 线路编号"
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          setOpen(true);
          if (!composingRef.current) schedule(next);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false;
          schedule((e.target as HTMLInputElement).value);
        }}
        onPressEnter={() => {
          if (timerRef.current !== null) window.clearTimeout(timerRef.current);
          setTerm(value.trim());
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 180)}
      />
      {open && term ? (
        <div className="rm-search-panel" onMouseDown={(e) => e.preventDefault()}>
          {isLoading && !data ? (
            <div style={{ padding: 20, textAlign: "center" }}>
              <Spin size="small" />
            </div>
          ) : groups.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配结果" />
          ) : (
            groups.map((group) => (
              <div key={group.key}>
                <div className="rm-search-group">{group.label}</div>
                {group.items.map((item) => (
                  <div
                    key={`${group.key}-${item.id}`}
                    className="rm-search-item"
                    onClick={() => go(item.href)}
                  >
                    <div className="rm-search-item-title">{item.title}</div>
                    <div className="rm-search-item-sub">{item.subtitle}</div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
