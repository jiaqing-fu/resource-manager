"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "antd";
import type { InputProps } from "antd";

/**
 * 防抖搜索框：停止输入 400ms 自动查询；回车/清空立即查询；
 * 中文输入法组合期间不触发。
 */
export function DebouncedSearchInput({
  value,
  onSearch,
  delay = 400,
  ...rest
}: {
  value: string;
  onSearch: (value: string) => void;
  delay?: number;
} & Omit<InputProps, "value" | "onChange" | "onPressEnter">) {
  const [text, setText] = useState(value);
  const timerRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const lastExternalRef = useRef(value);

  useEffect(() => {
    if (value !== lastExternalRef.current) {
      lastExternalRef.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const emit = (next: string) => {
    clearTimer();
    lastExternalRef.current = next;
    onSearch(next.trim());
  };

  const schedule = (next: string) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      lastExternalRef.current = next;
      onSearch(next.trim());
    }, delay);
  };

  return (
    <Input
      allowClear
      {...rest}
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        if (composingRef.current) return;
        if (next === "") emit("");
        else schedule(next);
      }}
      onPressEnter={() => emit(text)}
      onCompositionStart={() => {
        composingRef.current = true;
        clearTimer();
      }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        const next = (e.target as HTMLInputElement).value;
        setText(next);
        if (next === "") emit("");
        else schedule(next);
      }}
    />
  );
}
