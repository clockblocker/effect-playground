import {
	CustomCat,
	CustomWc,
	ReadFile,
} from "../shared/generated/generated.ts";
import { CountForm } from "./forms/count.tsx";
import { ReadFileForm } from "./forms/read-file.tsx";
import { RunCliForm } from "./forms/run-cli.tsx";

export function App() {
	return (
		<main className="panels">
			<ReadFileForm schema={ReadFile.Request} />
			<RunCliForm schema={CustomCat.Request} />
			<CountForm schema={CustomWc.Request} />
		</main>
	);
}
