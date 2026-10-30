import type { Effect } from "effect";
import { type FormEvent, useId, useState } from "react";
import type { Reader } from "../shared/reader.ts";
import type { RestFiles, RpcFilesClient } from "./clients.ts";
import { runtime } from "./clients.ts";
import {
	type Outcome,
	readerLabels,
	readViaRest,
	readViaRpc,
} from "./read-file.ts";

export function App() {
	return (
		<main className="panels">
			<ReaderPanel title="REST" read={readViaRest} />
			<ReaderPanel title="RPC" read={readViaRpc} />
		</main>
	);
}

function ReaderPanel({
	title,
	read,
}: {
	title: string;
	read: (
		name: string,
		reader: Reader,
	) => Effect.Effect<Outcome, never, RestFiles | RpcFilesClient>;
}) {
	const [name, setName] = useState("hello.txt");
	const [reader, setReader] = useState<Reader>("bun");
	const [outcome, setOutcome] = useState<Outcome | null>(null);
	const [pending, setPending] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		setPending(true);
		// The error channel is `never`, so this promise only rejects on a defect.
		setOutcome(await runtime.runPromise(read(name, reader)));
		setPending(false);
	}

	return (
		<section className="panel">
			<h2>{title}</h2>
			<form onSubmit={submit}>
				<input
					aria-label="File name"
					value={name}
					onChange={(event) => setName(event.target.value)}
				/>
				<ReaderSwitch value={reader} onChange={setReader} />
				<button type="submit" disabled={pending}>
					Submit
				</button>
			</form>
			{outcome?.kind === "contents" && <pre>{outcome.text}</pre>}
			{outcome?.kind === "error" && <p role="alert">{outcome.message}</p>}
		</section>
	);
}

const readers: readonly Reader[] = ["bun", "cpp"];

function ReaderSwitch({
	value,
	onChange,
}: {
	value: Reader;
	onChange: (reader: Reader) => void;
}) {
	// Each panel's radios need their own group name.
	const group = useId();
	return (
		<fieldset className="reader-switch">
			<legend className="visually-hidden">Reader</legend>
			{readers.map((reader) => (
				<label key={reader}>
					<input
						type="radio"
						name={group}
						value={reader}
						checked={value === reader}
						onChange={() => onChange(reader)}
					/>
					{readerLabels[reader]}
				</label>
			))}
		</fieldset>
	);
}
