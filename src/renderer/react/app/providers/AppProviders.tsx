import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ConfigProvider, theme } from "antd";
import { createTheme, MantineProvider } from "@mantine/core";
import { FeedbackProvider } from "../../components/feedback/FeedbackProvider";
import { derivedValue, MANTINE_ACCENT_SCALE } from "../../../../shared/palette-from-cat";

interface AppProvidersProps {
  children: ReactNode;
}

/**
 * 组件库的主色改由猫色板派生。
 *
 * AntD 的 `colorPrimary` 与 Mantine 的 `primaryColor` 都吃具体值（不吃 CSS 变量），
 * 所以这里从 `palette-from-cat.ts` 取——那是 `--rb-*` 的唯一真相来源，主题 CSS 只是它的
 * 落盘形式（派生锁保证两者相等）。直接写死粉色会让组件库和 CSS 各说各话。
 *
 * 两档各取各的：浅色档主色 = ACCENT，深色档主色 = ACCENT_FG（深底上要抬到亮端）。
 */
export function AppProviders({ children }: AppProvidersProps) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.uiTheme === "charcoal-pink");

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.dataset.uiTheme === "charcoal-pink"));
    observer.observe(root, { attributes: true, attributeFilter: ["data-ui-theme"] });
    return () => observer.disconnect();
  }, []);

  const scheme = dark ? "dark" : "light";

  const antdTheme = useMemo(
    () => ({
      token: {
        colorPrimary: derivedValue(scheme, "--rb-accent"),
        colorInfo: derivedValue(scheme, "--rb-accent"),
        colorLink: derivedValue(scheme, "--rb-accent"),
        // 实心底上的字色：深色档主色是亮蓝，用墨字才压得住（白字在 #8ab4ff 上只有 2.1:1）。
        colorTextLightSolid: derivedValue(scheme, "--rb-text-on-accent"),
        borderRadius: 10,
      },
      algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    }),
    [scheme, dark],
  );

  const mantineTheme = useMemo(
    () =>
      createTheme({
        primaryColor: "mochi",
        primaryShade: { light: 6, dark: 8 },
        colors: { mochi: MANTINE_ACCENT_SCALE },
      }),
    [],
  );

  return (
    <ConfigProvider theme={antdTheme}>
      <MantineProvider theme={mantineTheme} forceColorScheme={dark ? "dark" : "light"}>
        <FeedbackProvider>{children}</FeedbackProvider>
      </MantineProvider>
    </ConfigProvider>
  );
}
