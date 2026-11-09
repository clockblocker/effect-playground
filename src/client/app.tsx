import {
	CustomCat,
	CustomWc,
	ReadFile,
	SearchFile,
} from "../shared/generated/generated.ts";
import { CountForm } from "./forms/count.tsx";
import { ReadFileForm } from "./forms/read-file.tsx";
import { RunCliForm } from "./forms/run-cli.tsx";
import { SearchForm } from "./forms/search.tsx";

export function App() {
	return (
		<main className="panels">
			<ReadFileForm schema={ReadFile.Request} />
			<SearchForm schema={SearchFile.Request} />
			<RunCliForm schema={CustomCat.Request} />
			<CountForm schema={CustomWc.Request} />
		</main>
	);
}
