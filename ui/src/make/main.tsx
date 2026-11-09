import "@mantine/core/styles.layer.css";
import "../shared/styles.css";
import "./make.css";
import { createRoot } from "react-dom/client";
import { MakePage } from "./MakePage";

createRoot(document.getElementById("root")!).render(<MakePage />);
