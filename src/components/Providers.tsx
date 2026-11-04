"use client";

import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { SWRConfig } from "swr";
import { fetcher } from "@/lib/client";

dayjs.locale("zh-cn");

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: false,
        shouldRetryOnError: false,
        keepPreviousData: true,
      }}
    >
      {children}
    </SWRConfig>
  );
}
