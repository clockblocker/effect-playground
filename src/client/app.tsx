import { ReadFile } from "../shared/generated/protocol.ts";
import { ReadFileForm } from "./forms/read-file.tsx";

export function App() {
	return (
		<main className="panels">
			<ReadFileForm schema={ReadFile.Request} />
		</main>
	);
}
