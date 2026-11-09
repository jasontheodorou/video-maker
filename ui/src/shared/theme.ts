// Mantine theme for the Video maker. The look lives in tokens (styles.css); this maps Mantine onto them.
// Every font size is 16px or more, and every colour Mantine might use for text passes 7:1 (AAA) on the page.
// See DESIGN.md for the rules.
import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Ink, from pale sand to near black. Shades 6 to 9 carry text and fills; all pass 7:1 against the paper.
const ink: MantineColorsTuple = ["#faf8f4", "#f4efe7", "#ece5da", "#d9d1c5", "#a39a8f", "#6b625a", "#3d3832", "#2b4a5c", "#1b2128", "#11161b"];
const red: MantineColorsTuple = ["#f9eae7", "#f3d5d0", "#e8aaa1", "#d77d71", "#c2554a", "#a8352d", "#8f1d1d", "#7a1a1a", "#651515", "#4f1010"];
const green: MantineColorsTuple = ["#e6f1e9", "#cfe5d6", "#a5ceb2", "#77b28a", "#4f9466", "#357a4d", "#25643e", "#1d5236", "#16422b", "#0f3220"];

const FONT = "'Open Sans Variable', 'Open Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";

export const theme = createTheme({
  fontFamily: FONT,
  headings: {
    fontFamily: FONT,
    fontWeight: "700",
    sizes: {
      h1: { fontSize: "44px", lineHeight: "1.1", fontWeight: "800" },
      h2: { fontSize: "30px", lineHeight: "1.2" },
      h3: { fontSize: "24px", lineHeight: "1.3" },
      h4: { fontSize: "20px", lineHeight: "1.4" },
      h5: { fontSize: "18px", lineHeight: "1.4" },
      h6: { fontSize: "16px", lineHeight: "1.4" },
    },
  },
  // Nothing under 16px, ever.
  fontSizes: { xs: "16px", sm: "16px", md: "18px", lg: "20px", xl: "24px" },
  lineHeights: { xs: "1.5", sm: "1.5", md: "1.6", lg: "1.5", xl: "1.4" },
  spacing: { xs: "8px", sm: "12px", md: "16px", lg: "24px", xl: "32px" },
  colors: { ink, red, green },
  primaryColor: "ink",
  primaryShade: 8,
  black: "#1b2128",
  white: "#ffffff",
  defaultRadius: "md",
  radius: { xs: "6px", sm: "8px", md: "12px", lg: "16px", xl: "24px" },
  shadows: {
    xs: "0 1px 2px rgba(45, 35, 25, 0.06)",
    sm: "0 1px 2px rgba(45, 35, 25, 0.06), 0 2px 8px -2px rgba(45, 35, 25, 0.06)",
    md: "0 2px 4px rgba(45, 35, 25, 0.05), 0 12px 24px -12px rgba(45, 35, 25, 0.18)",
    lg: "0 4px 8px rgba(45, 35, 25, 0.05), 0 24px 48px -20px rgba(45, 35, 25, 0.25)",
    xl: "0 8px 16px rgba(45, 35, 25, 0.06), 0 32px 64px -24px rgba(45, 35, 25, 0.3)",
  },
  cursorType: "pointer",
  // Focus rings are drawn by styles.css (3px ink, offset), so they look the same on every control.
  focusRing: "never",
  respectReducedMotion: true,
  components: {
    Button: {
      defaultProps: { radius: "xl", loaderProps: { type: "dots" } },
    },
    Loader: { defaultProps: { color: "ink.8", type: "dots" } },
    Skeleton: { defaultProps: { radius: "sm" } },
    Tooltip: {
      defaultProps: {
        color: "ink.8",
        radius: "sm",
        openDelay: 300,
        withArrow: true,
        transitionProps: { transition: "pop", duration: 150 },
      },
    },
    // The dialog's header is not a page banner, and its close button says what it does.
    Modal: {
      defaultProps: {
        radius: "lg",
        padding: 32,
        centered: true,
        overlayProps: { backgroundOpacity: 0.45, color: "#1b2128", blur: 2 },
        transitionProps: { transition: "pop", duration: 220, timingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" },
        closeButtonProps: { "aria-label": "Close" },
        attributes: { header: { role: "presentation" } },
      },
    },
  },
});
