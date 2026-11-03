import { RegistryProvider } from "@effect/atom-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("#root is missing from index.html");

// The registry holds the page's atoms: the RPC client's runtime and the
// result of each read.
createRoot(root).render(
	<StrictMode>
		<RegistryProvider>
			<App />
		</RegistryProvider>
	</StrictMode>,
);
