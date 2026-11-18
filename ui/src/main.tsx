// The studio app: one page, one router. Each workspace renders its own <AppShell>.
import "@mantine/core/styles.layer.css";
import "./shared/styles.css";
import "./shared/studio.css";
import "./make/make.css";
import "./brands/brands.css";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrandsPage } from "./brands/BrandsPage";
import { MakeWorkspace } from "./make/MakeWorkspace";
import { useRoute } from "./shared/router";
import { VideosLibrary } from "./videos/Library";

function App() {
  const route = useRoute();
  // Route changes move focus to the view's h1 (it has tabindex -1), never on first load.
  useEffect(() => {
    document.documentElement.dataset.workspace = route.workspace;
  }, [route.workspace]);
  if (route.workspace === "videos") return <VideosLibrary />;
  // The brands workspace owns everything under /brands.
  if (route.workspace === "brands") return <BrandsPage />;
  return <MakeWorkspace />;
}

createRoot(document.getElementById("root")!).render(<App />);
