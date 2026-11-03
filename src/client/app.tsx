import { CustomCat } from "../shared/generated/protocol.ts";
import { ReadFile } from "../shared/read-file.ts";
import { ReadFileForm } from "./forms/read-file.tsx";
import { RunCliForm } from "./forms/run-cli.tsx";

export function App() {
	return (
		<main className="panels">
			<ReadFileForm schema={ReadFile.Request} />
			<RunCliForm schema={CustomCat.Request} />
		</main>
	);
}
