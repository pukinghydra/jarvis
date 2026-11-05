import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/900.css";
import "./styles.css";

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
