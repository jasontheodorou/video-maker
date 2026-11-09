import "@mantine/core/styles.layer.css";
import "../shared/styles.css";
import "./brands.css";
import { createRoot } from "react-dom/client";
import { BrandsPage } from "./BrandsPage";

createRoot(document.getElementById("root")!).render(<BrandsPage />);
